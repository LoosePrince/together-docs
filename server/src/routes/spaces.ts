import type { FastifyInstance } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { id, now, text } from '../utils.js';
import { authorize } from '../modules/permissions.js';

export async function spaceRoutes(app: FastifyInstance) {
  app.get('/api/bootstrap', async (request) => {
    const account = requireAccount(request);
    const resources = await db.select().from(schema.resources).where(and(eq(schema.resources.ownerId, account.id), isNull(schema.resources.deletedAt)));
    const shared = await db.select({ resource: schema.resources }).from(schema.resourceMembers).innerJoin(schema.resources, eq(schema.resources.id, schema.resourceMembers.resourceId)).where(and(eq(schema.resourceMembers.accountId, account.id), isNull(schema.resources.deletedAt)));
    const projectMemberships = await db.query.projectMembers.findMany({ where: eq(schema.projectMembers.accountId, account.id) });
    const projects = await db.query.projects.findMany({ where: isNull(schema.projects.archivedAt) });
    const visibleProjects = projects.filter(p => account.siteAdmin || p.ownerId === account.id || projectMemberships.some(m => m.projectId === p.id));
    const projectResources = (await Promise.all(visibleProjects.map(p => db.query.resources.findMany({ where: and(eq(schema.resources.projectId, p.id), isNull(schema.resources.deletedAt)) })))).flat();
    const allResources = account.siteAdmin ? await db.query.resources.findMany({ where: isNull(schema.resources.deletedAt) }) : [...resources, ...shared.map(x => x.resource), ...projectResources];
    const favorites = await db.query.favorites.findMany({ where: eq(schema.favorites.accountId, account.id) });
    const notifications = await db.query.notifications.findMany({ where: eq(schema.notifications.accountId, account.id), orderBy: (t, { desc }) => desc(t.createdAt), limit: 20 });
    return { resources: [...new Map(allResources.map(r => [r.id, r])).values()], projects: visibleProjects, memberships: projectMemberships, favorites: favorites.map(f => f.resourceId), notifications };
  });
  app.post('/api/projects', async (request) => {
    const account = requireAccount(request); const body = request.body as any; const projectId = id(); const createdAt = now();
    db.transaction(tx => {
      tx.insert(schema.projects).values({ id: projectId, name: text(body.name, 1, 80), description: String(body.description || '').slice(0, 500), ownerId: account.id, createdAt, updatedAt: createdAt }).run();
      tx.insert(schema.projectMembers).values({ id: id(), projectId, accountId: account.id, role: 'owner', createdAt, updatedAt: createdAt }).run();
    });
    return { id: projectId };
  });
  app.get('/api/projects/:id', async (request) => {
    const account = requireAccount(request); const projectId = (request.params as any).id;
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
    const membership = await db.query.projectMembers.findFirst({ where: and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.accountId, account.id)) });
    if (!membership && !account.siteAdmin && project.ownerId !== account.id) throw Object.assign(new Error('无项目访问权限'), { statusCode: 403 });
    return { project, members: await db.query.projectMembers.findMany({ where: eq(schema.projectMembers.projectId, projectId) }), resources: await db.query.resources.findMany({ where: and(eq(schema.resources.projectId, projectId), isNull(schema.resources.deletedAt)) }) };
  });
  app.post('/api/projects/:id/members', async (request) => {
    const account = requireAccount(request); const projectId = (request.params as any).id;
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    const actor = await db.query.projectMembers.findFirst({ where: and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.accountId, account.id)) });
    const canManage = account.siteAdmin || project?.ownerId === account.id || (actor && ['owner', 'manager'].includes(actor.role));
    if (!project || !canManage) throw Object.assign(new Error('无项目管理员权限'), { statusCode: 403 });
    const body = request.body as any;
    const target = await db.query.accounts.findFirst({ where: eq(schema.accounts.username, text(body.username, 3, 32).toLowerCase()) });
    if (!target || target.disabledAt) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    const role = ['viewer', 'commenter', 'editor', 'manager'].includes(body.role) ? body.role : 'viewer';
    const createdAt = now();
    await db.insert(schema.projectMembers).values({ id: id(), projectId, accountId: target.id, role, persona: String(body.persona || ''), createdAt, updatedAt: createdAt }).onConflictDoUpdate({ target: [schema.projectMembers.projectId, schema.projectMembers.accountId], set: { role, updatedAt: createdAt } });
    return { ok: true };
  });
  app.patch('/api/resources/:id/persona', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'viewer');
    const body = request.body as any;
    const own = await db.query.resourceMembers.findFirst({ where: and(eq(schema.resourceMembers.resourceId, resourceId), eq(schema.resourceMembers.accountId, account.id)) });
    if (own && !own.locked) {
      await db.update(schema.resourceMembers).set({ persona: text(body.persona, 1, 40), updatedAt: now() }).where(eq(schema.resourceMembers.id, own.id));
    } else {
      await authorize(resourceId, account.id, 'manager');
      const targetId = text(body.accountId, 1, 100);
      await db.update(schema.resourceMembers).set({ persona: text(body.persona, 1, 40), locked: Boolean(body.locked), updatedAt: now() }).where(and(eq(schema.resourceMembers.resourceId, resourceId), eq(schema.resourceMembers.accountId, targetId)));
    }
    audit(account.id, 'persona.update', resourceId); return { ok: true };
  });
}
