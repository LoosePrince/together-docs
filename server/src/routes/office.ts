import type { FastifyInstance } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { authorize } from '../modules/permissions.js';
import { config } from '../config.js';
import { id, now, sha256 } from '../utils.js';
import { storage } from '../modules/storage.js';

type Client = { socket: any; accountId: string; role: string };
type Room = { clients: Set<Client>; frames: Array<{ data: Buffer; frame: number }>; frame: number };
const rooms = new Map<string, Room>();
const MAX_REPLAY_BYTES = 12 * 1024 * 1024;
async function roomFor(resourceId: string, format: string) {
  let room = rooms.get(resourceId);
  if (room) return room;
  const stored = await db.query.officeRooms.findFirst({ where: eq(schema.officeRooms.resourceId, resourceId) });
  const frames: Room['frames'] = [];
  if (stored?.seed) frames.push({ data: Buffer.from(stored.seed, 'base64'), frame: 0 });
  const tail = await db.query.collabUpdates.findMany({ where: eq(schema.collabUpdates.resourceId, resourceId), orderBy: [asc(schema.collabUpdates.id)] });
  for (const entry of tail) frames.push({ data: Buffer.from(entry.data, 'base64'), frame: entry.id });
  let bytes = frames.reduce((sum, frame) => sum + frame.data.length, 0);
  while (bytes > MAX_REPLAY_BYTES && frames.length > 1) {
    const removed = frames.shift()!;
    bytes -= removed.data.length;
    await db.delete(schema.collabUpdates).where(eq(schema.collabUpdates.id, removed.frame));
  }
  room = { clients: new Set(), frames, frame: frames.at(-1)?.frame || 0 };
  if (!stored) await db.insert(schema.officeRooms).values({ resourceId, format, seed: '', updatedAt: now() }).onConflictDoNothing();
  rooms.set(resourceId, room);
  return room;
}

export async function officeRoutes(app: FastifyInstance) {
  app.get('/api/resources/:id/office-state', async request => {
    const account = request.account!; const resourceId = (request.params as any).id;
    const { resource } = await authorize(resourceId, account.id, 'viewer');
    if (!['office_document', 'office_spreadsheet'].includes(resource.type)) throw Object.assign(new Error('不是 Office 文档'), { statusCode: 400 });
    const stored = await db.query.officeRooms.findFirst({ where: eq(schema.officeRooms.resourceId, resourceId) });
    return { format: resource.type === 'office_document' ? 'docx' : 'xlsx', initialUpdate: stored?.seed || null, hasReplay: Boolean(stored?.seed) };
  });
  app.get('/ws/office/:id', { websocket: true }, async (socket, request) => {
    const resourceId = (request.params as any).id;
    const account = request.account!;
    const { resource, role } = await authorize(resourceId, account.id, 'viewer');
    if (!['office_document', 'office_spreadsheet'].includes(resource.type)) throw Object.assign(new Error('不是 Office 文档'), { statusCode: 400 });
    const format = resource.type === 'office_document' ? 'docx' : 'xlsx';
    const room = await roomFor(resourceId, format);
    const client: Client = { socket, accountId: account.id, role };
    room.clients.add(client);
    socket.send(JSON.stringify({ type: 'peers', count: room.clients.size }));
    for (const peer of room.clients) if (peer.socket.readyState === 1) peer.socket.send(JSON.stringify({ type: 'peers', count: room.clients.size }));
    for (const frame of room.frames) if (socket.readyState === 1) socket.send(new Uint8Array(frame.data));
    socket.on('message', async (raw: Buffer) => {
      try {
        const permission = await authorize(resourceId, client.accountId, 'editor');
        client.role = permission.role;
        const data = Buffer.from(raw as any);
        if (!data.length || data.length > 1024 * 1024) throw new Error('协同帧大小无效');
        const result = db.insert(schema.collabUpdates).values({ resourceId, data: data.toString('base64'), createdAt: now() }).returning({ id: schema.collabUpdates.id }).get();
        room.frame = result!.id;
        room.frames.push({ data, frame: room.frame });
        for (const peer of room.clients) if (peer !== client && peer.socket.readyState === 1) peer.socket.send(new Uint8Array(data));
        let bytes = room.frames.reduce((sum, frame) => sum + frame.data.length, 0);
        while (bytes > MAX_REPLAY_BYTES && room.frames.length > 1) {
          const removed = room.frames.shift()!;
          bytes -= removed.data.length;
          db.delete(schema.collabUpdates).where(eq(schema.collabUpdates.id, removed.frame)).run();
        }
      } catch (error) { try { socket.send(JSON.stringify({ type: 'error', message: (error as Error).message })); } catch { /* 连接已关闭 */ } }
    });
    socket.on('close', () => {
      room.clients.delete(client);
      for (const peer of room.clients) if (peer.socket.readyState === 1) peer.socket.send(JSON.stringify({ type: 'peers', count: room.clients.size }));
      if (!room.clients.size) rooms.delete(resourceId);
    });
  });
  app.post('/api/resources/:id/office-save', async request => {
    const account = request.account!; const resourceId = (request.params as any).id;
    const { resource } = await authorize(resourceId, account.id, 'editor');
    if (!['office_document', 'office_spreadsheet'].includes(resource.type)) throw Object.assign(new Error('不是 Office 文档'), { statusCode: 400 });
    const content = (request.body as any)?.content;
    if (typeof content !== 'string' || !content.length) throw Object.assign(new Error('保存内容为空'), { statusCode: 400 });
    const bytes = Buffer.from(content, 'base64');
    if (bytes.length > config.maxUploadBytes) throw Object.assign(new Error('文件超出允许大小'), { statusCode: 400 });
    const digest = sha256(bytes); const key = `${digest.slice(0, 2)}/${digest}`;
    await storage.put(key, bytes);
    const fileId = id(); const createdAt = now();
    const oldFile = resource.fileId ? await db.query.fileObjects.findFirst({ where: eq(schema.fileObjects.id, resource.fileId) }) : undefined;
    db.transaction(tx => {
      tx.insert(schema.fileObjects).values({ id: fileId, key, name: oldFile?.name || resource.name, mimeType: oldFile?.mimeType || resource.mimeType || 'application/octet-stream', size: bytes.length, sha256: digest, uploadedBy: account.id, createdAt }).run();
      if (oldFile) tx.insert(schema.versions).values({ id: id(), resourceId, name: `Office 保存前 · ${createdAt}`, data: '{}', fileId: oldFile.id, createdBy: account.id, createdAt }).run();
      tx.update(schema.resources).set({ fileId, updatedAt: createdAt }).where(eq(schema.resources.id, resourceId)).run();
    });
    return { ok: true, fileId };
  });
}
