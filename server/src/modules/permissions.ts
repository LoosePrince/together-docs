import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type Role = 'viewer' | 'commenter' | 'editor' | 'manager' | 'owner';
const rank: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, manager: 4, owner: 5 };
export type Resource = typeof schema.resources.$inferSelect;

export function requireRole(actual: Role, needed: Role) {
  if (rank[actual] < rank[needed]) throw Object.assign(new Error('你没有此操作所需的权限'), { statusCode: 403 });
}

export async function resourcePermission(resourceId: string, accountId: string): Promise<{ resource: Resource; role: Role; source: string }> {
  const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
  if (!resource || resource.deletedAt) throw Object.assign(new Error('文档不存在或已删除'), { statusCode: 404 });
  const account = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, accountId) });
  if (!account || account.disabledAt) throw Object.assign(new Error('账号不可用'), { statusCode: 403 });
  if (account.siteAdmin) return { resource, role: 'owner', source: 'site_admin' };
  if (resource.ownerId === accountId) return { resource, role: 'owner', source: 'owner' };
  let role: Role = 'viewer';
  let source = '';
  if (resource.projectId) {
    const project = await db.query.projectMembers.findFirst({ where: and(eq(schema.projectMembers.projectId, resource.projectId), eq(schema.projectMembers.accountId, accountId)) });
    if (project) { role = project.role as Role; source = 'project'; }
  }
  const direct = await db.query.resourceMembers.findFirst({ where: and(eq(schema.resourceMembers.resourceId, resourceId), eq(schema.resourceMembers.accountId, accountId)) });
  if (direct && (!source || rank[direct.role as Role] > rank[role])) { role = direct.role as Role; source = 'resource'; }
  if (!source) throw Object.assign(new Error('你还没有访问此文档的权限'), { statusCode: 403 });
  return { resource, role, source };
}

export async function authorize(resourceId: string, accountId: string, needed: Role) {
  const result = await resourcePermission(resourceId, accountId);
  requireRole(result.role, needed);
  return result;
}
