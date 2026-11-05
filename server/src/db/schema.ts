import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(), passwordHash: text('password_hash').notNull(),
  siteAdmin: integer('site_admin', { mode: 'boolean' }).notNull().default(false),
  disabledAt: text('disabled_at'), ...timestamps,
});
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), expiresAt: text('expires_at').notNull(), createdAt: text('created_at').notNull(),
});
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(), createdBy: text('created_by').notNull(),
  expiresAt: text('expires_at').notNull(), usedBy: text('used_by'), usedAt: text('used_at'), revokedAt: text('revoked_at'), createdAt: text('created_at').notNull(),
});
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), name: text('name').notNull(), description: text('description').notNull().default(''),
  ownerId: text('owner_id').notNull().references(() => accounts.id), archivedAt: text('archived_at'), ...timestamps,
});
export const projectMembers = sqliteTable('project_members', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('editor'), persona: text('persona').notNull().default(''),
  tagsJson: text('tags_json').notNull().default('[]'), locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});
export const resources = sqliteTable('resources', {
  id: text('id').primaryKey(), name: text('name').notNull(), type: text('type').notNull(),
  ownerId: text('owner_id').notNull().references(() => accounts.id), projectId: text('project_id').references(() => projects.id),
  parentId: text('parent_id'), mimeType: text('mime_type'), fileId: text('file_id'), permissionVersion: integer('permission_version').notNull().default(1),
  deletedAt: text('deleted_at'), ...timestamps,
});
export const resourceMembers = sqliteTable('resource_members', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), persona: text('persona').notNull().default(''), tagsJson: text('tags_json').notNull().default('[]'),
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false), ...timestamps,
});
export const shareLinks = sqliteTable('share_links', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(), createdBy: text('created_by').notNull(), enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  scope: text('scope').notNull().default('both'), allowApply: integer('allow_apply', { mode: 'boolean' }).notNull().default(true),
  requireApproval: integer('require_approval', { mode: 'boolean' }).notNull().default(true), defaultRole: text('default_role').notNull().default('viewer'),
  passwordHash: text('password_hash'), allowView: integer('allow_view', { mode: 'boolean' }).notNull().default(false), expiresAt: text('expires_at'),
  maxUses: integer('max_uses'), uses: integer('uses').notNull().default(0), createdAt: text('created_at').notNull(),
});
export const permissionRequests = sqliteTable('permission_requests', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  shareId: text('share_id').notNull(), accountId: text('account_id').notNull(), scope: text('scope').notNull(), role: text('role').notNull(),
  message: text('message').notNull().default(''), status: text('status').notNull().default('pending'),
  reviewedBy: text('reviewed_by'), reviewedAt: text('reviewed_at'), ...timestamps,
});
export const smartFields = sqliteTable('smart_fields', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), type: text('type').notNull(), optionsJson: text('options_json').notNull().default('{}'), position: integer('position').notNull(),
});
export const smartViews = sqliteTable('smart_views', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), type: text('type').notNull().default('grid'), configurationJson: text('configuration_json').notNull().default('{}'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true), position: integer('position').notNull().default(0), createdAt: text('created_at').notNull(),
});
export const smartRecords = sqliteTable('smart_records', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  valuesJson: text('values_json').notNull().default('{}'), createdBy: text('created_by').notNull(), updatedBy: text('updated_by').notNull(), ...timestamps,
});
export const rowPolicies = sqliteTable('row_policies', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull(), recordId: text('record_id').notNull().references(() => smartRecords.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(), access: text('access').notNull(), createdAt: text('created_at').notNull(),
});
export const fieldPolicies = sqliteTable('field_policies', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull(), fieldId: text('field_id').notNull().references(() => smartFields.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(), access: text('access').notNull(), createdAt: text('created_at').notNull(),
});
export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(), personaSnapshot: text('persona_snapshot').notNull().default(''),
  anchor: text('anchor'), content: text('content').notNull(), resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  mentionsJson: text('mentions_json').notNull().default('[]'), parentId: text('parent_id'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), title: text('title').notNull(), body: text('body').notNull().default(''),
  resourceId: text('resource_id'), readAt: text('read_at'), createdAt: text('created_at').notNull(),
});
export const favorites = sqliteTable('favorites', {
  resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, table => [primaryKey({ columns: [table.resourceId, table.accountId] })]);
export const recentVisits = sqliteTable('recent_visits', {
  resourceId: text('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  visitedAt: text('visited_at').notNull(),
}, table => [primaryKey({ columns: [table.resourceId, table.accountId] })]);
export const fileObjects = sqliteTable('file_objects', {
  id: text('id').primaryKey(), key: text('key').notNull().unique(), name: text('name').notNull(), mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(), sha256: text('sha256').notNull(), uploadedBy: text('uploaded_by').notNull(), createdAt: text('created_at').notNull(),
});
export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull(), name: text('name').notNull(),
  data: text('data').notNull(), fileId: text('file_id'), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
});
export const collabSnapshots = sqliteTable('collab_snapshots', {
  id: text('id').primaryKey(), resourceId: text('resource_id').notNull().unique(), data: text('data').notNull(), updatedAt: text('updated_at').notNull(),
});
export const collabUpdates = sqliteTable('collab_updates', {
  id: integer('id').primaryKey({ autoIncrement: true }), resourceId: text('resource_id').notNull(), data: text('data').notNull(), createdAt: text('created_at').notNull(),
});
export const officeRooms = sqliteTable('office_rooms', {
  resourceId: text('resource_id').primaryKey(), format: text('format').notNull(), seed: text('seed').notNull(),
  checkpoint: text('checkpoint'), checkpointFrame: integer('checkpoint_frame').notNull().default(0), updatedAt: text('updated_at').notNull(),
});
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), action: text('action').notNull(),
  resourceId: text('resource_id'), detailJson: text('detail_json').notNull().default('{}'), createdAt: text('created_at').notNull(),
});
