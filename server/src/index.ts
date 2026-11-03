import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp();
try { await app.listen({ port: config.port, host: config.host }); }
catch (error) { app.log.error(error); process.exit(1); }

const close = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
