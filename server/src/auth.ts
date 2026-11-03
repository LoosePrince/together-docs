import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { config } from './config.js';
import { id, now, sha256, token } from './utils.js';

export type Account = typeof schema.accounts.$inferSelect;
declare module 'fastify' { interface FastifyRequest { account: Account | null } }

export function issueSession(reply: FastifyReply, accountId: string) {
  const raw = token();
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  db.insert(schema.sessions).values({ id: id(), accountId, tokenHash: sha256(raw), expiresAt, createdAt: now() }).run();
  reply.setCookie('td_session', raw, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https:'), expires: new Date(expiresAt) });
}

export async function authenticate(request: FastifyRequest) {
  request.account = null;
  const raw = request.cookies.td_session;
  if (!raw) return;
  const rows = await db.select({ account: schema.accounts }).from(schema.sessions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.sessions.accountId))
    .where(and(eq(schema.sessions.tokenHash, sha256(raw)), gt(schema.sessions.expiresAt, now()))).limit(1);
  if (rows[0] && !rows[0].account.disabledAt) request.account = rows[0].account;
}

export function requireAccount(request: FastifyRequest): Account {
  if (!request.account) throw Object.assign(new Error('请先登录'), { statusCode: 401 });
  return request.account;
}
export function requireSiteAdmin(request: FastifyRequest): Account {
  const account = requireAccount(request);
  if (!account.siteAdmin) throw Object.assign(new Error('仅站长可以执行此操作'), { statusCode: 403 });
  return account;
}
export function audit(accountId: string, action: string, resourceId?: string, detail: object = {}) {
  db.insert(schema.auditLogs).values({ id: id(), accountId, action, resourceId, detailJson: JSON.stringify(detail), createdAt: now() }).run();
}
