import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import { db, reopenDatabase, schema, sqlite } from '../db/index.js';
import { config } from '../config.js';
import { now } from '../utils.js';
import { closeConnections, resetRuntimeState } from './runtime.js';
import { siteSettings } from './settings.js';

const CHILD_TABLES = [
  schema.resourceMembers, schema.shareLinks, schema.permissionRequests, schema.smartFields,
  schema.smartViews, schema.smartRecords, schema.rowPolicies, schema.fieldPolicies,
  schema.comments, schema.notifications, schema.favorites, schema.recentVisits,
  schema.versions, schema.collabSnapshots, schema.collabUpdates, schema.officeRooms,
];

/** 永久删除资源及其所有关联数据（协同、版本、权限、评论等），返回删除数量汇总。 */
export function purgeResources(resourceIds: string[]) {
  if (!resourceIds.length) return { resources: 0, files: 0 };
  const allResources = db.select({ id: schema.resources.id, parentId: schema.resources.parentId, fileId: schema.resources.fileId }).from(schema.resources).all();
  const children = new Map<string, string[]>();
  for (const resource of allResources) {
    if (resource.parentId) children.set(resource.parentId, [...(children.get(resource.parentId) || []), resource.id]);
  }
  const targetIds = new Set<string>();
  const queue = [...resourceIds];
  while (queue.length) {
    const current = queue.shift()!;
    if (targetIds.has(current)) continue;
    targetIds.add(current);
    queue.push(...(children.get(current) || []));
  }
  const ids = [...targetIds];
  const fileIds = new Set(allResources.filter(r => targetIds.has(r.id) && r.fileId).map(r => r.fileId!));
  const versionFiles = db.select({ fileId: schema.versions.fileId }).from(schema.versions).where(inArray(schema.versions.resourceId, ids)).all();
  for (const version of versionFiles) if (version.fileId) fileIds.add(version.fileId);

  db.transaction(tx => {
    for (const table of CHILD_TABLES) tx.delete(table).where(inArray((table as any).resourceId, ids)).run();
    tx.update(schema.resources).set({ parentId: null }).where(inArray(schema.resources.parentId, ids)).run();
    tx.delete(schema.resources).where(inArray(schema.resources.id, ids)).run();
    for (const fileId of fileIds) {
      const usedByResource = tx.select({ id: schema.resources.id }).from(schema.resources).where(eq(schema.resources.fileId, fileId)).all();
      const usedByVersion = tx.select({ id: schema.versions.id }).from(schema.versions).where(eq(schema.versions.fileId, fileId)).all();
      if (!usedByResource.length && !usedByVersion.length) tx.delete(schema.fileObjects).where(eq(schema.fileObjects.id, fileId)).run();
    }
  });
  for (const id of ids) closeConnections({ resourceId: id });
  return { resources: ids.length, files: fileIds.size };
}

/** 按站点配置裁剪历史版本，始终保留最新一个版本（原生表格的最新版本就是当前内容）。 */
export function trimVersions(resourceId: string, limit = siteSettings().maxVersionsPerResource as number) {
  const rows = db.select({ id: schema.versions.id }).from(schema.versions)
    .where(eq(schema.versions.resourceId, resourceId)).orderBy(sql`${schema.versions.createdAt} desc, ${schema.versions.id} desc`).all();
  if (rows.length <= limit) return 0;
  const obsolete = rows.slice(Math.max(1, limit)).map(row => row.id);
  db.delete(schema.versions).where(inArray(schema.versions.id, obsolete)).run();
  return obsolete.length;
}

export function localBlobKeys() {
  const root = path.resolve(config.localStorageDir);
  const keys: string[] = [];
  try {
    for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue;
      for (const file of fs.readdirSync(path.join(root, bucket.name), { withFileTypes: true })) {
        if (file.isFile()) keys.push(`${bucket.name}/${file.name}`);
      }
    }
  } catch { /* 目录不存在 */ }
  return keys;
}

export interface CleanupReport {
  expiredSessions: number;
  expiredInvites: number;
  expiredTrash: number;
  oldVersions: number;
  orphanRows: number;
  orphanBlobs: number;
  orphanBlobBytes: number;
}

export function cleanupData(actions: string[]): CleanupReport {
  const report: CleanupReport = { expiredSessions: 0, expiredInvites: 0, expiredTrash: 0, oldVersions: 0, orphanRows: 0, orphanBlobs: 0, orphanBlobBytes: 0 };
  const requested = new Set(actions);
  const timestamp = now();
  if (requested.has('expiredSessions')) {
    report.expiredSessions = db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, timestamp)).run().changes;
  }
  if (requested.has('expiredInvites')) {
    const expired = db.select({ id: schema.invites.id }).from(schema.invites).where(and(lt(schema.invites.expiresAt, timestamp), sql`${schema.invites.usedAt} is null`)).all();
    if (expired.length) report.expiredInvites = db.delete(schema.invites).where(inArray(schema.invites.id, expired.map(x => x.id))).run().changes;
  }
  if (requested.has('expiredTrash')) {
    const days = siteSettings().trashRetentionDays as number;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const stale = db.select({ id: schema.resources.id }).from(schema.resources).where(and(isNotNull(schema.resources.deletedAt), lt(schema.resources.deletedAt, cutoff))).all();
    const resources = db.select({ id: schema.resources.id, parentId: schema.resources.parentId, deletedAt: schema.resources.deletedAt }).from(schema.resources).all();
    const children = new Map<string, string[]>();
    for (const row of resources) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) || []), row.id]);
    const byId = new Map(resources.map(row => [row.id, row]));
    const hasActiveDescendant = (resourceId: string, seen = new Set<string>()): boolean => {
      if (seen.has(resourceId)) return false;
      seen.add(resourceId);
      return (children.get(resourceId) || []).some(child => {
        const row = byId.get(child);
        return row ? !row.deletedAt || hasActiveDescendant(child, seen) : true;
      });
    };
    const deletable = stale.filter(row => !hasActiveDescendant(row.id)).map(row => row.id);
    if (deletable.length) { const result = purgeResources(deletable); report.expiredTrash = result.resources; }
  }
  if (requested.has('oldVersions')) {
    const resourceIds = db.selectDistinct({ resourceId: schema.versions.resourceId }).from(schema.versions).all().map(x => x.resourceId);
    for (const resourceId of resourceIds) report.oldVersions += trimVersions(resourceId);
  }
  if (requested.has('orphanRows')) {
    const liveResourceIds = db.select({ id: schema.resources.id }).from(schema.resources).all().map(x => x.id);
    report.orphanRows += db.delete(schema.versions).where(notInArray(schema.versions.resourceId, liveResourceIds)).run().changes;
    report.orphanRows += db.delete(schema.collabSnapshots).where(notInArray(schema.collabSnapshots.resourceId, liveResourceIds)).run().changes;
    report.orphanRows += db.delete(schema.collabUpdates).where(notInArray(schema.collabUpdates.resourceId, liveResourceIds)).run().changes;
    report.orphanRows += db.delete(schema.officeRooms).where(notInArray(schema.officeRooms.resourceId, liveResourceIds)).run().changes;
    report.orphanRows += db.delete(schema.comments).where(notInArray(schema.comments.resourceId, liveResourceIds)).run().changes;
    report.orphanRows += db.delete(schema.notifications).where(and(isNotNull(schema.notifications.resourceId), notInArray(schema.notifications.resourceId, liveResourceIds))).run().changes;
  }
  if (requested.has('orphanBlobs') && config.storageDriver !== 's3') {
    const used = new Set(db.select({ key: schema.fileObjects.key }).from(schema.fileObjects).all().map(x => x.key));
    const root = path.resolve(config.localStorageDir);
    for (const key of localBlobKeys()) {
      if (used.has(key)) continue;
      const target = path.resolve(root, key);
      if (!target.startsWith(root + path.sep)) continue;
      try {
        const size = fs.statSync(target).size;
        fs.unlinkSync(target);
        report.orphanBlobs++;
        report.orphanBlobBytes += size;
      } catch { /* 正在使用或不可删除 */ }
    }
  }
  return report;
}

export function databaseStats() {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  const counts: Record<string, number> = {};
  for (const table of tables) counts[table.name] = (sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table.name.replaceAll('"', '""')}"`).get() as { count: number }).count;
  return counts;
}

/** VACUUM INTO 生成一致性的 SQLite 快照，不阻塞当前连接。 */
export function createDatabaseBackup() {
  const directory = path.resolve(config.dataDir, 'backups');
  fs.mkdirSync(directory, { recursive: true });
  const fileName = `app-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const target = path.join(directory, fileName);
  sqlite.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  return { name: fileName, bytes: fs.statSync(target).size, createdAt: now(), path: `data/backups/${fileName}` };
}

export function listDatabaseBackups() {
  const directory = path.resolve(config.dataDir, 'backups');
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => entry.isFile() && /^app-.*\.db$/.test(entry.name)).map(entry => {
    const stat = fs.statSync(path.join(directory, entry.name));
    return { name: entry.name, bytes: stat.size, createdAt: stat.mtime.toISOString(), path: `data/backups/${entry.name}` };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteDatabaseBackup(name: string) {
  if (!/^app-[\dTZ\-.]+\.db$/.test(name)) throw Object.assign(new Error('备份文件名无效'), { statusCode: 400 });
  const target = path.resolve(config.dataDir, 'backups', name);
  const root = path.resolve(config.dataDir, 'backups');
  if (!target.startsWith(root + path.sep)) throw Object.assign(new Error('备份文件名无效'), { statusCode: 400 });
  if (!fs.existsSync(target)) throw Object.assign(new Error('备份不存在'), { statusCode: 404 });
  fs.unlinkSync(target);
  return { ok: true };
}

/** 恢复备份需要停止所有协同连接并覆盖数据库文件；仅在单实例部署中使用。 */
export function restoreDatabaseBackup(name: string) {
  if (!/^app-[\dTZ\-.]+\.db$/.test(name)) throw Object.assign(new Error('备份文件名无效'), { statusCode: 400 });
  const source = path.resolve(config.dataDir, 'backups', name);
  const root = path.resolve(config.dataDir, 'backups');
  if (!source.startsWith(root + path.sep) || !fs.existsSync(source)) throw Object.assign(new Error('备份不存在'), { statusCode: 404 });
  resetRuntimeState();
  const destination = path.resolve(config.databasePath);
  const safetyCopy = `${destination}.before-restore-${Date.now()}`;
  // VACUUM INTO 从当前连接生成包含 WAL 已提交内容的一致性副本，避免直接复制主库文件丢数据。
  sqlite.exec(`VACUUM INTO '${safetyCopy.replaceAll("'", "''")}'`);
  let dbClosed = false;
  try {
    const candidate = new Database(source, { readonly: true });
    const check = candidate.pragma('integrity_check', { simple: true });
    candidate.close();
    if (check !== 'ok') throw Object.assign(new Error('备份完整性检查失败'), { statusCode: 400 });
    sqlite.close();
    dbClosed = true;
    fs.copyFileSync(source, destination);
    for (const stale of [`${destination}-wal`, `${destination}-shm`]) {
      try { fs.unlinkSync(stale); } catch { /* 文件可能不存在 */ }
    }
    reopenDatabase(false);
    dbClosed = false;
  } catch (error) {
    if (dbClosed) {
      // 覆盖失败时先还原安全副本，再重新打开连接，确保进程始终有可用数据库。
      try { fs.copyFileSync(safetyCopy, destination); } catch { /* 还原失败时仍尝试重开原数据库 */ }
      for (const stale of [`${destination}-wal`, `${destination}-shm`]) {
        try { fs.unlinkSync(stale); } catch { /* 文件可能不存在 */ }
      }
      try { reopenDatabase(false); } catch { /* 交由上层报错 */ }
    }
    throw error;
  }
  return { ok: true, requiresRestart: false, safetyCopy: path.basename(safetyCopy) };
}
