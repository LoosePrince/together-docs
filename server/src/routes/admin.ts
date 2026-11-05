import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { audit, requireAccount, requireSiteAdmin } from '../auth.js';
import { config } from '../config.js';
import { hashSecret, id, now, text } from '../utils.js';
import { closeConnectionById, closeConnections, listConnections, runtimeSnapshot } from '../modules/runtime.js';
import { settingDefinitions, siteSettings, updateSiteSettings } from '../modules/settings.js';
import { cleanupData, createDatabaseBackup, databaseStats, deleteDatabaseBackup, listDatabaseBackups, localBlobKeys, purgeResources, restoreDatabaseBackup } from '../modules/maintenance.js';
import { allTypes } from '../modules/types.js';

const ROLES = ['viewer', 'commenter', 'editor', 'manager', 'owner'] as const;
const roleLabels: Record<string, string> = { viewer: '浏览者', commenter: '评论者', editor: '编辑者', manager: '管理员', owner: '所有者' };
const typeLabels: Record<string, string> = { folder: '文件夹', native_document: '原生文档', native_spreadsheet: '原生表格', smart_table: '智能表格', office_document: 'Word 文档', office_spreadsheet: 'Excel 表格', attachment: '附件' };
const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const int = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const bool = (value: unknown) => value === true || value === 'true' || value === 1;

function query(request: any) { return (request.query || {}) as Record<string, string | undefined>; }
function countRows(table: any, where?: any) {
  return Number(db.select({ count: sql<number>`count(*)` }).from(table).where(where).all()[0]?.count || 0);
}
function serializedResource(row: any) {
  return {
    ...row,
    typeLabel: typeLabels[row.type] || row.type,
    state: row.deletedAt ? 'trash' : 'active',
  };
}

async function loadResourceDetail(resourceId: string) {
  const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
  if (!resource) throw fail('资源不存在', 404);
  const owner = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, resource.ownerId) });
  const project = resource.projectId ? await db.query.projects.findFirst({ where: eq(schema.projects.id, resource.projectId) }) : undefined;
  const parent = resource.parentId ? await db.query.resources.findFirst({ where: eq(schema.resources.id, resource.parentId) }) : undefined;
  const file = resource.fileId ? await db.query.fileObjects.findFirst({ where: eq(schema.fileObjects.id, resource.fileId) }) : undefined;
  const members = await db.select({ member: schema.resourceMembers, account: { id: schema.accounts.id, username: schema.accounts.username, displayName: schema.accounts.displayName } })
    .from(schema.resourceMembers).innerJoin(schema.accounts, eq(schema.accounts.id, schema.resourceMembers.accountId))
    .where(eq(schema.resourceMembers.resourceId, resourceId));
  const shares = await db.query.shareLinks.findMany({ where: eq(schema.shareLinks.resourceId, resourceId) });
  const versions = await db.query.versions.findMany({ where: eq(schema.versions.resourceId, resourceId), columns: { data: false }, orderBy: (t, h) => desc(t.createdAt) });
  const [counts] = db.select({
    comments: sql<number>`(select count(*) from comments where resource_id = ${resourceId})`,
    records: sql<number>`(select count(*) from smart_records where resource_id = ${resourceId})`,
    fields: sql<number>`(select count(*) from smart_fields where resource_id = ${resourceId})`,
    views: sql<number>`(select count(*) from smart_views where resource_id = ${resourceId})`,
    rowPolicies: sql<number>`(select count(*) from row_policies where resource_id = ${resourceId})`,
    fieldPolicies: sql<number>`(select count(*) from field_policies where resource_id = ${resourceId})`,
    requests: sql<number>`(select count(*) from permission_requests where resource_id = ${resourceId})`,
    collabUpdates: sql<number>`(select count(*) from collab_updates where resource_id = ${resourceId})`,
  }).from(schema.resources).where(eq(schema.resources.id, resourceId)).limit(1).all();
  return {
    resource: serializedResource(resource),
    owner: owner ? { id: owner.id, username: owner.username, displayName: owner.displayName } : null,
    project: project ? { id: project.id, name: project.name } : null,
    parent: parent ? { id: parent.id, name: parent.name } : null,
    file: file ? { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, sha256: file.sha256, key: file.key, createdAt: file.createdAt } : null,
    members: members.map(row => ({ ...row.member, account: row.account, roleLabel: roleLabels[row.member.role] || row.member.role })),
    shares: shares.map(({ passwordHash, ...share }) => ({ ...share, hasPassword: Boolean(passwordHash) })),
    versions: versions.map(version => ({ ...version, hasFile: Boolean(version.fileId) })),
    counts,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  // ── 总览 ────────────────────────────────────────────────────────────
  app.get('/api/admin/overview', async request => {
    const admin = requireSiteAdmin(request);
    void admin;
    const counts = databaseStats();
    const activeResources = db.select({ type: schema.resources.type, count: sql<number>`count(*)` }).from(schema.resources).where(isNull(schema.resources.deletedAt)).groupBy(schema.resources.type).all();
    const storageSummary = db.select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(size), 0)` }).from(schema.fileObjects).all()[0];
    const recentAudit = await db.select({ log: schema.auditLogs, account: { username: schema.accounts.username, displayName: schema.accounts.displayName } })
      .from(schema.auditLogs).leftJoin(schema.accounts, eq(schema.accounts.id, schema.auditLogs.accountId))
      .orderBy(desc(schema.auditLogs.createdAt)).limit(8);
    return {
      counts: {
        accounts: counts.accounts || 0, activeAccounts: countRows(schema.accounts, isNull(schema.accounts.disabledAt)),
        projects: counts.projects || 0, resources: counts.resources || 0,
        activeResources: activeResources.reduce((sum, row) => sum + Number(row.count), 0),
        trashedResources: countRows(schema.resources, isNotNull(schema.resources.deletedAt)),
        fileObjects: storageSummary?.count || 0, storageBytes: storageSummary?.bytes || 0,
        versions: counts.versions || 0, comments: counts.comments || 0,
        shareLinks: counts.share_links || 0, pendingRequests: countRows(schema.permissionRequests, eq(schema.permissionRequests.status, 'pending')),
        auditLogs: counts.audit_logs || 0, sessions: counts.sessions || 0,
        smartRecords: counts.smart_records || 0, notifications: counts.notifications || 0,
      },
      resourcesByType: activeResources.map(row => ({ type: row.type, label: typeLabels[row.type] || row.type, count: Number(row.count) })),
      runtime: { uptimeSeconds: Math.round(process.uptime()), liveConnections: listConnections().length, status: 'ok' },
      recentAudit: recentAudit.map(row => ({ ...row.log, account: row.account })),
    };
  });

  // ── 文档／资源 ─────────────────────────────────────────────────────
  app.get('/api/admin/resources', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const page = int(q.page, 1, 1, 100000); const pageSize = int(q.pageSize, 20, 1, 100);
    const clauses = [] as any[];
    if (q.search) clauses.push(like(schema.resources.name, `%${q.search.replaceAll('%', '').slice(0, 100)}%`));
    if (q.type) clauses.push(eq(schema.resources.type, q.type));
    if (q.state === 'trash') clauses.push(isNotNull(schema.resources.deletedAt));
    else if (q.state === 'active') clauses.push(isNull(schema.resources.deletedAt));
    if (q.ownerId) clauses.push(eq(schema.resources.ownerId, q.ownerId));
    if (q.projectId) clauses.push(eq(schema.resources.projectId, q.projectId));
    const where = clauses.length ? and(...clauses) : undefined;
    const total = countRows(schema.resources, where);
    const rows = await db.select({ resource: schema.resources, owner: { username: schema.accounts.username, displayName: schema.accounts.displayName }, project: { name: schema.projects.name }, file: { size: schema.fileObjects.size } })
      .from(schema.resources)
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.resources.ownerId))
      .leftJoin(schema.projects, eq(schema.projects.id, schema.resources.projectId))
      .leftJoin(schema.fileObjects, eq(schema.fileObjects.id, schema.resources.fileId))
      .where(where).orderBy(desc(schema.resources.updatedAt)).limit(pageSize).offset((page - 1) * pageSize);
    return {
      items: rows.map(row => ({ ...serializedResource(row.resource), owner: row.owner, project: row.project, fileSize: row.file?.size || 0 })),
      total, page, pageSize,
      types: allTypes().map(driver => ({ type: driver.type, label: driver.label })),
    };
  });

  app.get('/api/admin/resources/:id', async request => {
    requireSiteAdmin(request);
    return loadResourceDetail((request.params as any).id);
  });

  app.patch('/api/admin/resources/:id', async request => {
    const admin = requireSiteAdmin(request); const resourceId = (request.params as any).id;
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
    if (!resource) throw fail('资源不存在', 404);
    const body = request.body as any;
    const patch: Record<string, unknown> = { updatedAt: now() };
    if (body.name !== undefined) patch.name = text(body.name, 1, 100);
    if (body.parentId !== undefined) {
      const parentId = body.parentId || null;
      if (parentId === resourceId) throw fail('不能移动到自身内部');
      if (parentId) {
        const parent = await db.query.resources.findFirst({ where: eq(schema.resources.id, parentId) });
        if (!parent || parent.type !== 'folder' || parent.projectId !== resource.projectId) throw fail('目标文件夹不可用');
      }
      patch.parentId = parentId;
    }
    if (body.projectId !== undefined) {
      const projectId = body.projectId || null;
      if (projectId) {
        const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
        if (!project) throw fail('项目不存在', 404);
      }
      patch.projectId = projectId;
      patch.parentId = null;
    }
    await db.update(schema.resources).set(patch).where(eq(schema.resources.id, resourceId));
    audit(admin.id, 'admin.resource.update', resourceId, { patch });
    return loadResourceDetail(resourceId);
  });

  app.post('/api/admin/resources/:id/transfer', async request => {
    const admin = requireSiteAdmin(request); const resourceId = (request.params as any).id;
    const targetId = text((request.body as any)?.accountId, 1, 100);
    const target = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, targetId) });
    if (!target) throw fail('目标账号不存在', 404);
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
    if (!resource) throw fail('资源不存在', 404);
    await db.update(schema.resources).set({ ownerId: target.id, updatedAt: now() }).where(eq(schema.resources.id, resourceId));
    audit(admin.id, 'admin.resource.transfer', resourceId, { from: resource.ownerId, to: target.id });
    return loadResourceDetail(resourceId);
  });

  app.post('/api/admin/resources/:id/trash', async request => {
    const admin = requireSiteAdmin(request); const resourceId = (request.params as any).id;
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
    if (!resource) throw fail('资源不存在', 404);
    await db.update(schema.resources).set({ deletedAt: bool((request.body as any)?.restore) ? null : now(), updatedAt: now() }).where(eq(schema.resources.id, resourceId));
    audit(admin.id, bool((request.body as any)?.restore) ? 'admin.resource.restore' : 'admin.resource.trash', resourceId);
    return { ok: true };
  });

  app.delete('/api/admin/resources/:id', async request => {
    const admin = requireSiteAdmin(request); const resourceId = (request.params as any).id;
    purgeResources([resourceId]);
    audit(admin.id, 'admin.resource.purge', resourceId);
    return { ok: true };
  });

  app.post('/api/admin/resources/bulk', async request => {
    const admin = requireSiteAdmin(request);
    const body = request.body as any;
    const ids: string[] = Array.isArray(body?.ids) ? [...new Set<string>(body.ids.filter((value: unknown): value is string => typeof value === 'string'))].slice(0, 200) : [];
    if (!ids.length) throw fail('请选择资源');
    const action = body.action as string;
    let affected = 0;
    if (action === 'trash') {
      affected = db.update(schema.resources).set({ deletedAt: now(), updatedAt: now() }).where(inArray(schema.resources.id, ids)).run().changes;
    } else if (action === 'restore') {
      affected = db.update(schema.resources).set({ deletedAt: null, updatedAt: now() }).where(inArray(schema.resources.id, ids)).run().changes;
    } else if (action === 'purge') {
      affected = purgeResources(ids).resources;
    } else if (action === 'transfer') {
      const targetId = text(body.accountId, 1, 100);
      const target = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, targetId) });
      if (!target) throw fail('目标账号不存在', 404);
      affected = db.update(schema.resources).set({ ownerId: target.id, updatedAt: now() }).where(inArray(schema.resources.id, ids)).run().changes;
    } else if (action === 'moveProject') {
      const projectId = body.projectId || null;
      if (projectId) {
        const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
        if (!project) throw fail('项目不存在', 404);
      }
      affected = db.update(schema.resources).set({ projectId, parentId: null, updatedAt: now() }).where(inArray(schema.resources.id, ids)).run().changes;
    } else throw fail('未知批量操作');
    audit(admin.id, 'admin.resource.bulk', undefined, { action, ids, affected });
    return { ok: true, affected };
  });

  app.get('/api/admin/resources/:id/content', async request => {
    requireSiteAdmin(request);
    const resourceId = (request.params as any).id;
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
    if (!resource) throw fail('资源不存在', 404);
    const snapshot = await db.query.collabSnapshots.findFirst({ where: eq(schema.collabSnapshots.resourceId, resourceId) });
    let documentText = '';
    if (snapshot?.data) {
      try {
        const { Doc } = await import('yjs');
        const doc = new Doc();
        const { applyUpdate } = await import('yjs');
        applyUpdate(doc, Buffer.from(snapshot.data, 'base64'));
        const fragment = doc.getXmlFragment('default');
        documentText = fragment.toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
      } catch { documentText = '[协同内容无法解析]'; }
    }
    let spreadsheetCells: Record<string, string> | null = null;
    if (resource.type === 'native_spreadsheet') {
      const spreadsheet = await db.query.versions.findFirst({ where: eq(schema.versions.resourceId, resourceId), orderBy: (t, h) => desc(t.createdAt) });
      if (spreadsheet) {
        try {
          const parsed = JSON.parse(spreadsheet.data);
          if (parsed && typeof parsed === 'object' && parsed.cells && typeof parsed.cells === 'object') spreadsheetCells = parsed.cells;
        } catch { /* 手动版本保存的是 Yjs 状态，不是表格单元格 */ }
      }
    }
    const records = resource.type === 'smart_table'
      ? await db.query.smartRecords.findMany({ where: eq(schema.smartRecords.resourceId, resourceId), limit: 200 })
      : [];
    const fields = resource.type === 'smart_table'
      ? await db.query.smartFields.findMany({ where: eq(schema.smartFields.resourceId, resourceId), orderBy: [asc(schema.smartFields.position)] })
      : [];
    const comments = await db.query.comments.findMany({ where: eq(schema.comments.resourceId, resourceId), limit: 200, orderBy: (t, h) => desc(t.createdAt) });
    return { documentText, spreadsheet: spreadsheetCells, records, fields, comments };
  });

  app.delete('/api/admin/resources/:id/members/:accountId', async request => {
    const admin = requireSiteAdmin(request); const { id: resourceId, accountId } = request.params as any;
    await db.delete(schema.resourceMembers).where(and(eq(schema.resourceMembers.resourceId, resourceId), eq(schema.resourceMembers.accountId, accountId)));
    await db.update(schema.resources).set({ permissionVersion: sql`${schema.resources.permissionVersion} + 1` }).where(eq(schema.resources.id, resourceId));
    audit(admin.id, 'admin.resource.member.remove', resourceId, { accountId });
    return { ok: true };
  });

  app.post('/api/admin/resources/:id/members', async request => {
    const admin = requireSiteAdmin(request); const resourceId = (request.params as any).id;
    const body = request.body as any;
    const targetId = text(body.accountId, 1, 100);
    const target = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, targetId) });
    if (!target) throw fail('账号不存在', 404);
    const role = ROLES.includes(body.role) ? body.role : 'viewer';
    const createdAt = now();
    await db.insert(schema.resourceMembers).values({ id: id(), resourceId, accountId: target.id, role, persona: String(body.persona || '').slice(0, 40), createdAt, updatedAt: createdAt })
      .onConflictDoUpdate({ target: [schema.resourceMembers.resourceId, schema.resourceMembers.accountId], set: { role, persona: String(body.persona || '').slice(0, 40), updatedAt: createdAt } });
    await db.update(schema.resources).set({ permissionVersion: sql`${schema.resources.permissionVersion} + 1` }).where(eq(schema.resources.id, resourceId));
    closeConnections({ accountId: target.id, resourceId });
    audit(admin.id, 'admin.resource.member.upsert', resourceId, { accountId: target.id, role });
    return loadResourceDetail(resourceId);
  });

  // ── 用户与账号 ─────────────────────────────────────────────────────
  app.get('/api/admin/users', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const page = int(q.page, 1, 1, 100000); const pageSize = int(q.pageSize, 20, 1, 100);
    const clauses = [] as any[];
    if (q.search) clauses.push(or(like(schema.accounts.username, `%${q.search.slice(0, 100)}%`), like(schema.accounts.displayName, `%${q.search.slice(0, 100)}%`)));
    if (q.state === 'disabled') clauses.push(isNotNull(schema.accounts.disabledAt));
    else if (q.state === 'active') clauses.push(isNull(schema.accounts.disabledAt));
    const where = clauses.length ? and(...clauses) : undefined;
    const total = countRows(schema.accounts, where);
    const rows = await db.select({ account: schema.accounts }).from(schema.accounts).where(where).orderBy(asc(schema.accounts.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const items = await Promise.all(rows.map(async ({ account }) => {
      const [agg] = db.select({
        ownedResources: sql<number>`(select count(*) from resources where owner_id = ${account.id})`,
        resourceMemberships: sql<number>`(select count(*) from resource_members where account_id = ${account.id})`,
        projectMemberships: sql<number>`(select count(*) from project_members where account_id = ${account.id})`,
        comments: sql<number>`(select count(*) from comments where account_id = ${account.id})`,
        uploads: sql<number>`(select count(*) from file_objects where uploaded_by = ${account.id})`,
        unreadNotifications: sql<number>`(select count(*) from notifications where account_id = ${account.id} and read_at is null)`,
      }).from(schema.accounts).where(eq(schema.accounts.id, account.id)).limit(1).all();
      const sessions = await db.query.sessions.findMany({ where: eq(schema.sessions.accountId, account.id), orderBy: (t, h) => desc(t.createdAt) });
      const lastLogin = await db.query.auditLogs.findFirst({ where: and(eq(schema.auditLogs.accountId, account.id), eq(schema.auditLogs.action, 'login')), orderBy: (t, h) => desc(t.createdAt) });
      return {
        id: account.id, username: account.username, displayName: account.displayName, siteAdmin: account.siteAdmin,
        disabledAt: account.disabledAt, createdAt: account.createdAt, updatedAt: account.updatedAt,
        activeSessions: sessions.filter(session => session.expiresAt > now()).length,
        lastLoginAt: lastLogin?.createdAt || null,
        ...agg,
      };
    }));
    return { items, total, page, pageSize };
  });

  app.post('/api/admin/users', async request => {
    const admin = requireSiteAdmin(request); const body = request.body as any;
    const username = text(body.username, 3, 32).toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_.-]+$/.test(username)) throw fail('用户名仅支持字母、数字和 _ . -');
    const password = text(body.password, 8, 128);
    const createdAt = now(); const accountId = id();
    try {
      await db.insert(schema.accounts).values({ id: accountId, username, displayName: text(body.displayName, 1, 50), passwordHash: hashSecret(password), siteAdmin: false, createdAt, updatedAt: createdAt });
    } catch { throw fail('用户名已存在', 409); }
    audit(admin.id, 'admin.user.create', undefined, { accountId, username });
    return { id: accountId, username };
  });

  app.get('/api/admin/users/:id', async request => {
    requireSiteAdmin(request);
    const accountId = (request.params as any).id;
    const account = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, accountId) });
    if (!account) throw fail('账号不存在', 404);
    const sessions = await db.query.sessions.findMany({ where: eq(schema.sessions.accountId, accountId), orderBy: (t, h) => desc(t.createdAt) });
    const resources = await db.select({ resource: schema.resources }).from(schema.resources).where(eq(schema.resources.ownerId, accountId)).orderBy(desc(schema.resources.updatedAt)).limit(50);
    const projectMemberships = await db.select({ membership: schema.projectMembers, project: { id: schema.projects.id, name: schema.projects.name } })
      .from(schema.projectMembers).innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
      .where(eq(schema.projectMembers.accountId, accountId));
    const resourceMemberships = await db.select({ membership: schema.resourceMembers, resource: { id: schema.resources.id, name: schema.resources.name, type: schema.resources.type } })
      .from(schema.resourceMembers).innerJoin(schema.resources, eq(schema.resources.id, schema.resourceMembers.resourceId))
      .where(eq(schema.resourceMembers.accountId, accountId)).limit(100);
    const logs = await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.accountId, accountId), orderBy: (t, h) => desc(t.createdAt), limit: 50 });
    return {
      account: { id: account.id, username: account.username, displayName: account.displayName, siteAdmin: account.siteAdmin, disabledAt: account.disabledAt, createdAt: account.createdAt, updatedAt: account.updatedAt },
      sessions: sessions.map(session => ({ id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt, active: session.expiresAt > now() })),
      resources: resources.map(row => serializedResource(row.resource)),
      projectMemberships: projectMemberships.map(row => ({ ...row.membership, project: row.project, roleLabel: roleLabels[row.membership.role] || row.membership.role })),
      resourceMemberships: resourceMemberships.map(row => ({ ...row.membership, resource: row.resource, roleLabel: roleLabels[row.membership.role] || row.membership.role })),
      logs,
      liveConnections: listConnections({ accountId }),
    };
  });

  app.patch('/api/admin/users/:id', async request => {
    const admin = requireSiteAdmin(request); const accountId = (request.params as any).id;
    const account = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, accountId) });
    if (!account) throw fail('账号不存在', 404);
    const body = request.body as any;
    const patch: Record<string, unknown> = { updatedAt: now() };
    if (body.displayName !== undefined) patch.displayName = text(body.displayName, 1, 50);
    if (body.username !== undefined) {
      const username = text(body.username, 3, 32).toLowerCase();
      if (!/^[a-z0-9_][a-z0-9_.-]+$/.test(username)) throw fail('用户名仅支持字母、数字和 _ . -');
      patch.username = username;
    }
    if (body.siteAdmin !== undefined) {
      if (!bool(body.siteAdmin) && account.siteAdmin) {
        const otherAdmins = countRows(schema.accounts, and(eq(schema.accounts.siteAdmin, true), isNull(schema.accounts.disabledAt)));
        if (otherAdmins <= 1) throw fail('必须保留至少一位启用状态的站长');
      }
      patch.siteAdmin = bool(body.siteAdmin);
    }
    if (body.disabled !== undefined) {
      const disabled = bool(body.disabled);
      if (disabled && account.siteAdmin && account.id === admin.id) throw fail('不能禁用当前登录的站长账号');
      patch.disabledAt = disabled ? now() : null;
      if (disabled) { db.delete(schema.sessions).where(eq(schema.sessions.accountId, accountId)).run(); closeConnections({ accountId }); }
    }
    try { await db.update(schema.accounts).set(patch).where(eq(schema.accounts.id, accountId)); }
    catch { throw fail('用户名已存在', 409); }
    audit(admin.id, 'admin.user.update', undefined, { accountId, patch });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/password', async request => {
    const admin = requireSiteAdmin(request); const accountId = (request.params as any).id;
    const account = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, accountId) });
    if (!account) throw fail('账号不存在', 404);
    const password = text((request.body as any)?.password, 8, 128);
    await db.update(schema.accounts).set({ passwordHash: hashSecret(password), updatedAt: now() }).where(eq(schema.accounts.id, accountId));
    db.delete(schema.sessions).where(eq(schema.sessions.accountId, accountId)).run();
    closeConnections({ accountId });
    audit(admin.id, 'admin.user.password', undefined, { accountId });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/logout', async request => {
    const admin = requireSiteAdmin(request); const accountId = (request.params as any).id;
    const count = db.delete(schema.sessions).where(eq(schema.sessions.accountId, accountId)).run().changes;
    closeConnections({ accountId });
    audit(admin.id, 'admin.user.logout', undefined, { accountId, sessions: count });
    return { ok: true, sessions: count };
  });

  // ── 项目、邀请、申请、评论 ───────────────────────────────────────────
  app.get('/api/admin/projects', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const page = int(q.page, 1, 1, 100000); const pageSize = int(q.pageSize, 20, 1, 100);
    const where = q.search ? like(schema.projects.name, `%${q.search.slice(0, 100)}%`) : undefined;
    const total = countRows(schema.projects, where);
    const rows = await db.select({ project: schema.projects, owner: { username: schema.accounts.username, displayName: schema.accounts.displayName } })
      .from(schema.projects).leftJoin(schema.accounts, eq(schema.accounts.id, schema.projects.ownerId))
      .where(where).orderBy(desc(schema.projects.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const items = await Promise.all(rows.map(async row => ({
      ...row.project, owner: row.owner,
      memberCount: countRows(schema.projectMembers, eq(schema.projectMembers.projectId, row.project.id)),
      resourceCount: countRows(schema.resources, eq(schema.resources.projectId, row.project.id)),
    })));
    return { items, total, page, pageSize };
  });

  app.get('/api/admin/projects/:id', async request => {
    requireSiteAdmin(request); const projectId = (request.params as any).id;
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) throw fail('项目不存在', 404);
    const members = await db.select({ member: schema.projectMembers, account: { id: schema.accounts.id, username: schema.accounts.username, displayName: schema.accounts.displayName } })
      .from(schema.projectMembers).innerJoin(schema.accounts, eq(schema.accounts.id, schema.projectMembers.accountId))
      .where(eq(schema.projectMembers.projectId, projectId));
    const resources = await db.query.resources.findMany({ where: eq(schema.resources.projectId, projectId), orderBy: (t, h) => desc(t.updatedAt) });
    return { project, members: members.map(row => ({ ...row.member, account: row.account, roleLabel: roleLabels[row.member.role] || row.member.role })), resources: resources.map(serializedResource) };
  });

  app.post('/api/admin/projects/:id/members', async request => {
    const admin = requireSiteAdmin(request); const projectId = (request.params as any).id;
    const body = request.body as any;
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) throw fail('项目不存在', 404);
    const target = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, text(body.accountId, 1, 100)) });
    if (!target) throw fail('账号不存在', 404);
    const role = ROLES.includes(body.role) ? body.role : 'viewer'; const createdAt = now();
    await db.insert(schema.projectMembers).values({ id: id(), projectId, accountId: target.id, role, persona: String(body.persona || '').slice(0, 40), createdAt, updatedAt: createdAt })
      .onConflictDoUpdate({ target: [schema.projectMembers.projectId, schema.projectMembers.accountId], set: { role, updatedAt: createdAt } });
    audit(admin.id, 'admin.project.member.upsert', undefined, { projectId, accountId: target.id, role });
    return { ok: true };
  });

  app.delete('/api/admin/projects/:id/members/:accountId', async request => {
    const admin = requireSiteAdmin(request); const { id: projectId, accountId } = request.params as any;
    await db.delete(schema.projectMembers).where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.accountId, accountId)));
    audit(admin.id, 'admin.project.member.remove', undefined, { projectId, accountId });
    return { ok: true };
  });

  app.post('/api/admin/projects/:id/archive', async request => {
    const admin = requireSiteAdmin(request); const projectId = (request.params as any).id;
    const archivedAt = bool((request.body as any)?.restore) ? null : now();
    await db.update(schema.projects).set({ archivedAt, updatedAt: now() }).where(eq(schema.projects.id, projectId));
    audit(admin.id, archivedAt ? 'admin.project.archive' : 'admin.project.restore', undefined, { projectId });
    return { ok: true };
  });

  app.delete('/api/admin/projects/:id', async request => {
    const admin = requireSiteAdmin(request); const projectId = (request.params as any).id;
    const owned = await db.query.resources.findMany({ where: eq(schema.resources.projectId, projectId) });
    if (owned.length) throw fail('项目内仍有资源，请先转移或永久删除资源', 409);
    db.transaction(tx => {
      tx.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, projectId)).run();
      tx.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
    });
    audit(admin.id, 'admin.project.delete', undefined, { projectId });
    return { ok: true };
  });

  app.get('/api/admin/invites', async request => {
    requireSiteAdmin(request);
    const usedAccounts = db.select({ id: schema.accounts.id, username: schema.accounts.username }).from(schema.accounts).as('used_accounts');
    return db.select({ invite: schema.invites, creator: { username: schema.accounts.username }, usedByAccount: { username: usedAccounts.username } })
      .from(schema.invites)
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.invites.createdBy))
      .leftJoin(usedAccounts, eq(usedAccounts.id, schema.invites.usedBy))
      .orderBy(desc(schema.invites.createdAt));
  });

  app.get('/api/admin/requests', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const where = q.status ? eq(schema.permissionRequests.status, q.status) : undefined;
    const rows = await db.select({ request: schema.permissionRequests, resource: { id: schema.resources.id, name: schema.resources.name }, applicant: { id: schema.accounts.id, username: schema.accounts.username, displayName: schema.accounts.displayName } })
      .from(schema.permissionRequests)
      .leftJoin(schema.resources, eq(schema.resources.id, schema.permissionRequests.resourceId))
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.permissionRequests.accountId))
      .where(where).orderBy(desc(schema.permissionRequests.createdAt)).limit(200);
    return rows;
  });

  app.get('/api/admin/comments', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const clauses = [] as any[];
    if (q.search) clauses.push(like(schema.comments.content, `%${q.search.slice(0, 100)}%`));
    if (q.resourceId) clauses.push(eq(schema.comments.resourceId, q.resourceId));
    const where = clauses.length ? and(...clauses) : undefined;
    return db.select({ comment: schema.comments, resource: { id: schema.resources.id, name: schema.resources.name }, account: { username: schema.accounts.username, displayName: schema.accounts.displayName } })
      .from(schema.comments)
      .leftJoin(schema.resources, eq(schema.resources.id, schema.comments.resourceId))
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.comments.accountId))
      .where(where).orderBy(desc(schema.comments.createdAt)).limit(200);
  });

  app.patch('/api/admin/comments/:id', async request => {
    const admin = requireSiteAdmin(request); const commentId = (request.params as any).id;
    const body = request.body as any;
    const patch: Record<string, unknown> = { updatedAt: now() };
    if (body.content !== undefined) patch.content = text(body.content, 1, 2000);
    if (body.resolved !== undefined) patch.resolved = bool(body.resolved);
    await db.update(schema.comments).set(patch).where(eq(schema.comments.id, commentId));
    audit(admin.id, 'admin.comment.update', undefined, { commentId, patch });
    return { ok: true };
  });

  app.delete('/api/admin/comments/:id', async request => {
    const admin = requireSiteAdmin(request); const commentId = (request.params as any).id;
    await db.delete(schema.comments).where(eq(schema.comments.id, commentId));
    audit(admin.id, 'admin.comment.delete', undefined, { commentId });
    return { ok: true };
  });

  app.get('/api/admin/shares', async request => {
    requireSiteAdmin(request);
    const rows = await db.select({ share: schema.shareLinks, resource: { id: schema.resources.id, name: schema.resources.name }, creator: { username: schema.accounts.username } })
      .from(schema.shareLinks)
      .leftJoin(schema.resources, eq(schema.resources.id, schema.shareLinks.resourceId))
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.shareLinks.createdBy))
      .orderBy(desc(schema.shareLinks.createdAt));
    return rows.map(row => ({ ...row.share, passwordHash: undefined, hasPassword: Boolean(row.share.passwordHash), resource: row.resource, creator: row.creator }));
  });

  app.patch('/api/admin/shares/:id', async request => {
    const admin = requireSiteAdmin(request); const shareId = (request.params as any).id;
    const share = await db.query.shareLinks.findFirst({ where: eq(schema.shareLinks.id, shareId) });
    if (!share) throw fail('分享链接不存在', 404);
    const body = request.body as any;
    const patch: Record<string, unknown> = {};
    if (body.enabled !== undefined) patch.enabled = bool(body.enabled);
    if (body.allowApply !== undefined) patch.allowApply = bool(body.allowApply);
    if (body.requireApproval !== undefined) patch.requireApproval = bool(body.requireApproval);
    if (body.allowView !== undefined) patch.allowView = bool(body.allowView);
    if (body.clearPassword) patch.passwordHash = null;
    else if (body.password) patch.passwordHash = hashSecret(text(body.password, 4, 100));
    await db.update(schema.shareLinks).set(patch).where(eq(schema.shareLinks.id, shareId));
    audit(admin.id, 'admin.share.update', share.resourceId, { shareId, patch: Object.keys(patch) });
    return { ok: true };
  });

  app.delete('/api/admin/shares/:id', async request => {
    const admin = requireSiteAdmin(request); const shareId = (request.params as any).id;
    const share = await db.query.shareLinks.findFirst({ where: eq(schema.shareLinks.id, shareId) });
    if (!share) throw fail('分享链接不存在', 404);
    await db.delete(schema.shareLinks).where(eq(schema.shareLinks.id, shareId));
    audit(admin.id, 'admin.share.delete', share.resourceId, { shareId });
    return { ok: true };
  });

  // ── 站点配置 ───────────────────────────────────────────────────────
  app.get('/api/admin/settings', async request => {
    requireSiteAdmin(request);
    return {
      values: siteSettings(),
      definitions: settingDefinitions.map(({ envFallback, ...definition }) => definition),
      environment: {
        port: config.port, host: config.host, dataDir: config.dataDir, databasePath: config.databasePath,
        storageDriver: config.storageDriver, localStorageDir: config.localStorageDir,
        maxUploadBytesFromEnv: config.maxUploadBytes, sessionDaysFromEnv: config.sessionDays,
        corsOrigins: config.corsOrigins, publicUrl: config.publicUrl,
        s3Bucket: config.s3.bucket || null, s3Endpoint: config.s3.endpoint || null, s3Region: config.s3.region,
        secretConfigured: config.secret !== 'development-only-change-this-secret-before-deploying',
        nodeEnv: process.env.NODE_ENV || 'development',
      },
      updatedAt: db.select().from(schema.siteSettings).all().reduce((latest, row) => row.updatedAt > latest ? row.updatedAt : latest, ''),
    };
  });

  app.patch('/api/admin/settings', async request => {
    const admin = requireSiteAdmin(request);
    const values = updateSiteSettings((request.body as any)?.values || {});
    audit(admin.id, 'admin.settings.update', undefined, { keys: Object.keys((request.body as any)?.values || {}) });
    return { ok: true, values };
  });

  app.get('/api/public-settings', async () => {
    const { siteName, siteDescription, registrationMode } = siteSettings();
    return { siteName, siteDescription, registrationMode };
  });

  // ── 数据与文件 ─────────────────────────────────────────────────────
  app.get('/api/admin/data', async request => {
    requireSiteAdmin(request);
    const counts = databaseStats();
    const blobs = config.storageDriver === 's3' ? [] : localBlobKeys();
    const usedKeys = new Set(db.select({ key: schema.fileObjects.key }).from(schema.fileObjects).all().map(row => row.key));
    const files = await db.query.fileObjects.findMany({ orderBy: (t, h) => desc(t.createdAt), limit: 100 });
    const versions = await db.query.versions.findMany({ columns: { data: false }, orderBy: (t, h) => desc(t.createdAt), limit: 20 });
    let orphanBlobCount = 0; let orphanBlobBytes = 0;
    if (config.storageDriver !== 's3') {
      const root = path.resolve(config.localStorageDir);
      for (const key of blobs) {
        if (usedKeys.has(key)) continue;
        orphanBlobCount++;
        try { orphanBlobBytes += fs.statSync(path.resolve(root, key)).size; } catch { /* 文件已消失 */ }
      }
    }
    return {
      counts, tableSizes: counts,
      database: { path: config.databasePath, bytes: fs.existsSync(config.databasePath) ? fs.statSync(config.databasePath).size : 0 },
      storage: { driver: config.storageDriver, localBlobCount: blobs.length, orphanBlobCount, orphanBlobBytes, s3Bucket: config.s3.bucket || null },
      files, versions, backups: listDatabaseBackups(),
      documentTypes: allTypes().map(({ type, label, extensions, editor, canExport }) => ({ type, label, extensions, editor, canExport })),
    };
  });

  app.get('/api/admin/files', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const page = int(q.page, 1, 1, 100000); const pageSize = int(q.pageSize, 20, 1, 100);
    const where = q.search ? or(like(schema.fileObjects.name, `%${q.search.slice(0, 100)}%`), like(schema.fileObjects.sha256, `%${q.search.slice(0, 100)}%`)) : undefined;
    const total = countRows(schema.fileObjects, where);
    const rows = await db.select({ file: schema.fileObjects, uploader: { username: schema.accounts.username, displayName: schema.accounts.displayName } })
      .from(schema.fileObjects).leftJoin(schema.accounts, eq(schema.accounts.id, schema.fileObjects.uploadedBy))
      .where(where).orderBy(desc(schema.fileObjects.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const items = rows.map(row => ({
      ...row.file, uploader: row.uploader,
      resourceCount: countRows(schema.resources, eq(schema.resources.fileId, row.file.id)),
      versionCount: countRows(schema.versions, eq(schema.versions.fileId, row.file.id)),
      existsOnDisk: config.storageDriver === 's3' ? null : fs.existsSync(path.resolve(config.localStorageDir, row.file.key)),
    }));
    return { items, total, page, pageSize };
  });

  app.get('/api/admin/files/:id/download', async (request, reply) => {
    requireSiteAdmin(request);
    const file = await db.query.fileObjects.findFirst({ where: eq(schema.fileObjects.id, (request.params as any).id) });
    if (!file) throw fail('文件不存在', 404);
    const { storage } = await import('../modules/storage.js');
    reply.header('Content-Type', file.mimeType).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`).header('X-Content-Type-Options', 'nosniff');
    return reply.send(await storage.createReadStream(file.key));
  });

  app.delete('/api/admin/files/:id', async request => {
    const admin = requireSiteAdmin(request); const fileId = (request.params as any).id;
    const file = await db.query.fileObjects.findFirst({ where: eq(schema.fileObjects.id, fileId) });
    if (!file) throw fail('文件不存在', 404);
    if (countRows(schema.resources, eq(schema.resources.fileId, fileId)) || countRows(schema.versions, eq(schema.versions.fileId, fileId))) {
      throw fail('文件仍被资源或历史版本引用，请先删除关联资源', 409);
    }
    await db.delete(schema.fileObjects).where(eq(schema.fileObjects.id, fileId));
    audit(admin.id, 'admin.file.delete', undefined, { fileId, key: file.key });
    return { ok: true };
  });

  app.post('/api/admin/backups', async request => {
    const admin = requireSiteAdmin(request);
    const backup = createDatabaseBackup();
    audit(admin.id, 'admin.backup.create', undefined, { name: backup.name });
    return backup;
  });

  app.get('/api/admin/backups/:name/download', async (request, reply: FastifyReply) => {
    requireSiteAdmin(request);
    const name = (request.params as any).name;
    if (!/^app-[\dTZ\-.]+\.db$/.test(name)) throw fail('备份文件名无效');
    const target = path.resolve(config.dataDir, 'backups', name);
    if (!target.startsWith(path.resolve(config.dataDir, 'backups') + path.sep) || !fs.existsSync(target)) throw fail('备份不存在', 404);
    reply.header('Content-Type', 'application/x-sqlite3').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(fs.createReadStream(target));
  });

  app.delete('/api/admin/backups/:name', async request => {
    const admin = requireSiteAdmin(request);
    const name = (request.params as any).name;
    const result = deleteDatabaseBackup(name);
    audit(admin.id, 'admin.backup.delete', undefined, { name });
    return result;
  });

  app.post('/api/admin/backups/:name/restore', async request => {
    const admin = requireSiteAdmin(request);
    const result = restoreDatabaseBackup((request.params as any).name);
    audit(admin.id, 'admin.backup.restore', undefined, { name: (request.params as any).name });
    return result;
  });

  app.post('/api/admin/maintenance', async request => {
    const admin = requireSiteAdmin(request);
    const actions = (request.body as any)?.actions;
    if (!Array.isArray(actions)) throw fail('请选择清理项目');
    const allowed = ['expiredSessions', 'expiredInvites', 'expiredTrash', 'oldVersions', 'orphanRows', 'orphanBlobs'];
    const filtered = actions.filter((action: unknown) => typeof action === 'string' && allowed.includes(action));
    if (!filtered.length || filtered.length !== actions.length) throw fail('清理项目无效');
    const report = cleanupData(filtered);
    audit(admin.id, 'admin.maintenance', undefined, { actions: filtered, report });
    return { ok: true, report };
  });

  // ── 运行状态 ───────────────────────────────────────────────────────
  app.get('/api/admin/runtime', async request => {
    requireSiteAdmin(request);
    const detailed = bool(query(request).detailed);
    const snapshot = runtimeSnapshot();
    const connections = listConnections().map(connection => {
      const [account] = db.select({ username: schema.accounts.username, displayName: schema.accounts.displayName }).from(schema.accounts).where(eq(schema.accounts.id, connection.accountId)).limit(1).all();
      const [resource] = db.select({ name: schema.resources.name }).from(schema.resources).where(eq(schema.resources.id, connection.resourceId)).limit(1).all();
      return { ...connection, account, resource };
    });
    return { ...snapshot, connections, detailed };
  });

  app.delete('/api/admin/connections/:id', async request => {
    const admin = requireSiteAdmin(request); const connectionId = (request.params as any).id;
    if (!closeConnectionById(connectionId)) throw fail('连接不存在或已关闭', 404);
    audit(admin.id, 'admin.connection.close', undefined, { connectionId });
    return { ok: true };
  });

  app.post('/api/admin/connections/close', async request => {
    const admin = requireSiteAdmin(request);
    const body = request.body as any;
    const count = closeConnections({ accountId: body?.accountId || undefined, resourceId: body?.resourceId || undefined, kind: body?.kind || undefined });
    audit(admin.id, 'admin.connection.closeBulk', undefined, { count, filter: body });
    return { ok: true, count };
  });

  app.get('/api/admin/audit', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const page = int(q.page, 1, 1, 100000); const pageSize = int(q.pageSize, 50, 1, 500);
    const clauses = [] as any[];
    if (q.action) clauses.push(like(schema.auditLogs.action, `%${q.action.slice(0, 100)}%`));
    if (q.accountId) clauses.push(eq(schema.auditLogs.accountId, q.accountId));
    if (q.resourceId) clauses.push(eq(schema.auditLogs.resourceId, q.resourceId));
    if (q.search) clauses.push(or(like(schema.auditLogs.action, `%${q.search.slice(0, 100)}%`), like(schema.auditLogs.detailJson, `%${q.search.slice(0, 100)}%`)));
    const where = clauses.length ? and(...clauses) : undefined;
    const total = countRows(schema.auditLogs, where);
    const rows = await db.select({ log: schema.auditLogs, account: { username: schema.accounts.username, displayName: schema.accounts.displayName }, resource: { name: schema.resources.name } })
      .from(schema.auditLogs)
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.auditLogs.accountId))
      .leftJoin(schema.resources, eq(schema.resources.id, schema.auditLogs.resourceId))
      .where(where).orderBy(desc(schema.auditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const actions = await db.select({ action: schema.auditLogs.action, count: sql<number>`count(*)` }).from(schema.auditLogs).groupBy(schema.auditLogs.action).orderBy(desc(sql`count(*)`)).limit(30);
    return { items: rows, total, page, pageSize, actions };
  });

  app.get('/api/admin/sessions', async request => {
    requireSiteAdmin(request);
    const q = query(request);
    const page = int(q.page, 1, 1, 100000); const pageSize = int(q.pageSize, 20, 1, 100);
    const where = q.expired === 'true' ? sql`${schema.sessions.expiresAt} <= ${now()}` : q.expired === 'false' ? sql`${schema.sessions.expiresAt} > ${now()}` : undefined;
    const total = countRows(schema.sessions, where);
    const rows = await db.select({ session: schema.sessions, account: { username: schema.accounts.username, displayName: schema.accounts.displayName } })
      .from(schema.sessions).leftJoin(schema.accounts, eq(schema.accounts.id, schema.sessions.accountId))
      .where(where).orderBy(desc(schema.sessions.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    return { items: rows, total, page, pageSize };
  });

  app.delete('/api/admin/sessions/:id', async request => {
    const admin = requireSiteAdmin(request); const sessionId = (request.params as any).id;
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    audit(admin.id, 'admin.session.revoke', undefined, { sessionId });
    return { ok: true };
  });

  // 保留旧接口的兼容返回（列表）；更完整的数据由 /api/admin/audit 提供
  app.get('/api/admin/accounts', async request => {
    requireSiteAdmin(request);
    return db.query.accounts.findMany({ columns: { passwordHash: false } });
  });
}
