import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'together-docs-admin-'));
process.env.DATABASE_PATH = join(temp, 'test.db');
process.env.DATA_DIR = temp;
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

test('站点后台：总览、鉴权、文档、用户、配置、数据与运行状态', async () => {
  assert.equal((await request('admin', 'POST', '/api/auth/bootstrap', { username: 'admin', displayName: '站长', password: 'password123' })).status, 200);
  // 非站长不可访问任何后台端点
  const invite = await request('admin', 'POST', '/api/admin/invites', { days: 30 });
  assert.equal(invite.status, 200);
  assert.equal((await request('guest', 'POST', '/api/auth/register', { username: 'guest', displayName: '伙伴', password: 'password123', invite: invite.body.token })).status, 200);
  for (const url of ['/api/admin/overview', '/api/admin/resources', '/api/admin/users', '/api/admin/settings', '/api/admin/runtime', '/api/admin/data', '/api/admin/audit']) {
    assert.equal((await request('guest', 'GET', url)).status, 403, `非站长不应访问 ${url}`);
  }

  // 总览数据
  const overview = await request('admin', 'GET', '/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.counts.accounts, 2);
  assert.ok(Array.isArray(overview.body.resourcesByType));

  // 站长直接创建账号
  assert.equal((await request('admin', 'POST', '/api/admin/users', { username: 'member2', displayName: '成员二', password: 'password123' })).status, 200);
  assert.equal((await request('admin', 'POST', '/api/admin/users', { username: 'member2', displayName: '重复', password: 'password123' })).status, 409);
  const users = await request('admin', 'GET', '/api/admin/users?search=member2');
  assert.equal(users.body.total, 1);
  const memberId = users.body.items[0].id;
  const guestId = (await request('admin', 'GET', '/api/admin/users?search=guest')).body.items[0].id;

  // 用户资料、禁用、启用、密码重置、会话强制退出
  assert.equal((await request('admin', 'PATCH', `/api/admin/users/${memberId}`, { displayName: '成员二改' })).status, 200);
  assert.equal((await request('admin', 'PATCH', `/api/admin/users/${guestId}`, { disabled: true })).status, 200);
  assert.equal((await request('guest', 'GET', '/api/bootstrap')).status, 401);
  assert.equal((await request('admin', 'PATCH', `/api/admin/users/${guestId}`, { disabled: false })).status, 200);
  assert.equal((await request('admin', 'POST', `/api/admin/users/${memberId}/password`, { password: 'newpassword123' })).status, 200);
  assert.equal((await request('admin', 'POST', `/api/admin/users/${memberId}/logout`, {})).status, 200);
  assert.equal((await request('admin', 'PATCH', `/api/admin/users/${guestId}`, { siteAdmin: true })).status, 200);
  assert.equal((await request('admin', 'PATCH', `/api/admin/users/${guestId}`, { siteAdmin: false })).status, 200);
  // 至少保留一位站长
  assert.equal((await request('admin', 'PATCH', '/api/admin/users/' + (await request('admin', 'GET', '/api/admin/users?search=admin')).body.items[0].id, { siteAdmin: false })).status, 400);
  const userDetail = await request('admin', 'GET', `/api/admin/users/${memberId}`);
  assert.equal(userDetail.status, 200);
  assert.ok(Array.isArray(userDetail.body.sessions));

  // 文档列表、详情、内容、批量与永久删除
  const folder = await request('admin', 'POST', '/api/resources', { name: '管理资料', type: 'folder' });
  const document = await request('admin', 'POST', '/api/resources', { name: '测试文档', type: 'native_document', parentId: folder.body.id });
  await request('admin', 'POST', `/api/resources/${document.body.id}/spreadsheet`, { cells: {} }).catch(() => {});
  const resourceList = await request('admin', 'GET', '/api/admin/resources?search=测试文档&state=active');
  assert.equal(resourceList.status, 200);
  assert.equal(resourceList.body.total, 1);
  assert.equal(resourceList.body.items[0].parentId, folder.body.id);
  const detail = await request('admin', 'GET', `/api/admin/resources/${document.body.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.parent.name, '管理资料');
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${document.body.id}/content`)).status, 200);
  assert.equal((await request('admin', 'POST', `/api/admin/resources/${document.body.id}/members`, { accountId: guestId, role: 'editor' })).status, 200);
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${document.body.id}`)).body.members.length, 1);
  assert.equal((await request('admin', 'DELETE', `/api/admin/resources/${document.body.id}/members/${guestId}`)).status, 200);
  assert.equal((await request('admin', 'PATCH', `/api/admin/resources/${document.body.id}`, { name: '改名文档' })).status, 200);
  assert.equal((await request('admin', 'POST', `/api/admin/resources/${document.body.id}/transfer`, { accountId: guestId })).status, 200);
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${document.body.id}`)).body.owner.username, 'guest');
  assert.equal((await request('admin', 'POST', `/api/admin/resources/bulk`, { ids: [document.body.id, folder.body.id], action: 'trash' })).status, 200);
  assert.equal((await request('admin', 'GET', '/api/admin/resources?state=trash')).body.total, 2);
  assert.equal((await request('admin', 'POST', `/api/admin/resources/bulk`, { ids: [document.body.id, folder.body.id], action: 'restore' })).status, 200);
  assert.equal((await request('admin', 'POST', '/api/admin/resources/bulk', { ids: [folder.body.id], action: 'purge' })).status, 200);
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${document.body.id}`)).status, 404);
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${folder.body.id}`)).status, 404);

  // 站点配置：只读环境变量、可保存设置并影响行为
  const settings = await request('admin', 'GET', '/api/admin/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.body.values.registrationMode, 'invite');
  assert.equal((await request('admin', 'PATCH', '/api/admin/settings', { values: { siteName: '协作站', sessionDays: 30, defaultRequireApproval: false, maxUploadBytes: 1024 * 1024 } })).status, 200);
  const updated = await request('admin', 'GET', '/api/admin/settings');
  assert.equal(updated.body.values.siteName, '协作站');
  assert.equal(updated.body.values.sessionDays, 30);
  assert.equal((await request('admin', 'PATCH', '/api/admin/settings', { values: { maxUploadBytes: 999999999999 } })).status, 400);
  assert.equal((await request('admin', 'GET', '/api/public-settings')).body.siteName, '协作站');
  const share = await request('admin', 'POST', `/api/resources/${(await request('admin', 'POST', '/api/resources', { name: '分享文档', type: 'native_document' })).body.id}/shares`, {});
  void share;
  const shares = await request('admin', 'GET', '/api/admin/shares');
  assert.equal(shares.body[0].requireApproval, false);
  assert.equal((await request('admin', 'PATCH', `/api/admin/shares/${shares.body[0].id}`, { enabled: false })).status, 200);
  // 关闭注册后邀请链接不可注册
  assert.equal((await request('admin', 'PATCH', '/api/admin/settings', { values: { registrationMode: 'closed' } })).status, 200);
  const closedInvite = await request('admin', 'POST', '/api/admin/invites', { days: 7 });
  assert.equal((await request('newbie', 'POST', '/api/auth/register', { username: 'newbie', displayName: '新用户', password: 'password123', invite: closedInvite.body.token })).status, 403);
  assert.equal((await request('admin', 'PATCH', '/api/admin/settings', { values: { registrationMode: 'invite' } })).status, 200);

  // 项目、邀请、评论、审计、会话列表
  const project = await request('admin', 'POST', '/api/projects', { name: '后台项目' });
  assert.equal((await request('admin', 'GET', '/api/admin/projects')).body.total, 1);
  assert.equal((await request('admin', 'POST', `/api/admin/projects/${project.body.id}/members`, { accountId: guestId, role: 'editor' })).status, 200);
  assert.equal((await request('admin', 'GET', `/api/admin/projects/${project.body.id}`)).body.members.length, 2);
  assert.equal((await request('admin', 'GET', '/api/admin/invites')).body.length >= 2, true);
  assert.equal((await request('admin', 'GET', '/api/admin/requests')).status, 200);
  assert.equal((await request('admin', 'GET', '/api/admin/comments')).status, 200);
  const sessions = await request('admin', 'GET', '/api/admin/sessions');
  assert.ok(sessions.body.total >= 1);
  const audit = await request('admin', 'GET', '/api/admin/audit?pageSize=5');
  assert.equal(audit.status, 200);
  assert.ok(audit.body.total > 0);
  assert.equal(audit.body.items.length <= 5, true);
  assert.ok(audit.body.items.some((row: any) => row.log.action === 'admin.settings.update'));

  // 数据、文件、备份、清理、运行状态
  const data = await request('admin', 'GET', '/api/admin/data');
  assert.equal(data.status, 200);
  assert.ok(data.body.counts.accounts >= 3);
  assert.equal((await request('admin', 'GET', '/api/admin/files')).status, 200);
  const backup = await request('admin', 'POST', '/api/admin/backups', {});
  assert.equal(backup.status, 200);
  assert.ok(backup.body.bytes > 0);
  assert.equal((await request('admin', 'GET', '/api/admin/data')).body.backups.length, 1);
  assert.equal((await request('admin', 'GET', `/api/admin/backups/${backup.body.name}/download`)).status, 200);
  const maintenance = await request('admin', 'POST', '/api/admin/maintenance', { actions: ['expiredSessions', 'orphanRows', 'oldVersions'] });
  assert.equal(maintenance.status, 200);
  assert.ok('expiredSessions' in maintenance.body.report);
  assert.equal((await request('admin', 'POST', '/api/admin/maintenance', { actions: ['notAllowed'] })).status, 400);
  const runtime = await request('admin', 'GET', '/api/admin/runtime?detailed=true');
  assert.equal(runtime.status, 200);
  assert.equal(runtime.body.status, 'ok');
  assert.ok(runtime.body.http.total > 0);
  assert.ok(Array.isArray(runtime.body.connections));
  assert.ok(Array.isArray(runtime.body.collaboration.rooms));
  // 备份恢复：数据仍在且站点可继续响应
  assert.equal((await request('admin', 'POST', `/api/admin/backups/${backup.body.name}/restore`, {})).status, 200);
  assert.equal((await request('admin', 'GET', '/api/admin/overview')).body.counts.accounts >= 3, true);
  assert.equal((await request('admin', 'DELETE', `/api/admin/backups/${backup.body.name}`)).status, 200);
});


test('管理接口回归：统计数值、邀请使用人、内容解析与回收站清理安全', async () => {
  // 项目与文件的引用计数必须是数字而不是 null
  const projects = await request('admin', 'GET', '/api/admin/projects');
  assert.equal(projects.status, 200);
  assert.equal(typeof projects.body.items[0].memberCount, 'number');
  assert.equal(typeof projects.body.items[0].resourceCount, 'number');
  const files = await request('admin', 'GET', '/api/admin/files');
  assert.equal(files.status, 200);
  for (const file of files.body.items) {
    assert.equal(typeof file.resourceCount, 'number');
    assert.equal(typeof file.versionCount, 'number');
  }
  // 已使用邀请的使用人应与创建人区分
  const invite = await request('admin', 'POST', '/api/admin/invites', { days: 7 });
  await request('third', 'POST', '/api/auth/register', { username: 'thirduser', displayName: '第三位', password: 'password123', invite: invite.body.token });
  const invites = await request('admin', 'GET', '/api/admin/invites');
  const used = invites.body.find((row: any) => row.invite.token === invite.body.token);
  assert.equal(used.usedByAccount.username, 'thirduser');
  assert.equal(used.creator.username, 'admin');

  // 原生表格存在手动版本（Yjs base64 状态）时，内容摘要仍可读取
  const sheet = await request('admin', 'POST', '/api/resources', { name: '回归表格', type: 'native_spreadsheet' });
  await request('admin', 'POST', `/api/resources/${sheet.body.id}/spreadsheet`, { cells: { A1: '可见' } });
  await request('admin', 'POST', `/api/resources/${sheet.body.id}/versions`, { name: '手动里程碑' });
  const content = await request('admin', 'GET', `/api/admin/resources/${sheet.body.id}/content`);
  assert.equal(content.status, 200);
  assert.equal(content.body.spreadsheet, null);

  // 文件夹移入回收站后，仍有活动子文档时不得被过期清理误删
  const folder = await request('admin', 'POST', '/api/resources', { name: '回归文件夹', type: 'folder' });
  const child = await request('admin', 'POST', '/api/resources', { name: '活动子文档', type: 'native_document', parentId: folder.body.id });
  await request('admin', 'POST', `/api/resources/${folder.body.id}/trash`, {});
  const { db, schema } = await import('../src/db/index.js');
  const { eq } = await import('drizzle-orm');
  db.update(schema.resources).set({ deletedAt: new Date(Date.now() - 60 * 86400000).toISOString() }).where(eq(schema.resources.id, folder.body.id)).run();
  const maintenance = await request('admin', 'POST', '/api/admin/maintenance', { actions: ['expiredTrash'] });
  assert.equal(maintenance.status, 200);
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${folder.body.id}`)).status, 200);
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${child.body.id}`)).status, 200);
  // 无活动后代的过期文件夹可以清理
  const emptyFolder = await request('admin', 'POST', '/api/resources', { name: '空过期文件夹', type: 'folder' });
  await request('admin', 'POST', `/api/resources/${emptyFolder.body.id}/trash`, {});
  db.update(schema.resources).set({ deletedAt: new Date(Date.now() - 60 * 86400000).toISOString() }).where(eq(schema.resources.id, emptyFolder.body.id)).run();
  await request('admin', 'POST', '/api/admin/maintenance', { actions: ['expiredTrash'] });
  assert.equal((await request('admin', 'GET', `/api/admin/resources/${emptyFolder.body.id}`)).status, 404);
});

test.after(async () => { await app.close(); });
