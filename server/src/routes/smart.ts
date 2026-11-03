import type { FastifyInstance } from 'fastify';
import { eq, and, asc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { id, now, text } from '../utils.js';
import { authorize, type Role } from '../modules/permissions.js';

const fieldTypes = ['text', 'longtext', 'number', 'select', 'multiselect', 'date', 'checkbox', 'person', 'url'];
const parse = (value: string) => { try { return JSON.parse(value); } catch { return {}; } };

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
    const records = allRecords.filter(r => rowAccess.get(r.id) !== 'hidden').map(r => ({ id: r.id, access: rowAccess.get(r.id) || role, values: Object.fromEntries(Object.entries(parse(r.valuesJson)).filter(([key]) => fieldIds.has(key))), createdAt: r.createdAt, updatedAt: r.updatedAt }));
    return { fields: fields.map(f => ({ ...f, access: fieldAccess.get(f.id) || role, options: parse(f.optionsJson) })), records, permissionVersion: (await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) }))!.permissionVersion };
  });
  app.post('/api/resources/:id/fields', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    const fields = await db.query.smartFields.findMany({ where: eq(schema.smartFields.resourceId, resourceId) }); const fieldId = id();
    await db.insert(schema.smartFields).values({ id: fieldId, resourceId, name: text(body.name, 1, 50), type: fieldTypes.includes(body.type) ? body.type : 'text', optionsJson: JSON.stringify(body.options || {}), position: fields.length }); return { id: fieldId };
  });
  app.delete('/api/resources/:id/fields/:fieldId', async (request) => {
    const account = requireAccount(request); const { id: resourceId, fieldId } = request.params as any; await authorize(resourceId, account.id, 'manager');
    await db.delete(schema.smartFields).where(and(eq(schema.smartFields.id, fieldId), eq(schema.smartFields.resourceId, resourceId))); await db.update(schema.resources).set({ permissionVersion: (await authorize(resourceId, account.id, 'manager')).resource.permissionVersion + 1 }).where(eq(schema.resources.id, resourceId)); return { ok: true };
  });
  app.post('/api/resources/:id/records', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'editor'); const recordId = id(); const createdAt = now();
    await db.insert(schema.smartRecords).values({ id: recordId, resourceId, valuesJson: '{}', createdBy: account.id, updatedBy: account.id, createdAt, updatedAt: createdAt }); return { id: recordId };
  });
  app.patch('/api/resources/:id/records/:recordId', async (request) => {
    const account = requireAccount(request); const { id: resourceId, recordId } = request.params as any; const { role } = await authorize(resourceId, account.id, 'editor');
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
      if (access.get(key) === 'hidden' || access.get(key) === 'viewer') throw Object.assign(new Error(`字段「${field.name}」不可编辑`), { statusCode: 403 });
      if (['number'].includes(field.type) && typeof value !== 'number') throw Object.assign(new Error(`${field.name} 必须是数字`), { statusCode: 400 });
      if (field.type === 'checkbox' && typeof value !== 'boolean') throw Object.assign(new Error(`${field.name} 必须是布尔值`), { statusCode: 400 });
      if (['text', 'longtext', 'select', 'date', 'person', 'url'].includes(field.type) && typeof value !== 'string') throw Object.assign(new Error(`${field.name} 格式错误`), { statusCode: 400 });
      if (field.type === 'multiselect' && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) throw Object.assign(new Error(`${field.name} 格式错误`), { statusCode: 400 });
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
  app.put('/api/resources/:id/policies', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; const { resource } = await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    if (!['row', 'field'].includes(body.kind)) throw Object.assign(new Error('权限类型无效'), { statusCode: 400 });
    const accesses = body.kind === 'row' ? ['hidden', 'viewer', 'editor'] : ['hidden', 'viewer', 'editor'];
    if (!accesses.includes(body.access)) throw Object.assign(new Error('权限值无效'), { statusCode: 400 });
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
    await db.update(schema.resources).set({ permissionVersion: resource.permissionVersion + 1 }).where(eq(schema.resources.id, resourceId)); audit(account.id, 'policy.update', resourceId, { kind: body.kind, accountId: target.id }); return { ok: true };
  });
}
