import { useEffect, useState } from 'react';
import { Eye, KeyRound, LogOut, Plus, ShieldCheck, UserX } from 'lucide-react';
import Modal from '../Modal';
import { ConfirmDialog, PromptDialog } from '../Dialogs';
import { AdminBadge, AdminKeyValue, AdminPagination, AdminTable, AdminToolbar, RefreshButton } from './AdminUI';
import { buildQuery, formatDate } from '../../format';
import { adminApi, useAdminAction, useAdminData, usePagedQuery } from './hooks';

type UserRow = {
  id: string; username: string; displayName: string; siteAdmin: boolean; disabledAt: string | null;
  createdAt: string; updatedAt: string; activeSessions: number; lastLoginAt: string | null;
  ownedResources: number; resourceMemberships: number; projectMemberships: number; comments: number; uploads: number; unreadNotifications: number;
};
type ListData = { items: UserRow[]; total: number; page: number; pageSize: number };
type UserDetail = {
  account: { id: string; username: string; displayName: string; siteAdmin: boolean; disabledAt: string | null; createdAt: string; updatedAt: string };
  sessions: { id: string; createdAt: string; expiresAt: string; active: boolean }[];
  resources: { id: string; name: string; type: string; deletedAt: string | null; updatedAt: string }[];
  projectMemberships: { id: string; projectId: string; role: string; roleLabel: string; project: { id: string; name: string } }[];
  resourceMemberships: { id: string; resourceId: string; role: string; roleLabel: string; resource: { id: string; name: string; type: string } }[];
  logs: { id: string; action: string; createdAt: string; detailJson: string }[];
  liveConnections: { id: string; resourceId: string; kind: string; connectedAt: string }[];
};

export default function UsersTab() {
  const q = usePagedQuery({ pageSize: '20' });
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [reset, setReset] = useState<UserRow | null>(null);
  const [rename, setRename] = useState<UserRow | null>(null);
  const [logout, setLogout] = useState<UserRow | null>(null);
  const [toggleAdmin, setToggleAdmin] = useState<UserRow | null>(null);
  const [disable, setDisable] = useState<UserRow | null>(null);
  useEffect(() => { q.set('search', search); }, [search]);
  useEffect(() => { q.set('state', state); }, [state]);
  const url = `/api/admin/users${buildQuery({ search, state, page: q.state.page, pageSize: q.state.pageSize })}`;
  const { data, busy, reload } = useAdminData<ListData>(url);
  const action = useAdminAction(reload);

  async function openDetail(id: string) {
    try { setDetail(await adminApi.get<UserDetail>(`/api/admin/users/${id}`)); }
    catch (e) { action.setError((e as Error).message); }
  }
  async function refreshDetail(id: string) { await reload(); await openDetail(id); }

  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}
    {action.message && <div className="success-message">{action.message}</div>}
    <AdminToolbar search={search} onSearch={setSearch} placeholder="搜索用户名或昵称…" filters={[
      { label: '账号状态', value: state, options: [{ value: '', label: '全部账号' }, { value: 'active', label: '正常' }, { value: 'disabled', label: '已禁用' }], onChange: setState },
    ]}>
      <button className="primary" onClick={() => { setForm({ username: '', displayName: '', password: '' }); setCreate(true); }}><Plus size={14} /> 新建账号</button>
      <RefreshButton onClick={reload} busy={busy} />
    </AdminToolbar>
    <AdminTable headers={['账号', '身份', '状态', '资源 / 协作', '会话', '最近登录', '创建时间', '操作']} rows={(data?.items || []).map(item => [
      <div className="cell-main"><strong>{item.displayName}</strong><span>@{item.username}</span></div>,
      item.siteAdmin ? <AdminBadge tone="info"><ShieldCheck size={11} /> 站长</AdminBadge> : <AdminBadge>成员</AdminBadge>,
      item.disabledAt ? <AdminBadge tone="bad">已禁用</AdminBadge> : <AdminBadge tone="good">正常</AdminBadge>,
      <div className="cell-main"><span>拥有 {item.ownedResources} · 协作 {item.resourceMemberships + item.projectMemberships}</span><span>评论 {item.comments} · 上传 {item.uploads}</span></div>,
      <span>{item.activeSessions} 个</span>, <span>{formatDate(item.lastLoginAt)}</span>, <span>{formatDate(item.createdAt)}</span>,
      <div className="cell-actions">
        <button onClick={() => openDetail(item.id)}><Eye size={12} /> 详情</button>
        <button onClick={() => setRename(item)}>编辑</button>
        <button onClick={() => setReset(item)}><KeyRound size={12} /> 改密</button>
        <button onClick={() => setToggleAdmin(item)}>{item.siteAdmin ? '撤销站长' : '设为站长'}</button>
        <button onClick={() => setLogout(item)}><LogOut size={12} /> 强制退出</button>
        <button className={item.disabledAt ? '' : 'danger'} onClick={() => setDisable(item)}><UserX size={12} /> {item.disabledAt ? '启用' : '禁用'}</button>
      </div>,
    ])} empty="没有符合条件的账号" />
    {data && <AdminPagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={q.setPage} />}

    {detail && <Modal title={`账号详情 · ${detail.account.displayName}`} onClose={() => setDetail(null)} wide><div className="admin-drawer-body">
      <AdminKeyValue items={[
        ['账号 ID', <span className="mono">{detail.account.id}</span>],
        ['用户名 / 昵称', `@${detail.account.username} · ${detail.account.displayName}`],
        ['身份', detail.account.siteAdmin ? '站长' : '普通成员'],
        ['状态', detail.account.disabledAt ? `已禁用（${formatDate(detail.account.disabledAt)}）` : '正常'],
        ['创建 / 更新', `${formatDate(detail.account.createdAt)} / ${formatDate(detail.account.updatedAt)}`],
        ['活跃协同连接', `${detail.liveConnections.length} 个`],
      ]} />
      <div className="admin-drawer-section"><h4>拥有的资源（{detail.resources.length}）</h4>
        <AdminTable headers={['名称', '类型', '状态', '更新时间']} rows={detail.resources.map(item => [item.name, item.type, item.deletedAt ? '回收站' : '正常', formatDate(item.updatedAt)])} empty="暂无资源" />
      </div>
      <div className="admin-drawer-section"><h4>项目成员身份（{detail.projectMemberships.length}）</h4>
        <AdminTable headers={['项目', '角色']} rows={detail.projectMemberships.map(item => [item.project.name, item.roleLabel])} empty="未加入任何项目" />
      </div>
      <div className="admin-drawer-section"><h4>文档直接授权（{detail.resourceMemberships.length}）</h4>
        <AdminTable headers={['文档', '类型', '角色']} rows={detail.resourceMemberships.map(item => [item.resource.name, item.resource.type, item.roleLabel])} empty="暂无直接授权" />
      </div>
      <div className="admin-drawer-section"><h4>登录会话（{detail.sessions.length}）</h4>
        <AdminTable headers={['创建时间', '过期时间', '状态', '操作']} rows={detail.sessions.map(session => [formatDate(session.createdAt), formatDate(session.expiresAt), session.active ? '有效' : '已过期',
          <div className="cell-actions"><button className="danger" onClick={() => action.run(() => adminApi.del(`/api/admin/sessions/${session.id}`), '会话已撤销').then(() => refreshDetail(detail.account.id))}>撤销</button></div>])} empty="暂无会话" />
      </div>
      <div className="admin-drawer-section"><h4>最近操作</h4><div className="admin-logs">{detail.logs.slice(0, 20).map(log => <div className="admin-log-row" key={log.id}><time>{formatDate(log.createdAt)}</time><strong>{log.action}</strong><span>{log.detailJson}</span></div>)}</div></div>
    </div></Modal>}

    {create && <Modal title="新建站点账号" onClose={() => setCreate(false)}><div className="create-form">
      <p className="muted">直接创建账号，无需邀请链接。密码至少 8 个字符；创建后请通知本人登录修改。</p>
      <label>用户名<input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="例如：alice" maxLength={32} /></label>
      <label>显示昵称<input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} placeholder="例如：小李" maxLength={50} /></label>
      <label>初始密码<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="至少 8 位" maxLength={128} /></label>
      <button className="primary large" disabled={action.busy} onClick={async () => { await action.run(() => adminApi.post('/api/admin/users', form), '账号已创建'); setCreate(false); }}>创建账号</button>
    </div></Modal>}
    {rename && <PromptDialog title="编辑账号资料" description={`修改 @${rename.username} 的显示昵称。`} initialValue={rename.displayName} onSubmit={async value => { await action.run(() => adminApi.patch(`/api/admin/users/${rename.id}`, { displayName: value }), '资料已更新'); if (detail?.account.id === rename.id) await refreshDetail(rename.id); setRename(null); }} onClose={() => setRename(null)} />}
    {reset && <PromptDialog title="重置密码" description={`重置 @${reset.username} 的密码会强制退出其全部会话和协同连接。`} placeholder="输入新密码（至少 8 位）" confirmText="重置密码" onSubmit={async value => { await action.run(() => adminApi.post(`/api/admin/users/${reset.id}/password`, { password: value }), '密码已重置'); setReset(null); }} onClose={() => setReset(null)} />}
    {logout && <ConfirmDialog title="强制退出" description={<>将撤销 @{logout.username} 的全部登录会话，并关闭其协同连接。</>} confirmText="强制退出" onClose={() => setLogout(null)} onConfirm={async () => { await action.run(() => adminApi.post(`/api/admin/users/${logout.id}/logout`, {}), '已强制退出'); if (detail?.account.id === logout.id) await refreshDetail(logout.id); setLogout(null); }} />}
    {toggleAdmin && <ConfirmDialog title={toggleAdmin.siteAdmin ? '撤销站长权限' : '设为站长'} description={<>{toggleAdmin.siteAdmin ? '撤销后该账号将成为普通成员，仍保留其资源所有权。' : '设为站长后该账号将拥有全站管理权限，请谨慎操作。'} 目标账号：{toggleAdmin.displayName} (@{toggleAdmin.username})。</>} confirmText="确认" onClose={() => setToggleAdmin(null)} onConfirm={async () => { await action.run(() => adminApi.patch(`/api/admin/users/${toggleAdmin.id}`, { siteAdmin: !toggleAdmin.siteAdmin }), '身份已更新'); setToggleAdmin(null); }} />}
    {disable && <ConfirmDialog title={disable.disabledAt ? '启用账号' : '禁用账号'} description={<>{disable.disabledAt ? '启用后该账号可以重新登录。' : '禁用后该账号将无法登录，所有会话和协同连接会立即关闭。'} 目标账号：{disable.displayName} (@{disable.username})。</>} confirmText="确认" danger={!disable.disabledAt} onClose={() => setDisable(null)} onConfirm={async () => { await action.run(() => adminApi.patch(`/api/admin/users/${disable.id}`, { disabled: !disable.disabledAt }), '账号状态已更新'); if (detail?.account.id === disable.id) await refreshDetail(disable.id); setDisable(null); }} />}
  </div>;
}

