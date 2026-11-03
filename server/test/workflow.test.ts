import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'together-docs-'));
process.env.DATABASE_PATH = join(temp, 'test.db');
process.env.LOCAL_STORAGE_DIR = join(temp, 'blobs');
const { buildApp } = await import('../src/app.js');
const app = await buildApp();
const cookies = new Map<string, string>();
async function request(user: string, method: string, url: string, body?: unknown) {
  const response = await app.inject({ method, url, payload: body as any, headers: { cookie: cookies.get(user) || '' } });
  const setCookie = response.headers['set-cookie'];
  if (setCookie) cookies.set(user, String(setCookie).split(';')[0]);
  return { status: response.statusCode, body: response.headers['content-type']?.includes('json') ? response.json() : response.body };
}

test('完整账号、空间、分享与行列权限工作流', async () => {
  assert.equal((await request('admin', 'POST', '/api/auth/bootstrap', { username: 'admin', displayName: '站长', password: 'password123' })).status, 200);
  assert.equal((await request('admin', 'POST', '/api/auth/bootstrap', { username: 'other', displayName: '其他', password: 'password123' })).status, 409);
  const invite = await request('admin', 'POST', '/api/admin/invites');
  assert.equal(invite.status, 200);
  assert.equal((await request('guest', 'POST', '/api/auth/register', { username: 'guest', displayName: '伙伴', password: 'password123', invite: invite.body.token })).status, 200);
  assert.equal((await request('outsider', 'POST', '/api/auth/register', { username: 'outsider', displayName: '外部', password: 'password123', invite: invite.body.token })).status, 400);
  const project = await request('admin', 'POST', '/api/projects', { name: '协作项目' });
  const table = await request('admin', 'POST', '/api/resources', { name: '任务表', type: 'smart_table', projectId: project.body.id });
  assert.equal(table.status, 200);
  const tableData = await request('admin', 'GET', `/api/resources/${table.body.id}/table`);
  const title = tableData.body.fields.find((f: any) => f.type === 'text');
  const record = await request('admin', 'POST', `/api/resources/${table.body.id}/records`);
  assert.equal((await request('admin', 'PATCH', `/api/resources/${table.body.id}/records/${record.body.id}`, { values: { [title.id]: '私有任务' } })).status, 200);
  assert.equal((await request('guest', 'GET', `/api/resources/${table.body.id}`)).status, 403);
  assert.equal((await request('admin', 'POST', `/api/resources/${table.body.id}/members`, { username: 'guest', role: 'editor' })).status, 200);
  assert.equal((await request('guest', 'GET', `/api/resources/${table.body.id}/table`)).body.records.length, 1);
  const adminAccounts = await request('admin', 'GET', '/api/admin/accounts');
  const guestId = adminAccounts.body.find((a: any) => a.username === 'guest').id;
  assert.equal((await request('admin', 'PUT', `/api/resources/${table.body.id}/policies`, { kind: 'row', targetId: record.body.id, accountId: guestId, access: 'hidden' })).status, 200);
  assert.equal((await request('guest', 'GET', `/api/resources/${table.body.id}/table`)).body.records.length, 0);
  assert.equal((await request('guest', 'PATCH', `/api/resources/${table.body.id}/records/${record.body.id}`, { values: { [title.id]: '越权修改' } })).status, 403);
  assert.equal((await request('admin', 'PUT', `/api/resources/${table.body.id}/policies`, { kind: 'row', targetId: record.body.id, accountId: guestId, access: 'viewer' })).status, 200);
  assert.equal((await request('admin', 'PUT', `/api/resources/${table.body.id}/policies`, { kind: 'field', targetId: title.id, accountId: guestId, access: 'hidden' })).status, 200);
  const filtered = await request('guest', 'GET', `/api/resources/${table.body.id}/table`);
  assert.equal(filtered.body.records.length, 1);
  assert.equal(filtered.body.fields.some((f: any) => f.id === title.id), false);
  assert.equal(filtered.body.records[0].values[title.id], undefined);
  assert.equal((await request('guest', 'PATCH', `/api/resources/${table.body.id}/records/${record.body.id}`, { values: { [title.id]: '越权修改' } })).status, 403);
  const share = await request('admin', 'POST', `/api/resources/${table.body.id}/shares`, { scope: 'both' });
  assert.equal((await request('guest', 'POST', '/api/shares/' + share.body.token + '/apply', { scope: 'document', role: 'viewer' })).status, 200);
  const inviteOnly = await app.inject({ method: 'POST', url: '/api/admin/invites', headers: { cookie: cookies.get('admin') || '' } });
  assert.equal(inviteOnly.statusCode, 200);
  const newRecord = await app.inject({ method: 'POST', url: `/api/resources/${table.body.id}/records`, headers: { cookie: cookies.get('admin') || '' } });
  assert.equal(newRecord.statusCode, 200);
  const requests = await request('admin', 'GET', `/api/resources/${table.body.id}/requests`);
  assert.equal(requests.body.length, 1);
  assert.equal((await request('admin', 'POST', `/api/requests/${requests.body[0].id}/review`, { approved: true, role: 'viewer' })).status, 200);
});

test('原生表格保存与下载授权', async () => {
  const sheet = await request('admin', 'POST', '/api/resources', { name: '统计表', type: 'native_spreadsheet' });
  assert.equal((await request('admin', 'POST', `/api/resources/${sheet.body.id}/spreadsheet`, { cells: { A1: '你好', B2: '42' } })).status, 200);
  assert.deepEqual((await request('admin', 'GET', `/api/resources/${sheet.body.id}/spreadsheet`)).body.cells, { A1: '你好', B2: '42' });
  assert.equal((await request('guest', 'GET', `/api/resources/${sheet.body.id}/spreadsheet`)).status, 403);
  const upload = await app.inject({ method: 'POST', url: '/api/upload', headers: { cookie: cookies.get('admin') || '', 'content-type': 'multipart/form-data; boundary=x' }, payload: '--x\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--x--\r\n' });
  assert.equal(upload.statusCode, 200);
  const file = await request('admin', 'GET', `/api/resources/${upload.json().id}`);
  assert.equal((await request('admin', 'GET', `/api/files/${file.body.fileId}`)).body, 'hello');
  assert.equal((await request('guest', 'GET', `/api/files/${file.body.fileId}`)).status, 403);
});

test.after(async () => { await app.close(); });
