import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { encoding, decoding } from 'lib0';
import { db, schema } from '../db/index.js';
import { id, now } from '../utils.js';
import { authorize, requireRole } from '../modules/permissions.js';

type Client = { socket: any; accountId: string; role: string };
type Room = { doc: Y.Doc; awareness: awarenessProtocol.Awareness; clients: Set<Client>; accountId: string; role: string; saveTimer?: NodeJS.Timeout };
const rooms = new Map<string, Room>();

async function loadDocument(resourceId: string) {
  const doc = new Y.Doc();
  const snapshot = await db.query.collabSnapshots.findFirst({ where: eq(schema.collabSnapshots.resourceId, resourceId) });
  if (snapshot) Y.applyUpdate(doc, Buffer.from(snapshot.data, 'base64'));
  const updates = await db.query.collabUpdates.findMany({ where: eq(schema.collabUpdates.resourceId, resourceId) });
  for (const update of updates) Y.applyUpdate(doc, Buffer.from(update.data, 'base64'));
  return doc;
}
function save(resourceId: string, room: Room) {
  db.transaction(tx => {
    tx.insert(schema.collabSnapshots).values({ id: id(), resourceId, data: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64'), updatedAt: now() }).onConflictDoUpdate({ target: schema.collabSnapshots.resourceId, set: { data: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64'), updatedAt: now() } }).run();
    tx.delete(schema.collabUpdates).where(eq(schema.collabUpdates.resourceId, resourceId)).run();
  });
}

export async function collaborationRoutes(app: FastifyInstance) {
  app.get('/ws/documents/:id', { websocket: true }, async (socket, request) => {
    const resourceId = (request.params as any).id; const account = request.account!;
    const { role } = await authorize(resourceId, account.id, 'viewer');
    let room = rooms.get(resourceId);
    if (!room) {
      const doc = await loadDocument(resourceId); const awareness = new awarenessProtocol.Awareness(doc);
      room = { doc, awareness, clients: new Set(), accountId: account.id, role };
      rooms.set(resourceId, room);
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === 'load') return;
        db.insert(schema.collabUpdates).values({ resourceId, data: Buffer.from(update).toString('base64'), createdAt: now() }).run();
        for (const client of room!.clients) {
          const message = encoding.createEncoder(); encoding.writeVarUint(message, 0); syncProtocol.writeUpdate(message, update);
          if (client.socket.readyState === 1) client.socket.send(encoding.toUint8Array(message));
        }
        clearTimeout(room!.saveTimer); room!.saveTimer = setTimeout(() => save(resourceId, room!), 5000);
      });
      awareness.on('update', ({ added, updated, removed }: any) => {
        const changed = added.concat(updated, removed); const message = encoding.createEncoder();
        encoding.writeVarUint(message, 1); encoding.writeVarUint8Array(message, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
        for (const client of room!.clients) if (client.socket.readyState === 1) client.socket.send(encoding.toUint8Array(message));
      });
    }
    const client: Client = { socket, accountId: account.id, role }; room.clients.add(client);
    const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); syncProtocol.writeSyncStep1(encoder, room.doc); socket.send(encoding.toUint8Array(encoder));
    socket.on('message', async (raw: Buffer) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(raw)); const messageType = decoding.readVarUint(decoder); const response = encoding.createEncoder(); encoding.writeVarUint(response, messageType);
        if (messageType === 0) {
          const permission = await authorize(resourceId, client.accountId, 'editor');
          client.role = permission.role;
          syncProtocol.readSyncMessage(decoder, response, room!.doc, null);
          if (encoding.length(response) > 1) socket.send(encoding.toUint8Array(response));
        } else if (messageType === 1) awarenessProtocol.applyAwarenessUpdate(room!.awareness, decoding.readVarUint8Array(decoder), socket);
      } catch (error) { socket.send(JSON.stringify({ error: '协同消息无效或权限不足' })); }
    });
    socket.on('close', () => {
      room!.clients.delete(client); awarenessProtocol.removeAwarenessStates(room!.awareness, [room!.doc.clientID], null);
      if (!room!.clients.size) { clearTimeout(room!.saveTimer); save(resourceId, room!); room!.doc.destroy(); rooms.delete(resourceId); }
    });
  });
  app.post('/api/resources/:id/versions', async (request) => {
    const account = request.account!; const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'editor'); const room = rooms.get(resourceId);
    const data = Buffer.from(room ? Y.encodeStateAsUpdate(room.doc) : Y.encodeStateAsUpdate(await loadDocument(resourceId))).toString('base64');
    await db.insert(schema.versions).values({ id: id(), resourceId, name: String((request.body as any)?.name || '手动版本').slice(0, 80), data, createdBy: account.id, createdAt: now() }); return { ok: true };
  });
  app.get('/api/resources/:id/versions', async (request) => { const account = request.account!; const resourceId = (request.params as any).id; await authorize(resourceId, account.id, 'viewer'); return db.query.versions.findMany({ where: eq(schema.versions.resourceId, resourceId), columns: { data: false } }); });
  app.post('/api/resources/:id/versions/:versionId/restore', async (request) => {
    const account = request.account!; const { id: resourceId, versionId } = request.params as any; await authorize(resourceId, account.id, 'editor');
    const version = await db.query.versions.findFirst({ where: eq(schema.versions.id, versionId) }); if (!version) throw Object.assign(new Error('版本不存在'), { statusCode: 404 });
    const doc = await loadDocument(resourceId); Y.applyUpdate(doc, Buffer.from(version.data, 'base64')); const room = rooms.get(resourceId);
    if (room) { Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(doc)); } else {
      await db.insert(schema.collabSnapshots).values({ id: id(), resourceId, data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), updatedAt: now() }).onConflictDoUpdate({ target: schema.collabSnapshots.resourceId, set: { data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), updatedAt: now() } });
    } return { ok: true };
  });
}
