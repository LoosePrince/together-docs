import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { id, now, text, token, hashSecret, verifySecret } from '../utils.js';
import { authorize } from '../modules/permissions.js';
import { notify, notifyResourceMembers } from '../modules/notifications.js';

const activeShare = (share: typeof schema.shareLinks.$inferSelect) =>
  share.enabled && (!share.expiresAt || share.expiresAt >= now()) && (!share.maxUses || share.uses < share.maxUses);

export async function shareRoutes(app: FastifyInstance) {
  app.post('/api/resources/:id/shares', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager'); const body = request.body as any;
    const raw = token(); const shareId = id();
    await db.insert(schema.shareLinks).values({
      id: shareId, resourceId, token: raw, createdBy: account.id,
      scope: ['document', 'project', 'both'].includes(body.scope) ? body.scope : 'both',
      allowApply: body.allowApply !== false, requireApproval: body.requireApproval !== false,
      defaultRole: ['viewer', 'commenter', 'editor'].includes(body.defaultRole) ? body.defaultRole : 'viewer',
      passwordHash: body.password ? hashSecret(text(body.password, 4, 100)) : null,
      allowView: Boolean(body.allowView), expiresAt: body.expiresAt || null,
      maxUses: Number.isInteger(body.maxUses) && body.maxUses > 0 ? body.maxUses : null,
      createdAt: now(),
    });
    audit(account.id, 'share.create', resourceId, { shareId });
    return { id: shareId, token: raw };
  });
  app.get('/api/resources/:id/shares', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager');
    return (await db.query.shareLinks.findMany({ where: eq(schema.shareLinks.resourceId, resourceId) })).map(({ passwordHash, ...share }) => ({ ...share, hasPassword: Boolean(passwordHash) }));
  });
  app.patch('/api/shares/:id', async (request) => {
    const account = requireAccount(request); const share = await db.query.shareLinks.findFirst({ where: eq(schema.shareLinks.id, (request.params as any).id) });
    if (!share) throw Object.assign(new Error('分享链接不存在'), { statusCode: 404 });
    await authorize(share.resourceId, account.id, 'manager'); const body = request.body as any;
    const patch: Record<string, unknown> = {};
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.allowApply !== undefined) patch.allowApply = Boolean(body.allowApply);
    if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt || null;
    if (body.maxUses !== undefined) patch.maxUses = Number.isInteger(body.maxUses) && body.maxUses > 0 ? body.maxUses : null;
    if (body.password) patch.passwordHash = hashSecret(text(body.password, 4, 100));
    if (body.clearPassword) patch.passwordHash = null;
    await db.update(schema.shareLinks).set(patch).where(eq(schema.shareLinks.id, share.id)); return { ok: true };
  });
  app.get('/api/shares/:token', async (request) => {
    const share = await db.query.shareLinks.findFirst({ where: eq(schema.shareLinks.token, (request.params as any).token) });
    if (!share || !activeShare(share)) throw Object.assign(new Error('分享链接无效或已过期'), { statusCode: 404 });
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, share.resourceId) });
    return { resourceName: resource?.name, scope: share.scope, allowApply: share.allowApply, allowView: share.allowView, defaultRole: share.defaultRole, hasPassword: Boolean(share.passwordHash), loggedIn: Boolean(request.account) };
  });
  app.post('/api/shares/:token/apply', async (request) => {
    const account = requireAccount(request); const share = await db.query.shareLinks.findFirst({ where: eq(schema.shareLinks.token, (request.params as any).token) });
    if (!share || !share.enabled || !share.allowApply || !activeShare(share)) throw Object.assign(new Error('分享链接不可申请'), { statusCode: 400 });
    if (share.passwordHash && !verifySecret(String((request.body as any)?.password || ''), share.passwordHash)) throw Object.assign(new Error('分享密码不正确'), { statusCode: 401 });
    const body = request.body as any; const scope = share.scope === 'both' ? body.scope : share.scope;
    if (!['document', 'project'].includes(scope)) throw Object.assign(new Error('请选择申请范围'), { statusCode: 400 });
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, share.resourceId) });
    if (scope === 'project' && !resource?.projectId) throw Object.assign(new Error('此文档不属于项目'), { statusCode: 400 });
    const existing = await db.query.permissionRequests.findFirst({ where: and(eq(schema.permissionRequests.shareId, share.id), eq(schema.permissionRequests.accountId, account.id), eq(schema.permissionRequests.status, 'pending')) });
    if (existing) throw Object.assign(new Error('已有待审批的申请，请等待管理员处理'), { statusCode: 409 });
    const role = ['viewer', 'commenter', 'editor'].includes(body.role) ? body.role : share.defaultRole;
    const requestId = id(); const createdAt = now();
    db.transaction(tx => {
      tx.insert(schema.permissionRequests).values({ id: requestId, resourceId: share.resourceId, shareId: share.id, accountId: account.id, scope, role, message: String(body.message || '').slice(0, 300), status: share.requireApproval ? 'pending' : 'approved', reviewedAt: share.requireApproval ? null : createdAt, createdAt, updatedAt: createdAt }).run();
      tx.update(schema.shareLinks).set({ uses: share.uses + 1 }).where(eq(schema.shareLinks.id, share.id)).run();
      if (!share.requireApproval && scope === 'document') tx.insert(schema.resourceMembers).values({ id: id(), resourceId: share.resourceId, accountId: account.id, role, createdAt, updatedAt: createdAt }).onConflictDoNothing().run();
      if (!share.requireApproval && scope === 'project') tx.insert(schema.projectMembers).values({ id: id(), projectId: resource!.projectId!, accountId: account.id, role, createdAt, updatedAt: createdAt }).onConflictDoNothing().run();
    });
    if (share.requireApproval) {
      const resourceName = resource?.name || '文档';
      const managers = await db.query.resourceMembers.findMany({ where: and(eq(schema.resourceMembers.resourceId, share.resourceId), eq(schema.resourceMembers.role, 'manager')) });
      if (resource) notify(resource.ownerId, '新的权限申请', `${account.displayName} 申请访问「${resourceName}」`, resource.id);
      for (const manager of managers) notify(manager.accountId, '新的权限申请', `${account.displayName} 申请访问「${resourceName}」`, share.resourceId);
    }
    return { id: requestId };
  });
  app.get('/api/resources/:id/requests', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'manager');
    return db.query.permissionRequests.findMany({ where: eq(schema.permissionRequests.resourceId, resourceId), orderBy: [desc(schema.permissionRequests.createdAt)] });
  });
  app.get('/api/workspace/requests', async request => {
    const account = requireAccount(request);
    const owned = await db.query.resources.findMany({ where: eq(schema.resources.ownerId, account.id) });
    const managed = await db.query.resourceMembers.findMany({ where: and(eq(schema.resourceMembers.accountId, account.id), eq(schema.resourceMembers.role, 'manager')) });
    const ids = new Set([...owned.map(r => r.id), ...managed.map(r => r.resourceId)]);
    if (!ids.size) return [];
    return (await db.query.permissionRequests.findMany({ orderBy: [desc(schema.permissionRequests.createdAt)] })).filter(req => ids.has(req.resourceId));
  });
  app.post('/api/requests/:id/review', async (request) => {
    const account = requireAccount(request); const pending = await db.query.permissionRequests.findFirst({ where: eq(schema.permissionRequests.id, (request.params as any).id) });
    if (!pending || pending.status !== 'pending') throw Object.assign(new Error('申请不存在或已处理'), { statusCode: 404 });
    const { resource } = await authorize(pending.resourceId, account.id, 'manager'); const body = request.body as any;
    if (body.approved) {
      const role = ['viewer', 'commenter', 'editor', 'manager'].includes(body.role) ? body.role : pending.role; const createdAt = now();
      if (pending.scope === 'document') await db.insert(schema.resourceMembers).values({ id: id(), resourceId: resource.id, accountId: pending.accountId, role, createdAt, updatedAt: createdAt }).onConflictDoUpdate({ target: [schema.resourceMembers.resourceId, schema.resourceMembers.accountId], set: { role } });
      else if (resource.projectId) await db.insert(schema.projectMembers).values({ id: id(), projectId: resource.projectId, accountId: pending.accountId, role, createdAt, updatedAt: createdAt }).onConflictDoUpdate({ target: [schema.projectMembers.projectId, schema.projectMembers.accountId], set: { role } });
    }
    await db.update(schema.permissionRequests).set({ status: body.approved ? 'approved' : 'rejected', reviewedBy: account.id, reviewedAt: now(), updatedAt: now() }).where(eq(schema.permissionRequests.id, pending.id));
    notify(pending.accountId, body.approved ? '权限申请已通过' : '权限申请未通过', `「${resource.name}」的申请已处理`, resource.id);
    notifyResourceMembers(resource.id, account.id, '权限审批完成', `「${resource.name}」的一条申请已处理`);
    audit(account.id, 'permission.review', pending.resourceId, { request: pending.id, approved: Boolean(body.approved) }); return { ok: true };
  });
}
