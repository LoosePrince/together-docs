import type { FastifyInstance } from 'fastify';
import { eq, and, asc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { id, now, text } from '../utils.js';
import { authorize, type Role } from '../modules/permissions.js';
import { bumpPermissionVersion } from '../modules/notifications.js';

const fieldTypes = ['text', 'longtext', 'number', 'currency', 'percent', 'select', 'multiselect', 'date', 'datetime', 'checkbox', 'person', 'url', 'created_by', 'updated_by', 'created_at', 'updated_at', 'auto_number', 'attachment'];
const computedTypes = new Set(['created_by', 'updated_by', 'created_at', 'updated_at', 'auto_number']);
const parse = (value: string) => { try { return JSON.parse(value); } catch { return {}; } };
const numberTypes = ['number', 'currency', 'percent'];

type Field = typeof schema.smartFields.$inferSelect;
type RecordRow = typeof schema.smartRecords.$inferSelect;

function computedValue(field: Field, record: RecordRow, ordinal: number): unknown {
  switch (field.type) {
    case 'created_by': return record.createdBy;
    case 'updated_by': return record.updatedBy;
    case 'created_at': return record.createdAt;
    case 'updated_at': return record.updatedAt;
    case 'auto_number': return ordinal;
    default: return undefined;
  }
}

export async function smartRoutes(app: FastifyInstance) {
  app.get('/api/resources/:id/table', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; const { role } = await authorize(resourceId, account.id, 'viewer');
    const allFields = await db.query.smartFields.findMany({ where: eq(schema.smartFields.resourceId, resourceId), orderBy: [asc(schema.smartFields.position)] });
    const fieldRules = await db.query.fieldPolicies.findMany({ where: and(eq(schema.fieldPolicies.resourceId, resourceId), eq(schema.fieldPolicies.accountId, account.id)) });
    const fieldAccess = new Map(fieldRules.map(x => [x.fieldId, x.access]));
    const fields = allFields.filter(f => fieldAccess.get(f.id) !== 'hidden');
    const fieldIds = new Set(fields.map(f => f.id));
    const allRecords = await db.query.smartRecords.findMany({ where: eq(schema.smartRecords.resourceId, resourceId), orderBy: [asc(schema.smartRecords.createdAt)] });
    const rowRules = await db.query.rowPolicies.findMany({ where: and(eq(schema.rowPolicies.resourceId, resourceId), eq(schema.rowPolicies.accountId, account.id)) });
    const rowAccess = new Map(rowRules.map(x => [x.recordId, x.access]));
    const records = allRecords.filter(r => rowAccess.get(r.id) !== 'hidden').map((r, ordinal) => {
      const stored = parse(r.valuesJson); const values: Record<string, unknown> = {};
      for (const field of fields) {
        const value = computedTypes.has(field.type) ? computedValue(field, r, ordinal + 1) : stored[field.id];
        if (value !== undefined) values[field.id] = value;
      }
      return { id: r.id, access: rowAccess.get(r.id) || role, values, createdAt: r.createdAt, updatedAt: r.updatedAt };
    });
    const views = await db.query.smartViews.findMany({ where: eq(schema.smartViews.resourceId, resourceId), orderBy: [asc(schema.smartViews.position)] });
    return {
      fields: fields.map(f => ({ ...f, access: fieldAccess.get(f.id) || role, options: parse(f.optionsJson) })), records,
      views: views.map(v => ({ ...v, configuration: parse(v.configurationJson) })),
      permissionVersion: (await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) }))!.permissionVersion,
    };
  });
  app.get('/api/resources/:id/table/export', async (request, reply) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    const { resource } = await authorize(resourceId, account.id, 'viewer');
    const allFields = await db.query.smartFields.findMany({ where: eq(schema.smartFields.resourceId, resourceId), orderBy: [asc(schema.smartFields.position)] });
    const fieldRules = await db.query.fieldPolicies.findMany({ where: and(eq(schema.fieldPolicies.resourceId, resourceId), eq(schema.fieldPolicies.accountId, account.id)) });
    const fieldAccess = new Map(fieldRules.map(x => [x.fieldId, x.access]));
    const fields = allFields.filter(f => fieldAccess.get(f.id) !== 'hidden');
    const rowRules = await db.query.rowPolicies.findMany({ where: and(eq(schema.rowPolicies.resourceId, resourceId), eq(schema.rowPolicies.accountId, account.id)) });
    const hiddenRows = new Set(rowRules.filter(rule => rule.access === 'hidden').map(rule => rule.recordId));
    const records = (await db.query.smartRecords.findMany({ where: eq(schema.smartRecords.resourceId, resourceId), orderBy: [asc(schema.smartRecords.createdAt)] })).filter(r => !hiddenRows.has(r.id));
    const csvEscape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [fields.map(field => csvEscape(field.name)).join(',')];
    for (const [index, record] of records.entries()) {
      const values = parse(record.valuesJson);
      lines.push(fields.map(field => csvEscape(computedTypes.has(field.type) ? computedValue(field, record, index + 1) : values[field.id])).join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(resource.name + '.csv')}`);
    return reply.send('﻿' + lines.join('\r\n'));
  });
  app.post('/api/resources/:id/fields', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    const fields = await db.query.smartFields.findMany({ where: eq(schema.smartFields.resourceId, resourceId) }); const fieldId = id();
    const type = fieldTypes.includes(body.type) ? body.type : 'text';
    const options = type === 'select' || type === 'multiselect' ? { options: Array.isArray(body.options?.options) ? body.options.options.filter((x: unknown) => typeof x === 'string').slice(0, 50) : [] } : {};
    await db.insert(schema.smartFields).values({ id: fieldId, resourceId, name: text(body.name, 1, 50), type, optionsJson: JSON.stringify(options), position: fields.length });
    bumpPermissionVersion(resourceId); return { id: fieldId };
  });
  app.delete('/api/resources/:id/fields/:fieldId', async (request) => {
    const account = requireAccount(request); const { id: resourceId, fieldId } = request.params as any; await authorize(resourceId, account.id, 'manager');
    await db.delete(schema.smartFields).where(and(eq(schema.smartFields.id, fieldId), eq(schema.smartFields.resourceId, resourceId))); bumpPermissionVersion(resourceId); return { ok: true };
  });
  app.post('/api/resources/:id/records', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'editor'); const recordId = id(); const createdAt = now();
    await db.insert(schema.smartRecords).values({ id: recordId, resourceId, valuesJson: '{}', createdBy: account.id, updatedBy: account.id, createdAt, updatedAt: createdAt }); return { id: recordId };
  });
  app.patch('/api/resources/:id/records/:recordId', async (request) => {
    const account = requireAccount(request); const { id: resourceId, recordId } = request.params as any; await authorize(resourceId, account.id, 'editor');
    const record = await db.query.smartRecords.findFirst({ where: and(eq(schema.smartRecords.id, recordId), eq(schema.smartRecords.resourceId, resourceId)) });
    if (!record) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
    const rowRule = await db.query.rowPolicies.findFirst({ where: and(eq(schema.rowPolicies.recordId, recordId), eq(schema.rowPolicies.accountId, account.id)) });
    if (rowRule?.access === 'hidden' || rowRule?.access === 'viewer') throw Object.assign(new Error('该行不可编辑'), { statusCode: 403 });
    const rules = await db.query.fieldPolicies.findMany({ where: and(eq(schema.fieldPolicies.resourceId, resourceId), eq(schema.fieldPolicies.accountId, account.id)) });
    const access = new Map(rules.map(r => [r.fieldId, r.access]));
    const fields = await db.query.smartFields.findMany({ where: eq(schema.smartFields.resourceId, resourceId) });
    const fieldMap = new Map(fields.map(f => [f.id, f]));
    const changes = (request.body as any).values;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Object.assign(new Error('无效的记录'), { statusCode: 400 });
    const values = parse(record.valuesJson);
    for (const [key, value] of Object.entries(changes)) {
      const field = fieldMap.get(key);
      if (!field) throw Object.assign(new Error('字段不存在'), { statusCode: 400 });
      if (computedTypes.has(field.type)) throw Object.assign(new Error(`「${field.name}」由系统自动生成，不可直接编辑`), { statusCode: 403 });
      if (access.get(key) === 'hidden' || access.get(key) === 'viewer') throw Object.assign(new Error(`字段「${field.name}」不可编辑`), { statusCode: 403 });
      if (numberTypes.includes(field.type) && typeof value !== 'number') throw Object.assign(new Error(`${field.name} 必须是数字`), { statusCode: 400 });
      if (field.type === 'checkbox' && typeof value !== 'boolean') throw Object.assign(new Error(`${field.name} 必须是布尔值`), { statusCode: 400 });
      if (['text', 'longtext', 'select', 'date', 'datetime', 'person', 'url', 'attachment'].includes(field.type) && typeof value !== 'string') throw Object.assign(new Error(`${field.name} 格式错误`), { statusCode: 400 });
      if (field.type === 'multiselect' && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) throw Object.assign(new Error(`${field.name} 格式错误`), { statusCode: 400 });
      if (field.type === 'select' && !(parse(field.optionsJson).options || []).includes(value)) throw Object.assign(new Error(`「${value}」不在${field.name}的选项中`), { statusCode: 400 });
      if (typeof value === 'string' && value.length > 10000) throw Object.assign(new Error('内容过长'), { statusCode: 400 });
      values[key] = value;
    }
    await db.update(schema.smartRecords).set({ valuesJson: JSON.stringify(values), updatedBy: account.id, updatedAt: now() }).where(eq(schema.smartRecords.id, recordId)); return { ok: true };
  });
  app.delete('/api/resources/:id/records/:recordId', async (request) => {
    const account = requireAccount(request); const { id: resourceId, recordId } = request.params as any; await authorize(resourceId, account.id, 'editor');
    const rule = await db.query.rowPolicies.findFirst({ where: and(eq(schema.rowPolicies.recordId, recordId), eq(schema.rowPolicies.accountId, account.id)) });
    if (rule && rule.access !== 'editor') throw Object.assign(new Error('该行不可删除'), { statusCode: 403 });
    await db.delete(schema.smartRecords).where(and(eq(schema.smartRecords.id, recordId), eq(schema.smartRecords.resourceId, resourceId))); return { ok: true };
  });
  app.post('/api/resources/:id/views', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    const type = ['grid', 'kanban', 'form'].includes(body.type) ? body.type : 'grid'; const viewId = id();
    const views = await db.query.smartViews.findMany({ where: eq(schema.smartViews.resourceId, resourceId) });
    await db.insert(schema.smartViews).values({ id: viewId, resourceId, name: text(body.name, 1, 50), type, configurationJson: JSON.stringify(body.configuration || {}), isPublic: body.isPublic !== false, position: views.length, createdAt: now() });
    return { id: viewId };
  });
  app.patch('/api/resources/:id/views/:viewId', async (request) => {
    const account = requireAccount(request); const { id: resourceId, viewId } = request.params as any; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    const view = await db.query.smartViews.findFirst({ where: and(eq(schema.smartViews.id, viewId), eq(schema.smartViews.resourceId, resourceId)) });
    if (!view) throw Object.assign(new Error('视图不存在'), { statusCode: 404 });
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = text(body.name, 1, 50);
    if (body.configuration && typeof body.configuration === 'object') patch.configurationJson = JSON.stringify(body.configuration);
    if (body.isPublic !== undefined) patch.isPublic = Boolean(body.isPublic);
    await db.update(schema.smartViews).set(patch).where(eq(schema.smartViews.id, viewId)); return { ok: true };
  });
  app.put('/api/resources/:id/policies', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    if (!['row', 'field'].includes(body.kind)) throw Object.assign(new Error('权限类型无效'), { statusCode: 400 });
    if (!['hidden', 'viewer', 'editor'].includes(body.access)) throw Object.assign(new Error('权限值无效'), { statusCode: 400 });
    const target = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, text(body.accountId, 1, 100)) });
    if (!target) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    if (body.kind === 'row') {
      const record = await db.query.smartRecords.findFirst({ where: and(eq(schema.smartRecords.id, body.targetId), eq(schema.smartRecords.resourceId, resourceId)) });
      if (!record) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
      await db.insert(schema.rowPolicies).values({ id: id(), resourceId, recordId: record.id, accountId: target.id, access: body.access, createdAt: now() }).onConflictDoUpdate({ target: [schema.rowPolicies.recordId, schema.rowPolicies.accountId], set: { access: body.access } });
    } else {
      const field = await db.query.smartFields.findFirst({ where: and(eq(schema.smartFields.id, body.targetId), eq(schema.smartFields.resourceId, resourceId)) });
      if (!field) throw Object.assign(new Error('字段不存在'), { statusCode: 404 });
      await db.insert(schema.fieldPolicies).values({ id: id(), resourceId, fieldId: field.id, accountId: target.id, access: body.access, createdAt: now() }).onConflictDoUpdate({ target: [schema.fieldPolicies.fieldId, schema.fieldPolicies.accountId], set: { access: body.access } });
    }
    bumpPermissionVersion(resourceId); audit(account.id, 'policy.update', resourceId, { kind: body.kind, accountId: target.id }); return { ok: true };
  });
}
