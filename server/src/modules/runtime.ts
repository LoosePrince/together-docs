import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';

export type ConnectionKind = 'document' | 'office';
export interface LiveConnection {
  id: string;
  kind: ConnectionKind;
  resourceId: string;
  accountId: string;
  role: string;
  connectedAt: string;
  socket?: any;
  close: () => void;
}
export interface RoomSummary {
  resourceId: string;
  kind: ConnectionKind;
  clients: number;
  detail?: Record<string, unknown>;
}

let counter = 0;
const connections = new Map<string, LiveConnection>();
const roomProviders = new Set<() => RoomSummary[]>();

export function registerConnection(info: Omit<LiveConnection, 'id' | 'connectedAt'>) {
  const id = `conn-${++counter}`;
  const connection: LiveConnection = { ...info, id, connectedAt: new Date().toISOString() };
  connections.set(id, connection);
  return Object.assign(() => { if (connections.get(id) === connection) connections.delete(id); }, {
    id,
    updateRole(role: string) { connection.role = role; },
  });
}

export function registerRoomProvider(provider: () => RoomSummary[]) {
  roomProviders.add(provider);
  return () => roomProviders.delete(provider);
}

export function pruneClosedConnections() {
  for (const [id, connection] of connections) {
    const state = (connection as any).socket?.readyState;
    // CLOSING / CLOSED；没有 socket 探针时保留
    if (state === 2 || state === 3) connections.delete(id);
  }
}

export function listConnections(filter: { accountId?: string; resourceId?: string; kind?: ConnectionKind } = {}) {
  pruneClosedConnections();
  return [...connections.values()]
    .filter(c => (!filter.accountId || c.accountId === filter.accountId) && (!filter.resourceId || c.resourceId === filter.resourceId) && (!filter.kind || c.kind === filter.kind))
    .map(({ close, socket, ...connection }) => connection);
}

export function closeConnections(filter: { accountId?: string; resourceId?: string; kind?: ConnectionKind } = {}) {
  pruneClosedConnections();
  const targets = [...connections.values()].filter(c =>
    (!filter.accountId || c.accountId === filter.accountId) && (!filter.resourceId || c.resourceId === filter.resourceId) && (!filter.kind || c.kind === filter.kind));
  for (const connection of targets) {
    try { connection.close(); } catch { /* 连接可能已经关闭 */ }
    connections.delete(connection.id);
  }
  return targets.length;
}

export function closeConnectionById(id: string) {
  pruneClosedConnections();
  const connection = connections.get(id);
  if (!connection) return false;
  try { connection.close(); } catch { /* 连接可能已经关闭 */ }
  connections.delete(id);
  return true;
}

export function roomSummaries(): RoomSummary[] {
  return [...roomProviders].flatMap(provider => { try { return provider(); } catch { return []; } });
}

const requestStats = { total: 0, errors: 0, durationMs: 0, startedAt: new Date().toISOString(), statusCodes: {} as Record<string, number> };
export function recordRequest(statusCode: number, durationMs: number) {
  requestStats.total++;
  requestStats.durationMs += durationMs;
  if (statusCode >= 400) requestStats.errors++;
  const bucket = `${Math.floor(statusCode / 100)}xx`;
  requestStats.statusCodes[bucket] = (requestStats.statusCodes[bucket] || 0) + 1;
}
export function requestStatsSnapshot() {
  return { ...requestStats, statusCodes: { ...requestStats.statusCodes }, averageDurationMs: requestStats.total ? Math.round(requestStats.durationMs / requestStats.total * 100) / 100 : 0 };
}

function fileSize(target: string) {
  try { return fs.statSync(target).size; } catch { return 0; }
}
function directoryUsage(target: string, depth = 0): { files: number; bytes: number } {
  let files = 0; let bytes = 0;
  try {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) { if (depth < 8) { const nested = directoryUsage(full, depth + 1); files += nested.files; bytes += nested.bytes; } }
      else if (entry.isFile()) { files++; bytes += fileSize(full); }
    }
  } catch { /* 目录不存在或不可读 */ }
  return { files, bytes };
}

export function runtimeSnapshot() {
  const memory = process.memoryUsage();
  const usage = directoryUsage(path.resolve(config.localStorageDir));
  const database = fileSize(path.resolve(config.databasePath));
  const wal = fileSize(`${path.resolve(config.databasePath)}-wal`);
  const pageCount = sqlite.pragma('page_count', { simple: true }) as number;
  const pageSize = sqlite.pragma('page_size', { simple: true }) as number;
  return {
    status: 'ok',
    startedAt: requestStats.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    process: {
      pid: process.pid, nodeVersion: process.version, platform: process.platform, arch: process.arch,
      nodeEnv: process.env.NODE_ENV || 'development',
      memoryRssBytes: memory.rss, memoryHeapUsedBytes: memory.heapUsed, memoryHeapTotalBytes: memory.heapTotal,
      cpuCount: os.cpus().length, loadAverage: os.loadavg(), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(),
    },
    database: {
      path: config.databasePath, bytes: database, walBytes: wal, pageCount, pageSize,
      journalMode: sqlite.pragma('journal_mode', { simple: true }),
      foreignKeys: Boolean(sqlite.pragma('foreign_keys', { simple: true })),
      busyTimeout: sqlite.pragma('busy_timeout', { simple: true }),
      sqliteVersion: sqlite.prepare('select sqlite_version() as version').get() as { version: string },
    },
    storage: {
      driver: config.storageDriver, localStorageDir: config.localStorageDir, blobFiles: usage.files, blobBytes: usage.bytes,
      s3Bucket: config.s3.bucket || null, s3Configured: Boolean(config.s3.bucket),
      localScanAvailable: config.storageDriver !== 's3',
    },
    collaboration: {
      liveConnections: listConnections().length,
      documentConnections: listConnections({ kind: 'document' }).length,
      officeConnections: listConnections({ kind: 'office' }).length,
      rooms: roomSummaries(),
    },
    http: requestStatsSnapshot(),
  };
}

export function resetRuntimeState() { closeConnections(); }
