import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { requireAccount } from '../auth.js';
import { id, now, sha256 } from '../utils.js';
import { storage } from './storage.js';

export interface DocumentTypeDriver {
  type: string;
  label: string;
  extensions: string[];
  canImport: (extension: string, mimeType: string) => boolean;
  createResource: (fileName: string, mimeType: string, fileId: string) => Promise<unknown> | unknown;
  editor: 'native' | 'betteroffice' | 'file';
  canExport: boolean;
}

const drivers: DocumentTypeDriver[] = [
  { type: 'native_document', label: '文档', extensions: [], canImport: () => false, createResource: () => null, editor: 'native', canExport: true },
  { type: 'native_spreadsheet', label: '表格', extensions: ['csv'], canImport: ext => ext === 'csv', createResource: () => null, editor: 'native', canExport: true },
  { type: 'smart_table', label: '智能表格', extensions: [], canImport: () => false, createResource: () => null, editor: 'native', canExport: true },
  { type: 'office_document', label: 'Word 文档', extensions: ['docx'], canImport: ext => ext === 'docx', createResource: () => null, editor: 'betteroffice', canExport: true },
  { type: 'office_spreadsheet', label: 'Excel 表格', extensions: ['xlsx'], canImport: ext => ext === 'xlsx', createResource: () => null, editor: 'betteroffice', canExport: true },
  { type: 'attachment', label: '附件', extensions: ['*'], canImport: () => true, createResource: () => null, editor: 'file', canExport: false },
];

export function registerType(driver: DocumentTypeDriver) { drivers.push(driver); }
export function allTypes() { return drivers; }
export function resolveType(extension: string, mimeType: string) {
  return drivers.find(driver => driver.canImport(extension, mimeType)) || drivers.find(driver => driver.type === 'attachment')!;
}

export async function typeRoutes(app: FastifyInstance) {
  app.get('/api/document-types', async request => {
    requireAccount(request);
    return drivers.map(({ type, label, extensions, editor, canExport }) => ({ type, label, extensions, editor, canExport }));
  });
}

export const extensionTypes: Record<string, string> = { docx: 'office_document', xlsx: 'office_spreadsheet' };

export async function createUploadResource(account: any, fileName: string, mimeType: string, extension: string, content: Buffer, projectId: string | null) {
  const digest = sha256(content); const key = `${digest.slice(0, 2)}/${digest}`; const fileId = id(); const resourceId = id(); const createdAt = now();
  await storage.put(key, content);
  await db.insert(schema.fileObjects).values({ id: fileId, key, name: fileName.slice(0, 200), mimeType, size: content.length, sha256: digest, uploadedBy: account.id, createdAt });
  const driver = resolveType(extension, mimeType);
  await db.insert(schema.resources).values({ id: resourceId, name: fileName.slice(0, 100), type: driver.type, ownerId: account.id, projectId, mimeType, fileId, createdAt, updatedAt: createdAt });
  return { resourceId, fileId, type: driver.type };
}
