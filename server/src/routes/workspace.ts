import type { FastifyInstance } from 'fastify';
import { and, eq, desc, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { authorize } from '../modules/permissions.js';
import { displayPersona, notify, notifyResourceMembers } from '../modules/notifications.js';
import { id, now, text } from '../utils.js';

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/api/workspace/favorites', async request => {
    const account = requireAccount(request);
    const rows = await db.select({ resource: schema.resources }).from(schema.favorites)
      .innerJoin(schema.resources, eq(schema.resources.id, schema.favorites.resourceId))
      .where(and(eq(schema.favorites.accountId, account.id), isNull(schema.resources.deletedAt)));
    const visible = [];
    for (const row of rows) {
      try { await authorize(row.resource.id, account.id, 'viewer'); visible.push(row); } catch { /* 已撤销的授权不再出现在收藏 */ }
    }
    return visible;
  });
  app.put('/api/resources/:id/favorite', async request => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    await authorize(resourceId, account.id, 'viewer');
    const existing = await db.query.favorites.findFirst({ where: and(eq(schema.favorites.resourceId, resourceId), eq(schema.favorites.accountId, account.id)) });
    if (!existing) await db.insert(schema.favorites).values({ resourceId, accountId: account.id, createdAt: now() });
    return { favorite: true };
  });
  app.delete('/api/resources/:id/favorite', async request => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    await db.delete(schema.favorites).where(and(eq(schema.favorites.resourceId, resourceId), eq(schema.favorites.accountId, account.id)));
    return { favorite: false };
  });
  app.post('/api/resources/:id/visit', async request => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    await authorize(resourceId, account.id, 'viewer');
    await db.insert(schema.recentVisits).values({ resourceId, accountId: account.id, visitedAt: now() })
      .onConflictDoUpdate({ target: [schema.recentVisits.resourceId, schema.recentVisits.accountId], set: { visitedAt: now() } });
    return { ok: true };
  });
  app.get('/api/workspace/recent', async request => {
    const account = requireAccount(request);
    const rows = await db.select({ resource: schema.resources, visitedAt: schema.recentVisits.visitedAt }).from(schema.recentVisits)
      .innerJoin(schema.resources, eq(schema.resources.id, schema.recentVisits.resourceId))
      .where(and(eq(schema.recentVisits.accountId, account.id), isNull(schema.resources.deletedAt)))
      .orderBy(desc(schema.recentVisits.visitedAt)).limit(20);
    const visible = [];
    for (const row of rows) {
      try { await authorize(row.resource.id, account.id, 'viewer'); visible.push(row); } catch { /* 已撤销的授权不再出现在最近访问 */ }
    }
    return visible;
  });
  app.get('/api/workspace/trash', async request => {
    const account = requireAccount(request);
    const rows = account.siteAdmin
      ? await db.query.resources.findMany({ orderBy: (t, { desc }) => desc(t.deletedAt) })
      : await db.query.resources.findMany({ where: eq(schema.resources.ownerId, account.id), orderBy: (t, { desc }) => desc(t.deletedAt) });
    return rows.filter(row => row.deletedAt);
  });
  app.delete('/api/resources/:id/permanent', async request => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
    if (!resource?.deletedAt || resource.ownerId !== account.id && !account.siteAdmin) throw Object.assign(new Error('无永久删除权限'), { statusCode: 403 });
    await db.delete(schema.resources).where(eq(schema.resources.id, resourceId));
    audit(account.id, 'resource.purge', resourceId, { name: resource.name }); return { ok: true };
  });
  app.get('/api/notifications', async request => {
    const account = requireAccount(request);
    return db.query.notifications.findMany({ where: eq(schema.notifications.accountId, account.id), orderBy: (t, { desc }) => desc(t.createdAt), limit: 100 });
  });
  app.post('/api/notifications/:id/read', async request => {
    const account = requireAccount(request); const notificationId = (request.params as any).id;
    await db.update(schema.notifications).set({ readAt: now() }).where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.accountId, account.id)));
    return { ok: true };
  });
  app.get('/api/resources/:id/comments', async request => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    await authorize(resourceId, account.id, 'viewer');
    const rows = await db.select({ comment: schema.comments, account: { username: schema.accounts.username } }).from(schema.comments)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.comments.accountId))
      .where(eq(schema.comments.resourceId, resourceId)).orderBy(desc(schema.comments.createdAt));
    return rows.map(row => ({ ...row.comment, persona: row.comment.personaSnapshot, mentions: JSON.parse(row.comment.mentionsJson) }));
  });
  app.post('/api/resources/:id/comments', async request => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    await authorize(resourceId, account.id, 'commenter'); const body = request.body as any;
    const content = text(body.content, 1, 2000);
    const mentions = Array.isArray(body.mentions) ? body.mentions.filter((value: unknown) => typeof value === 'string').slice(0, 20) : [];
    const commentId = id(); const createdAt = now(); const persona = await displayPersona(resourceId, account.id);
    await db.insert(schema.comments).values({ id: commentId, resourceId, accountId: account.id, personaSnapshot: persona, anchor: body.anchor ? String(body.anchor).slice(0, 200) : null, content, mentionsJson: JSON.stringify(mentions), parentId: body.parentId ? String(body.parentId) : null, createdAt, updatedAt: createdAt });
    notifyResourceMembers(resourceId, account.id, '新的评论', `${persona}：${content.slice(0, 80)}`);
    return { id: commentId, persona };
  });
  app.patch('/api/comments/:id', async request => {
    const account = requireAccount(request); const commentId = (request.params as any).id;
    const comment = await db.query.comments.findFirst({ where: eq(schema.comments.id, commentId) });
    if (!comment) throw Object.assign(new Error('评论不存在'), { statusCode: 404 });
    await authorize(comment.resourceId, account.id, 'editor');
    if (comment.accountId !== account.id && !request.account!.siteAdmin) throw Object.assign(new Error('只能修改自己的评论'), { statusCode: 403 });
    const body = request.body as any;
    await db.update(schema.comments).set({ resolved: Boolean(body.resolved), content: body.content ? text(body.content, 1, 2000) : comment.content, updatedAt: now() }).where(eq(schema.comments.id, commentId));
    return { ok: true };
  });
}
