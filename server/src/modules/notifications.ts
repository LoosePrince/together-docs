import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { id, now } from '../utils.js';

export function notify(accountId: string, title: string, body = '', resourceId?: string) {
  db.insert(schema.notifications).values({ id: id(), accountId, title, body: body.slice(0, 300), resourceId, createdAt: now() }).run();
}

export async function notifyResourceMembers(resourceId: string, excludeAccountId: string, title: string, body = '') {
  const members = db.select({ accountId: schema.resourceMembers.accountId }).from(schema.resourceMembers).where(eq(schema.resourceMembers.resourceId, resourceId)).all();
  const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
  const projectMembers = resource?.projectId
    ? db.select({ accountId: schema.projectMembers.accountId }).from(schema.projectMembers).where(eq(schema.projectMembers.projectId, resource.projectId)).all()
    : [];
  const recipients = new Set([...members, ...projectMembers].map(member => member.accountId));
  if (resource?.ownerId) recipients.add(resource.ownerId);
  recipients.delete(excludeAccountId);
  if (!recipients.size) return;
  const createdAt = now();
  db.insert(schema.notifications).values([...recipients].map(accountId => ({ id: id(), accountId, title, body: body.slice(0, 300), resourceId, createdAt }))).run();
}

export async function displayPersona(resourceId: string, accountId: string): Promise<string> {
  const resource = await db.query.resources.findFirst({ where: eq(schema.resources.id, resourceId) });
  const direct = await db.query.resourceMembers.findFirst({ where: and(eq(schema.resourceMembers.resourceId, resourceId), eq(schema.resourceMembers.accountId, accountId)) });
  const membership = resource?.projectId
    ? await db.query.projectMembers.findFirst({ where: and(eq(schema.projectMembers.projectId, resource.projectId), eq(schema.projectMembers.accountId, accountId)) })
    : undefined;
  const account = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, accountId) });
  return direct?.persona || membership?.persona || account?.displayName || '成员';
}

export function bumpPermissionVersion(resourceId: string) {
  db.update(schema.resources).set({ permissionVersion: sql`${schema.resources.permissionVersion} + 1`, updatedAt: now() }).where(eq(schema.resources.id, resourceId)).run();
}
