import type { FastifyInstance } from 'fastify';
import { eq, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, requireSiteAdmin, issueSession, audit } from '../auth.js';
import { hashSecret, id, now, text, token, verifySecret } from '../utils.js';
import { config } from '../config.js';

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async (request) => {
    const count = await db.$count(schema.accounts);
    return { initialized: count > 0, account: request.account ? { id: request.account.id, username: request.account.username, displayName: request.account.displayName, siteAdmin: request.account.siteAdmin } : null };
  });
  app.post('/api/auth/bootstrap', async (request, reply) => {
    const body = request.body as any;
    if (await db.$count(schema.accounts)) throw Object.assign(new Error('站点已初始化'), { statusCode: 409 });
    const username = text(body.username, 3, 32).toLowerCase();
    const password = text(body.password, 8, 128);
    const createdAt = now(); const accountId = id();
    db.insert(schema.accounts).values({ id: accountId, username, displayName: text(body.displayName, 1, 50), passwordHash: hashSecret(password), siteAdmin: true, createdAt, updatedAt: createdAt }).run();
    issueSession(reply, accountId);
    return { ok: true };
  });
  app.post('/api/auth/register', async (request, reply) => {
    const body = request.body as any;
    const invite = await db.query.invites.findFirst({ where: eq(schema.invites.token, text(body.invite, 10, 200)) });
    if (!invite || invite.revokedAt || invite.usedAt || invite.expiresAt < now()) throw Object.assign(new Error('邀请链接无效或已使用'), { statusCode: 400 });
    const username = text(body.username, 3, 32).toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_.-]+$/.test(username)) throw Object.assign(new Error('用户名仅支持字母、数字和 _ . -'), { statusCode: 400 });
    const accountId = id(); const createdAt = now();
    try {
      db.transaction(tx => {
        tx.insert(schema.accounts).values({ id: accountId, username, displayName: text(body.displayName, 1, 50), passwordHash: hashSecret(text(body.password, 8, 128)), createdAt, updatedAt: createdAt }).run();
        tx.update(schema.invites).set({ usedBy: accountId, usedAt: createdAt }).where(eq(schema.invites.id, invite.id)).run();
      });
    } catch { throw Object.assign(new Error('用户名已存在'), { statusCode: 409 }); }
    issueSession(reply, accountId);
    return { ok: true };
  });
  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as any;
    const account = await db.query.accounts.findFirst({ where: eq(schema.accounts.username, String(body.username || '').toLowerCase()) });
    if (!account || account.disabledAt || !verifySecret(String(body.password || ''), account.passwordHash)) throw Object.assign(new Error('用户名或密码错误'), { statusCode: 401 });
    issueSession(reply, account.id); audit(account.id, 'login');
    return { ok: true };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.account) await db.delete(schema.sessions).where(eq(schema.sessions.accountId, request.account.id));
    reply.clearCookie('td_session', { path: '/' }); return { ok: true };
  });
  app.get('/api/admin/invites', async (request) => { requireSiteAdmin(request); return db.query.invites.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) }); });
  app.post('/api/admin/invites', async (request) => {
    const admin = requireSiteAdmin(request); const raw = token(); const createdAt = now();
    await db.insert(schema.invites).values({ id: id(), token: raw, createdBy: admin.id, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), createdAt });
    return { token: raw, url: `${config.publicUrl}/?invite=${raw}`, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
  });
  app.delete('/api/admin/invites/:id', async (request) => { requireSiteAdmin(request); await db.update(schema.invites).set({ revokedAt: now() }).where(eq(schema.invites.id, (request.params as any).id)); return { ok: true }; });
  app.get('/api/admin/accounts', async (request) => { requireSiteAdmin(request); return db.query.accounts.findMany({ columns: { passwordHash: false } }); });
  app.get('/api/admin/audit', async (request) => { requireSiteAdmin(request); return db.query.auditLogs.findMany({ limit: 200, orderBy: (t, { desc }) => desc(t.createdAt) }); });
}
