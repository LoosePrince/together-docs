import type { FastifyInstance } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { id, now, text } from '../utils.js';
import { authorize } from '../modules/permissions.js';

const types = ['native_document', 'native_spreadsheet', 'smart_table'];
export async function resourceRoutes(app: FastifyInstance) {
  app.post('/api/resources', async (request) => {
    const account = requireAccount(request); const body = request.body as any; const type = types.includes(body.type) ? body.type : 'native_document';
    const projectId = body.projectId || null;
    if (projectId) {
      const member = await db.query.projectMembers.findFirst({ where: and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.accountId, account.id)) });
      if (!member || !['owner', 'manager', 'editor'].includes(member.role)) {
        if (!account.siteAdmin) throw Object.assign(new Error('无项目编辑权限'), { statusCode: 403 });
      }
    }
    const resourceId = id(); const createdAt = now();
    db.transaction(tx => {
      tx.insert(schema.resources).values({ id: resourceId, name: text(body.name, 1, 100), type, ownerId: account.id, projectId, createdAt, updatedAt: createdAt }).run();
      if (type === 'smart_table') {
        tx.insert(schema.smartFields).values({ id: id(), resourceId, name: '标题', type: 'text', position: 0 }).run();
        tx.insert(schema.smartFields).values({ id: id(), resourceId, name: '状态', type: 'select', optionsJson: JSON.stringify({ options: ['未开始', '进行中', '已完成'] }), position: 1 }).run();
      }
    });
    audit(account.id, 'resource.create', resourceId, { type }); return { id: resourceId };
  });
  app.get('/api/resources/:id', async (request) => {
    const account = requireAccount(request); const result = await authorize((request.params as any).id, account.id, 'viewer');
    const members = await db.query.resourceMembers.findMany({ where: eq(schema.resourceMembers.resourceId, result.resource.id) });
    const personas: Record<string, string> = {};
    for (const member of members) personas[member.accountId] = member.persona;
    if (result.resource.projectId) {
      const projectMembers = await db.query.projectMembers.findMany({ where: eq(schema.projectMembers.projectId, result.resource.projectId) });
      for (const member of projectMembers) if (!personas[member.accountId]) personas[member.accountId] = member.persona;
    }
    return { ...result.resource, role: result.role, permissionSource: result.source, personas };
  });
  app.patch('/api/resources/:id', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'editor');
    await db.update(schema.resources).set({ name: text((request.body as any).name, 1, 100), updatedAt: now() }).where(eq(schema.resources.id, resourceId));
    return { ok: true };
  });
  app.delete('/api/resources/:id', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager');
    await db.update(schema.resources).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.resources.id, resourceId)); audit(account.id, 'resource.delete', resourceId); return { ok: true };
  });
  app.post('/api/resources/:id/restore', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
    if (!resource || resource.ownerId !== account.id && !account.siteAdmin) throw Object.assign(new Error('无权限'), { statusCode: 403 });
    await db.update(schema.resources).set({ deletedAt: null, updatedAt: now() }).where(eq(schema.resources.id, resourceId)); return { ok: true };
  });
  app.get('/api/resources/:id/members', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'viewer');
    return db.select({ member: schema.resourceMembers, account: { id: schema.accounts.id, username: schema.accounts.username, displayName: schema.accounts.displayName } }).from(schema.resourceMembers).innerJoin(schema.accounts, eq(schema.accounts.id, schema.resourceMembers.accountId)).where(eq(schema.resourceMembers.resourceId, resourceId));
  });
  app.post('/api/resources/:id/members', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    const target = await db.query.accounts.findFirst({ where: eq(schema.accounts.username, text(body.username, 3, 32).toLowerCase()) });
    if (!target) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    const role = ['viewer', 'commenter', 'editor', 'manager'].includes(body.role) ? body.role : 'viewer'; const createdAt = now();
    await db.insert(schema.resourceMembers).values({ id: id(), resourceId, accountId: target.id, role, persona: String(body.persona || ''), createdAt, updatedAt: createdAt }).onConflictDoUpdate({ target: [schema.resourceMembers.resourceId, schema.resourceMembers.accountId], set: { role, updatedAt: createdAt } });
    audit(account.id, 'member.grant', resourceId, { target: target.id, role }); return { ok: true };
  });
  app.delete('/api/resources/:id/members/:accountId', async (request) => {
    const account = requireAccount(request); const { id: resourceId, accountId } = request.params as any; await authorize(resourceId, account.id, 'manager');
    await db.delete(schema.resourceMembers).where(and(eq(schema.resourceMembers.resourceId, resourceId), eq(schema.resourceMembers.accountId, accountId)));
    await db.update(schema.resources).set({ permissionVersion: (await authorize(resourceId, account.id, 'manager')).resource.permissionVersion + 1 }).where(eq(schema.resources.id, resourceId)); return { ok: true };
  });
}
