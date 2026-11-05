import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { authenticate } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { spaceRoutes } from './routes/spaces.js';
import { resourceRoutes } from './routes/resources.js';
import { shareRoutes } from './routes/shares.js';
import { smartRoutes } from './routes/smart.js';
import { fileRoutes } from './routes/files.js';
import { collaborationRoutes } from './modules/collaboration.js';
import { spreadsheetRoutes } from './routes/spreadsheets.js';
import { workspaceRoutes } from './routes/workspace.js';
import { officeRoutes } from './routes/office.js';
import { typeRoutes } from './modules/types.js';
import { adminRoutes } from './routes/admin.js';
import { recordRequest } from './modules/runtime.js';

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: Math.ceil(config.maxUploadBytes * 1.4) + 64 * 1024 });
  await app.register(cookie);
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } });
  await app.register(websocket);
  app.addHook('onRequest', async request => { (request as any).requestStartedAt = process.hrtime.bigint(); await authenticate(request); });
  app.addHook('onResponse', (request, reply, done) => {
    const started = (request as any).requestStartedAt as bigint | undefined;
    if (started) recordRequest(reply.statusCode, Number(process.hrtime.bigint() - started) / 1e6);
    done();
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  await app.register(authRoutes); await app.register(spaceRoutes); await app.register(resourceRoutes); await app.register(shareRoutes); await app.register(smartRoutes); await app.register(fileRoutes); await app.register(collaborationRoutes); await app.register(spreadsheetRoutes); await app.register(workspaceRoutes); await app.register(officeRoutes); await app.register(typeRoutes); await app.register(adminRoutes);
  const webDist = path.resolve('web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) return reply.code(404).send({ message: '接口不存在' });
      return reply.sendFile('index.html');
    });
  }
  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) request.log.error(error);
    reply.code(statusCode).send({ message: statusCode >= 500 ? '服务器处理失败，请稍后重试' : error.message });
  });
  return app;
}
