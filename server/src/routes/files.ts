import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAccount, audit } from '../auth.js';
import { config } from '../config.js';
import { id, now, sha256 } from '../utils.js';
import { authorize } from '../modules/permissions.js';
import { storage } from '../modules/storage.js';

const extensionTypes: Record<string, string> = { docx: 'office_document', xlsx: 'office_spreadsheet' };
export async function fileRoutes(app: FastifyInstance) {
  app.post('/api/upload', async (request) => {
    const account = requireAccount(request);
    const file = await request.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    if (!file) throw Object.assign(new Error('请选择文件'), { statusCode: 400 });
    const ext = file.filename.split('.').pop()?.toLowerCase() || '';
    if (['exe', 'dll', 'bat', 'cmd', 'sh', 'js', 'html', 'svg'].includes(ext)) throw Object.assign(new Error('不支持此文件类型'), { statusCode: 400 });
    const content = await file.toBuffer();
    const digest = sha256(content); const fileId = id(); const key = `${digest.slice(0, 2)}/${digest}`;
    const resourceId = id(); const projectId = String(file.fields.projectId && 'value' in file.fields.projectId ? file.fields.projectId.value : '') || null;
    if (projectId) {
      const member = await db.query.projectMembers.findFirst({ where: (t, { and, eq }) => and(eq(t.projectId, projectId), eq(t.accountId, account.id)) });
      if (!member || !['owner', 'manager', 'editor'].includes(member.role)) throw Object.assign(new Error('无项目上传权限'), { statusCode: 403 });
    }
    await storage.put(key, content); const createdAt = now();
    await db.insert(schema.fileObjects).values({ id: fileId, key, name: file.filename.slice(0, 200), mimeType: file.mimetype, size: content.length, sha256: digest, uploadedBy: account.id, createdAt });
    await db.insert(schema.resources).values({ id: resourceId, name: file.filename.slice(0, 100), type: extensionTypes[ext] || 'attachment', ownerId: account.id, projectId, mimeType: file.mimetype, fileId, createdAt, updatedAt: createdAt });
    audit(account.id, 'file.upload', resourceId, { size: content.length }); return { id: resourceId };
  });
  app.get('/api/files/:id', async (request, reply) => {
    const account = requireAccount(request); const fileId = (request.params as any).id;
    const resource = await db.query.resources.findFirst({ where: eq(schema.resources.fileId, fileId) });
    if (!resource) throw Object.assign(new Error('文件不存在'), { statusCode: 404 }); await authorize(resource.id, account.id, 'viewer');
    const file = await db.query.fileObjects.findFirst({ where: eq(schema.fileObjects.id, fileId) });
    if (!file) throw Object.assign(new Error('文件不存在'), { statusCode: 404 });
    reply.header('Content-Type', file.mimeType).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`).header('X-Content-Type-Options', 'nosniff');
    return reply.send(await storage.createReadStream(file.key));
  });
}
