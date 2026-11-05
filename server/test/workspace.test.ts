import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'together-docs-workspace-'));
process.env.DATABASE_PATH = join(temp, 'test.db');
process.env.LOCAL_STORAGE_DIR = join(temp, 'blobs');
const { buildApp } = await import('../src/app.js');
const app = await buildApp();
const cookies = new Map<string, string>();
async function request(user: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await app.inject({ method, url, payload: body as any, headers: { cookie: cookies.get(user) || '', ...headers } });
  const setCookie = response.headers['set-cookie'];
  if (setCookie) cookies.set(user, String(setCookie).split(';')[0]);
  return { status: response.statusCode, body: response.headers['content-type']?.includes('json') ? response.json() : response.body, headers: response.headers };
}

test('工作台、评论、分享配置、视图和导出', async () => {
  assert.equal((await request('admin', 'POST', '/api/auth/bootstrap', { username: 'admin', displayName: '站长', password: 'password123' })).status, 200);
  const invite = await request('admin', 'POST', '/api/admin/invites');
  await request('guest', 'POST', '/api/auth/register', { username: 'guest', displayName: '伙伴', password: 'password123', invite: invite.body.token });
  const folder = await request('admin', 'POST', '/api/resources', { name: '资料库', type: 'folder' });
  const table = await request('admin', 'POST', '/api/resources', { name: '任务表', type: 'smart_table', parentId: folder.body.id });
  assert.equal((await request('admin', 'GET', '/api/bootstrap')).body.resources.some((r: any) => r.parentId === folder.body.id), true);
  assert.equal((await request('admin', 'PUT', `/api/resources/${table.body.id}/favorite`, {})).status, 200);
  assert.equal((await request('admin', 'GET', '/api/workspace/favorites')).body.length, 1);
  await request('admin', 'POST', `/api/resources/${table.body.id}/visit`, {});
  assert.equal((await request('admin', 'GET', '/api/workspace/recent')).body.length, 1);
  const accounts = await request('admin', 'GET', '/api/admin/accounts');
  const guestId = accounts.body.find((a: any) => a.username === 'guest').id;
  assert.equal((await request('admin', 'POST', `/api/resources/${table.body.id}/members`, { username: 'guest', role: 'editor' })).status, 200);
  assert.equal((await request('guest', 'POST', `/api/resources/${table.body.id}/comments`, { content: '测试评论' })).status, 200);
  assert.equal((await request('guest', 'GET', `/api/resources/${table.body.id}/comments`)).body[0].persona, '伙伴');
  const viewerResource = await request('admin', 'POST', '/api/resources', { name: '只读文档', type: 'native_document' });
  await request('admin', 'POST', `/api/resources/${viewerResource.body.id}/members`, { username: 'guest', role: 'viewer' });
  assert.equal((await request('guest', 'POST', `/api/resources/${viewerResource.body.id}/comments`, { content: '越权评论' })).status, 403);
  const share = await request('admin', 'POST', `/api/resources/${table.body.id}/shares`, { scope: 'document', password: 'secret-pass', defaultRole: 'commenter', requireApproval: true });
  assert.equal((await request('guest', 'POST', `/api/shares/${share.body.token}/apply`, { scope: 'document', password: 'wrong' })).status, 401);
  assert.equal((await request('guest', 'POST', `/api/shares/${share.body.token}/apply`, { scope: 'document', password: 'secret-pass' })).status, 200);
  assert.equal((await request('guest', 'POST', `/api/shares/${share.body.token}/apply`, { scope: 'document', password: 'secret-pass' })).status, 409);
  const requests = await request('admin', 'GET', '/api/workspace/requests');
  assert.equal(requests.body.some((r: any) => r.status === 'pending'), true);
  const pending = requests.body.find((r: any) => r.status === 'pending');
  assert.equal(pending.role, 'commenter');
  assert.equal((await request('admin', 'POST', `/api/requests/${pending.id}/review`, { approved: true })).status, 200);
  assert.equal((await request('guest', 'GET', '/api/notifications')).body.some((n: any) => n.title.includes('已通过')), true);
  const view = await request('admin', 'POST', `/api/resources/${table.body.id}/views`, { name: '任务看板', type: 'kanban', configuration: { groupField: 'status' } });
  assert.equal(view.status, 200);
  assert.equal((await request('admin', 'GET', `/api/resources/${table.body.id}/table`)).body.views.length, 1);
  const record = await request('admin', 'POST', `/api/resources/${table.body.id}/records`, {});
  const fields = (await request('admin', 'GET', `/api/resources/${table.body.id}/table`)).body.fields;
  const title = fields.find((f: any) => f.type === 'text');
  await request('admin', 'PATCH', `/api/resources/${table.body.id}/records/${record.body.id}`, { values: { [title.id]: '私有内容' } });
  await request('admin', 'PUT', `/api/resources/${table.body.id}/policies`, { kind: 'field', targetId: title.id, accountId: guestId, access: 'hidden' });
  const exportText = await request('guest', 'GET', `/api/resources/${table.body.id}/table/export`);
  assert.equal(exportText.body.includes('私有内容'), false);
  assert.equal((await request('admin', 'GET', `/api/resources/${table.body.id}/table/export`)).body.includes('私有内容'), true);
  assert.equal((await request('admin', 'DELETE', `/api/resources/${table.body.id}`)).status, 200);
  assert.equal((await request('admin', 'GET', '/api/workspace/trash')).body.length, 1);
  assert.equal((await request('admin', 'POST', `/api/resources/${table.body.id}/restore`, {})).status, 200);
  assert.equal((await request('admin', 'GET', '/api/workspace/trash')).body.length, 0);
  assert.equal((await request('admin', 'GET', '/api/document-types')).body.some((type: any) => type.type === 'office_document'), true);
});

test('BetterOffice 状态、保存和文档类型注册', async () => {
  const upload = await app.inject({ method: 'POST', url: '/api/upload', headers: { cookie: cookies.get('admin') || '', 'content-type': 'multipart/form-data; boundary=x' }, payload: '--x\r\nContent-Disposition: form-data; name="file"; filename="sample.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\nPK\x03\x04test\r\n--x--\r\n' });
  const resourceId = upload.json().id;
  const detail = await request('admin', 'GET', `/api/resources/${resourceId}`);
  assert.equal(detail.body.type, 'office_document');
  const state = await request('admin', 'GET', `/api/resources/${resourceId}/office-state?format=docx`);
  assert.equal(state.status, 200);
  assert.equal(state.body.format, 'docx');
  const saved = await request('admin', 'POST', `/api/resources/${resourceId}/office-save`, { content: Buffer.from('updated docx').toString('base64') });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.body.fileId, detail.body.fileId);
  assert.equal((await request('admin', 'GET', `/api/files/${saved.body.fileId}`)).body, 'updated docx');
  assert.equal((await request('guest', 'POST', `/api/resources/${resourceId}/office-save`, { content: Buffer.from('overwrite').toString('base64') })).status, 403);
  const types = await request('admin', 'GET', '/api/document-types');
  assert.equal(types.body.some((type: any) => type.editor === 'betteroffice'), true);
});

test.after(async () => { await app.close(); });
