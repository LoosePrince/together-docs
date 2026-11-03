import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { id, now, text, token } from '../utils.js';
import { authorize } from '../modules/permissions.js';

export async function shareRoutes(app: FastifyInstance) {
  app.post('/api/resources/:id/shares', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    const raw = token();
    await db.insert(schema.shareLinks).values({ id: id(), resourceId, token: raw, createdBy: account.id, scope: ['document', 'project', 'both'].includes(body.scope) ? body.scope : 'both', expiresAt: body.expiresAt || null, createdAt: now() });
    return { token: raw };
  });
  app.get('/api/resources/:id/shares', async (request) => { const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); return db.query.shareLinks.findMany({ where: eq(schema.shareLinks.resourceId, resourceId) }); });
  app.get('/api/shares/:token', async (request) => {
    const share = await db.query.shareLinks.findFirst({ where: eq(schema.shareLinks.token, (request.params as any).token) });
    if (!share || !share.enabled || share.expiresAt && share.expiresAt < now() || share.maxUses && share.uses >= share.maxUses) throw Object.assign(new Error('分享链接无效或已过期'), { statusCode: 404 });
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, share.resourceId) });
    return { resourceName: resource?.name, scope: share.scope, allowApply: share.allowApply, loggedIn: Boolean(request.account) };
  });
  app.post('/api/shares/:token/apply', async (request) => {
    const account = requireAccount(request); const share = await db.query.shareLinks.findFirst({ where: eq(schema.shareLinks.token, (request.params as any).token) });
    if (!share || !share.enabled || !share.allowApply || share.expiresAt && share.expiresAt < now() || share.maxUses && share.uses >= share.maxUses) throw Object.assign(new Error('分享链接不可申请'), { statusCode: 400 });
    const body = request.body as any; const scope = share.scope === 'both' ? body.scope : share.scope;
    if (!['document', 'project'].includes(scope)) throw Object.assign(new Error('请选择申请范围'), { statusCode: 400 });
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, share.resourceId) });
    if (scope === 'project' && !resource?.projectId) throw Object.assign(new Error('此文档不属于项目'), { statusCode: 400 });
    const role = ['viewer', 'commenter', 'editor'].includes(body.role) ? body.role : 'viewer'; const requestId = id(); const createdAt = now();
    db.transaction(tx => {
      tx.insert(schema.permissionRequests).values({ id: requestId, resourceId: share.resourceId, shareId: share.id, accountId: account.id, scope, role, message: String(body.message || '').slice(0, 300), status: share.requireApproval ? 'pending' : 'approved', reviewedAt: share.requireApproval ? null : createdAt, createdAt, updatedAt: createdAt }).run();
      tx.update(schema.shareLinks).set({ uses: share.uses + 1 }).where(eq(schema.shareLinks.id, share.id)).run();
      if (!share.requireApproval && scope === 'document') tx.insert(schema.resourceMembers).values({ id: id(), resourceId: share.resourceId, accountId: account.id, role, createdAt, updatedAt: createdAt }).onConflictDoNothing().run();
      if (!share.requireApproval && scope === 'project') tx.insert(schema.projectMembers).values({ id: id(), projectId: resource!.projectId!, accountId: account.id, role, createdAt, updatedAt: createdAt }).onConflictDoNothing().run();
    });
    return { id: requestId };
  });
  app.get('/api/resources/:id/requests', async (request) => { const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); return db.query.permissionRequests.findMany({ where: eq(schema.permissionRequests.resourceId, resourceId), orderBy: [desc(schema.permissionRequests.createdAt)] }); });
  app.post('/api/requests/:id/review', async (request) => {
    const account = requireAccount(request); const req = await db.query.permissionRequests.findFirst({ where: eq(schema.permissionRequests.id, (request.params as any).id) });
    if (!req || req.status !== 'pending') throw Object.assign(new Error('申请不存在或已处理'), { statusCode: 404 });
    const { resource } = await authorize(req.resourceId, account.id, 'manager'); const body = request.body as any;
    if (body.approved) {
      const role = ['viewer', 'commenter', 'editor', 'manager'].includes(body.role) ? body.role : req.role; const createdAt = now();
      if (req.scope === 'document') await db.insert(schema.resourceMembers).values({ id: id(), resourceId: resource.id, accountId: req.accountId, role, createdAt, updatedAt: createdAt }).onConflictDoUpdate({ target: [schema.resourceMembers.resourceId, schema.resourceMembers.accountId], set: { role } });
      else if (resource.projectId) await db.insert(schema.projectMembers).values({ id: id(), projectId: resource.projectId, accountId: req.accountId, role, createdAt, updatedAt: createdAt }).onConflictDoUpdate({ target: [schema.projectMembers.projectId, schema.projectMembers.accountId], set: { role } });
    }
    await db.update(schema.permissionRequests).set({ status: body.approved ? 'approved' : 'rejected', reviewedBy: account.id, reviewedAt: now(), updatedAt: now() }).where(eq(schema.permissionRequests.id, req.id));
    audit(account.id, 'permission.review', req.resourceId, { request: req.id, approved: Boolean(body.approved) }); return { ok: true };
  });
}
