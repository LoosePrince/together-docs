import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount } from '../auth.js';
import { authorize } from '../modules/permissions.js';
import { id, now } from '../utils.js';

export async function spreadsheetRoutes(app: FastifyInstance) {
  app.get('/api/resources/:id/spreadsheet', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    const { resource } = await authorize(resourceId, account.id, 'viewer');
    if (resource.type !== 'native_spreadsheet') throw Object.assign(new Error('不是原生表格'), { statusCode: 400 });
    const version = await db.query.versions.findFirst({ where: eq(schema.versions.resourceId, resourceId), orderBy: (t, { desc }) => desc(t.createdAt) });
    return { cells: version ? JSON.parse(version.data).cells || {} : {} };
  });
  app.post('/api/resources/:id/spreadsheet', async (request) => {
    const account = requireAccount(request); const resourceId = (request.params as any).id;
    const { resource } = await authorize(resourceId, account.id, 'editor');
    if (resource.type !== 'native_spreadsheet') throw Object.assign(new Error('不是原生表格'), { statusCode: 400 });
    const cells = (request.body as any)?.cells;
    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) throw Object.assign(new Error('表格数据无效'), { statusCode: 400 });
    const clean: Record<string, string> = {};
    for (const [cell, value] of Object.entries(cells)) {
      if (!/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(cell) || typeof value !== 'string' || value.length > 10000) throw Object.assign(new Error('单元格数据无效'), { statusCode: 400 });
      clean[cell] = value;
    }
    await db.insert(schema.versions).values({ id: id(), resourceId, name: '自动保存', data: JSON.stringify({ cells: clean }), createdBy: account.id, createdAt: now() });
    await db.update(schema.resources).set({ updatedAt: now() }).where(eq(schema.resources.id, resourceId));
    return { ok: true };
  });
}
