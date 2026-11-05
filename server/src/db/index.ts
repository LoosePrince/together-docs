import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const sqlite = new Database(config.databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, site_admin INTEGER NOT NULL DEFAULT 0, disabled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, expires_at TEXT NOT NULL, used_by TEXT, used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL REFERENCES accounts(id), archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_members (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'editor', persona TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', locked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, account_id));
CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id), project_id TEXT REFERENCES projects(id), parent_id TEXT, mime_type TEXT, file_id TEXT, permission_version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS resources_project_idx ON resources(project_id);
CREATE TABLE IF NOT EXISTS resource_members (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, role TEXT NOT NULL, persona TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', locked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(resource_id, account_id));
CREATE TABLE IF NOT EXISTS share_links (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, scope TEXT NOT NULL DEFAULT 'both', allow_apply INTEGER NOT NULL DEFAULT 1, require_approval INTEGER NOT NULL DEFAULT 1, expires_at TEXT, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS permission_requests (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, share_id TEXT NOT NULL, account_id TEXT NOT NULL, scope TEXT NOT NULL, role TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS smart_fields (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS smart_records (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, values_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS smart_records_resource_idx ON smart_records(resource_id);
CREATE TABLE IF NOT EXISTS row_policies (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES smart_records(id) ON DELETE CASCADE, account_id TEXT NOT NULL, access TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(record_id, account_id));
CREATE TABLE IF NOT EXISTS field_policies (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, field_id TEXT NOT NULL REFERENCES smart_fields(id) ON DELETE CASCADE, account_id TEXT NOT NULL, access TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(field_id, account_id));
CREATE TABLE IF NOT EXISTS file_objects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, file_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collab_snapshots (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collab_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, resource_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS office_rooms (resource_id TEXT PRIMARY KEY, format TEXT NOT NULL, seed TEXT NOT NULL, checkpoint TEXT, checkpoint_frame INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS smart_views (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'grid', configuration_json TEXT NOT NULL DEFAULT '{}', is_public INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, account_id TEXT NOT NULL, persona_snapshot TEXT NOT NULL DEFAULT '', anchor TEXT, content TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, mentions_json TEXT NOT NULL DEFAULT '[]', parent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', resource_id TEXT, read_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(resource_id, account_id));
CREATE TABLE IF NOT EXISTS recent_visits (resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, visited_at TEXT NOT NULL, PRIMARY KEY(resource_id, account_id));
CREATE INDEX IF NOT EXISTS comments_resource_idx ON comments(resource_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_account_idx ON notifications(account_id, read_at, created_at);
`);
// 已有部署的轻量迁移：这里只添加新增列，不重建原有数据表。
const shareColumns = sqlite.prepare('PRAGMA table_info(share_links)').all() as { name: string }[];
const addColumn = (name: string, definition: string) => {
  if (!shareColumns.some(column => column.name === name)) sqlite.exec(`ALTER TABLE share_links ADD COLUMN ${name} ${definition}`);
};
addColumn('default_role', "TEXT NOT NULL DEFAULT 'viewer'");
addColumn('password_hash', 'TEXT');
addColumn('allow_view', 'INTEGER NOT NULL DEFAULT 0');

export const db = drizzle(sqlite, { schema });
export { schema };
