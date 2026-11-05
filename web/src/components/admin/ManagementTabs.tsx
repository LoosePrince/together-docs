import { useEffect, useState } from 'react';
import { Archive, Copy, Eye, Plus, RotateCcw } from 'lucide-react';
import Modal from '../Modal';
import Select from '../Select';
import { ConfirmDialog } from '../Dialogs';
import { AdminBadge, AdminKeyValue, AdminPagination, AdminTable, AdminToolbar, RefreshButton } from './AdminUI';
import { buildQuery, formatDate } from '../../format';
import { adminApi, useAdminAction, useAdminData, usePagedQuery } from './hooks';

type ProjectRow = { id: string; name: string; description: string; ownerId: string; owner: { username: string; displayName: string } | null; archivedAt: string | null; createdAt: string; updatedAt: string; memberCount: number; resourceCount: number };
type ProjectDetail = { project: ProjectRow; members: { id: string; accountId: string; role: string; roleLabel: string; persona: string; account: { id: string; username: string; displayName: string } }[]; resources: { id: string; name: string; type: string; typeLabel: string; deletedAt: string | null; updatedAt: string }[] };

export function ProjectsTab() {
  const q = usePagedQuery({ pageSize: '20' });
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState('');
  const [removeProject, setRemoveProject] = useState<ProjectRow | null>(null);
  const [removeMember, setRemoveMember] = useState<{ projectId: string; accountId: string } | null>(null);
  const [addMember, setAddMember] = useState<string>('');
  const [accounts, setAccounts] = useState<{ id: string; username: string; displayName: string }[]>([]);
  const [memberAccount, setMemberAccount] = useState('');
  const [memberRole, setMemberRole] = useState('editor');
  useEffect(() => { q.set('search', search); }, [search]);
  useEffect(() => { adminApi.get<any[]>('/api/admin/accounts').then(setAccounts).catch(() => {}); }, []);
  const { data, busy, reload } = useAdminData<{ items: ProjectRow[]; total: number; page: number; pageSize: number }>(`/api/admin/projects${buildQuery({ search, page: q.state.page, pageSize: q.state.pageSize })}`);
  const detail = useAdminData<ProjectDetail>(detailId ? `/api/admin/projects/${detailId}` : null);
  const action = useAdminAction(async () => { await reload(); await detail.reload(); });
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <AdminToolbar search={search} onSearch={setSearch} placeholder="搜索项目名称…"><RefreshButton onClick={reload} busy={busy} /></AdminToolbar>
    <AdminTable headers={['项目', '所有者', '成员 / 资源', '状态', '创建时间', '操作']} rows={(data?.items || []).map(item => [
      <div className="cell-main"><strong>{item.name}</strong><span>{item.description || '无项目说明'}</span></div>,
      item.owner ? `${item.owner.displayName} (@${item.owner.username})` : '未知',
      `${item.memberCount} 人 / ${item.resourceCount} 个资源`,
      item.archivedAt ? <AdminBadge tone="warn">已归档</AdminBadge> : <AdminBadge tone="good">正常</AdminBadge>,
      formatDate(item.createdAt),
      <div className="cell-actions">
        <button onClick={() => setDetailId(item.id)}><Eye size={12} /> 详情</button>
        <button onClick={() => action.run(() => adminApi.post(`/api/admin/projects/${item.id}/archive`, { restore: Boolean(item.archivedAt) }), item.archivedAt ? '项目已恢复' : '项目已归档')}>{item.archivedAt ? <RotateCcw size={12} /> : <Archive size={12} />}{item.archivedAt ? '恢复' : '归档'}</button>
        <button className="danger" onClick={() => setRemoveProject(item)}>删除项目</button>
      </div>,
    ])} empty="暂无项目空间" />
    {data && <AdminPagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={q.setPage} />}
    {detail.data && <Modal title={`项目详情 · ${detail.data.project.name}`} onClose={() => setDetailId('')} wide><div className="admin-drawer-body">
      <AdminKeyValue items={[
        ['项目 ID', <span className="mono">{detail.data.project.id}</span>],
        ['所有者', `${detail.data.project.owner?.displayName || '未知'} (@${detail.data.project.owner?.username || '—'})`],
        ['说明', detail.data.project.description || '无'],
        ['状态', detail.data.project.archivedAt ? `已归档（${formatDate(detail.data.project.archivedAt)}）` : '正常'],
        ['创建 / 更新', `${formatDate(detail.data.project.createdAt)} / ${formatDate(detail.data.project.updatedAt)}`],
      ]} />
      <div className="admin-drawer-section"><h4>项目成员（{detail.data.members.length}）</h4>
        <div className="admin-inline-form">
          <label>添加账号<Select label="选择账号" value={memberAccount} options={[{ value: '', label: '选择账号' }, ...accounts.map(item => ({ value: item.id, label: `${item.displayName} (@${item.username})` }))]} onChange={setMemberAccount} /></label>
          <label>角色<Select label="角色" value={memberRole} options={[{ value: 'viewer', label: '浏览者' }, { value: 'commenter', label: '评论者' }, { value: 'editor', label: '编辑者' }, { value: 'manager', label: '管理员' }, { value: 'owner', label: '所有者' }]} onChange={setMemberRole} /></label>
          <button className="primary" disabled={!memberAccount} onClick={() => action.run(() => adminApi.post(`/api/admin/projects/${detail.data!.project.id}/members`, { accountId: memberAccount, role: memberRole }), '成员已添加')}><Plus size={13} /> 添加</button>
        </div>
        <AdminTable headers={['账号', '角色', '马甲', '操作']} rows={detail.data.members.map(member => [
          `${member.account.displayName} (@${member.account.username})`, <AdminBadge tone="info">{member.roleLabel}</AdminBadge>, member.persona || '—',
          <div className="cell-actions"><button className="danger" onClick={() => setRemoveMember({ projectId: detail.data!.project.id, accountId: member.accountId })}>移除</button></div>,
        ])} empty="暂无成员" />
      </div>
      <div className="admin-drawer-section"><h4>项目资源（{detail.data.resources.length}）</h4>
        <AdminTable headers={['名称', '类型', '状态', '更新时间']} rows={detail.data.resources.map(item => [item.name, item.typeLabel, item.deletedAt ? '回收站' : '正常', formatDate(item.updatedAt)])} empty="暂无资源" />
      </div>
    </div></Modal>}
    {removeProject && <ConfirmDialog title="删除项目" description={<>将删除「{removeProject.name}」及其成员关系。项目内仍有资源时会拒绝删除，请先转移或清理资源。</>} confirmText="删除项目" danger onClose={() => setRemoveProject(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/projects/${removeProject.id}`), '项目已删除'); if (detailId === removeProject.id) setDetailId(''); setRemoveProject(null); }} />}
    {removeMember && <ConfirmDialog title="移除项目成员" description={<>移除后该成员将失去项目默认权限，但单独获得的文档权限仍然保留。</>} confirmText="移除" danger onClose={() => setRemoveMember(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/projects/${removeMember.projectId}/members/${removeMember.accountId}`), '成员已移除'); setRemoveMember(null); }} />}
  </div>;
}

type InviteRow = { invite: { id: string; token: string; createdBy: string; expiresAt: string; usedBy: string | null; usedAt: string | null; revokedAt: string | null; createdAt: string }; creator: { username: string } | null; usedByAccount: { username: string } | null };
export function InvitesTab() {
  const [days, setDays] = useState('7');
  const [newInvite, setNewInvite] = useState('');
  const { data, busy, reload } = useAdminData<InviteRow[]>('/api/admin/invites');
  const action = useAdminAction(reload);
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <div className="admin-toolbar"><Select label="有效期" value={days} options={[{ value: '1', label: '1 天' }, { value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }]} onChange={setDays} />
      <button className="primary" onClick={() => action.run(async () => { const result = await adminApi.post<{ url: string }>('/api/admin/invites', { days: Number(days) }); setNewInvite(result.url); }, '邀请链接已创建')}><Plus size={14} /> 创建邀请链接</button>
      <RefreshButton onClick={reload} busy={busy} /></div>
    {newInvite && <div className="invite-result"><input readOnly value={newInvite} onFocus={e => e.target.select()} /><button onClick={async () => { try { await navigator.clipboard.writeText(newInvite); action.setMessage('邀请链接已复制'); } catch { action.setMessage('请手动复制链接'); } }}><Copy size={16} /></button></div>}
    <AdminTable headers={['状态', '创建人', '创建时间', '有效期至', '操作']} rows={(data || []).map(row => {
      const invite = row.invite;
      const state = invite.usedAt ? '已使用' : invite.revokedAt ? '已撤销' : invite.expiresAt < new Date().toISOString() ? '已过期' : '待使用';
      return [state === '待使用' ? <AdminBadge tone="good">{state}</AdminBadge> : <AdminBadge tone={state === '已撤销' ? 'bad' : ''}>{state}</AdminBadge>,
        row.creator?.username || '—', formatDate(invite.createdAt), formatDate(invite.expiresAt),
        <div className="cell-actions">{!invite.usedAt && !invite.revokedAt && <button className="danger" onClick={() => action.run(() => adminApi.del(`/api/admin/invites/${invite.id}`), '邀请已撤销')}>撤销</button>}</div>];
    })} empty="暂无邀请记录" />
  </div>;
}

type ShareRow = { id: string; token: string; resourceId: string; enabled: boolean; allowApply: boolean; requireApproval: boolean; allowView: boolean; scope: string; defaultRole: string; expiresAt: string | null; maxUses: number | null; uses: number; hasPassword: boolean; createdAt: string; resource: { id: string; name: string } | null; creator: { username: string } | null };
export function SharesTab() {
  const { data, busy, reload } = useAdminData<ShareRow[]>('/api/admin/shares');
  const [remove, setRemove] = useState<ShareRow | null>(null);
  const action = useAdminAction(reload);
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <AdminToolbar><RefreshButton onClick={reload} busy={busy} /></AdminToolbar>
    <AdminTable headers={['资源', '创建人', '状态', '申请范围', '默认角色', '审批', '使用', '有效期', '操作']} rows={(data || []).map(item => [
      <div className="cell-main"><strong>{item.resource?.name || '资源已删除'}</strong><span className="mono">{item.token.slice(0, 12)}…</span></div>,
      item.creator?.username || '—',
      item.enabled ? <AdminBadge tone="good">启用</AdminBadge> : <AdminBadge>停用</AdminBadge>,
      item.scope === 'both' ? '项目或文档' : item.scope === 'project' ? '加入项目' : '仅文档',
      item.defaultRole, item.requireApproval ? '需要' : '自动通过', `${item.uses}${item.maxUses ? ` / ${item.maxUses}` : ''}`, formatDate(item.expiresAt),
      <div className="cell-actions">
        <button onClick={() => action.run(() => adminApi.patch(`/api/admin/shares/${item.id}`, { enabled: !item.enabled }), item.enabled ? '分享已停用' : '分享已启用')}>{item.enabled ? '停用' : '启用'}</button>
        <button className="danger" onClick={() => setRemove(item)}>删除</button>
      </div>,
    ])} empty="暂无分享链接" />
    {remove && <ConfirmDialog title="删除分享链接" description={<>删除后链接立即失效，已有权限申请和用户授权不受影响。</>} confirmText="删除链接" danger onClose={() => setRemove(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/shares/${remove.id}`), '分享链接已删除'); setRemove(null); }} />}
  </div>;
}

type CommentRow = { comment: { id: string; content: string; personaSnapshot: string; resolved: boolean; createdAt: string; resourceId: string; anchor: string | null }; resource: { id: string; name: string } | null; account: { username: string; displayName: string } | null };
export function CommentsTab() {
  const [search, setSearch] = useState('');
  const { data, busy, reload } = useAdminData<CommentRow[]>(`/api/admin/comments${buildQuery({ search })}`);
  const [remove, setRemove] = useState<CommentRow | null>(null);
  const action = useAdminAction(reload);
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <AdminToolbar search={search} onSearch={setSearch} placeholder="搜索评论内容…"><RefreshButton onClick={reload} busy={busy} /></AdminToolbar>
    <AdminTable headers={['评论', '显示身份', '资源', '真实账号', '状态', '时间', '操作']} rows={(data || []).map(row => [
      <div className="cell-main"><strong style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.comment.content}</strong>{row.comment.anchor && <span>锚点：{row.comment.anchor}</span>}</div>,
      row.comment.personaSnapshot || '—', row.resource?.name || '资源已删除', row.account ? `@${row.account.username}` : '—',
      row.comment.resolved ? <AdminBadge>已解决</AdminBadge> : <AdminBadge tone="warn">待处理</AdminBadge>, formatDate(row.comment.createdAt),
      <div className="cell-actions">
        <button onClick={() => action.run(() => adminApi.patch(`/api/admin/comments/${row.comment.id}`, { resolved: !row.comment.resolved }), '状态已更新')}>{row.comment.resolved ? '重新打开' : '标记解决'}</button>
        <button className="danger" onClick={() => setRemove(row)}>删除</button>
      </div>,
    ])} empty="暂无评论" />
    {remove && <ConfirmDialog title="删除评论" description={<>删除后评论将无法恢复，操作会记入审计日志。</>} confirmText="删除评论" danger onClose={() => setRemove(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/comments/${remove.comment.id}`), '评论已删除'); setRemove(null); }} />}
  </div>;
}

type AuditItem = { log: { id: string; action: string; accountId: string; resourceId: string | null; detailJson: string; createdAt: string }; account: { username: string; displayName: string } | null; resource: { name: string } | null };
export function AuditTab() {
  const q = usePagedQuery({ pageSize: '50' });
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  useEffect(() => { q.set('search', search); }, [search]);
  useEffect(() => { q.set('action', actionFilter); }, [actionFilter]);
  const { data, busy, reload } = useAdminData<{ items: AuditItem[]; total: number; page: number; pageSize: number; actions: { action: string; count: number }[] }>(`/api/admin/audit${buildQuery({ search, action: actionFilter, page: q.state.page, pageSize: q.state.pageSize })}`);
  return <div className="admin-tab-content">
    <AdminToolbar search={search} onSearch={setSearch} placeholder="搜索操作名称或详情…" filters={[
      { label: '操作类型', value: actionFilter, options: [{ value: '', label: '全部操作' }, ...(data?.actions || []).map(item => ({ value: item.action, label: `${item.action} (${item.count})` }))], onChange: setActionFilter },
    ]}><RefreshButton onClick={reload} busy={busy} /></AdminToolbar>
    <AdminTable headers={['时间', '操作', '操作者', '资源', '详情']} rows={(data?.items || []).map(row => [
      <span>{formatDate(row.log.createdAt)}</span>, <AdminBadge tone="info">{row.log.action}</AdminBadge>,
      row.account ? `${row.account.displayName} (@${row.account.username})` : <span className="mono">{row.log.accountId.slice(0, 8)}</span>,
      row.resource?.name || row.log.resourceId && <span className="mono">{row.log.resourceId.slice(0, 8)}</span> || '全站操作',
      <span className="mono">{row.log.detailJson}</span>,
    ])} empty="暂无审计记录" />
    {data && <AdminPagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={q.setPage} />}
  </div>;
}

type SessionItem = { session: { id: string; accountId: string; expiresAt: string; createdAt: string }; account: { username: string; displayName: string } | null };
export function SessionsTab() {
  const q = usePagedQuery({ pageSize: '20' });
  const [expired, setExpired] = useState('false');
  useEffect(() => { q.set('expired', expired); }, [expired]);
  const { data, busy, reload } = useAdminData<{ items: SessionItem[]; total: number; page: number; pageSize: number }>(`/api/admin/sessions${buildQuery({ expired, page: q.state.page, pageSize: q.state.pageSize })}`);
  const action = useAdminAction(reload);
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <AdminToolbar filters={[{ label: '会话状态', value: expired, options: [{ value: 'false', label: '有效会话' }, { value: 'true', label: '已过期' }, { value: '', label: '全部会话' }], onChange: setExpired }]}><RefreshButton onClick={reload} busy={busy} /></AdminToolbar>
    <AdminTable headers={['账号', '创建时间', '过期时间', '状态', '操作']} rows={(data?.items || []).map(row => [
      row.account ? `${row.account.displayName} (@${row.account.username})` : <span className="mono">{row.session.accountId.slice(0, 8)}</span>,
      formatDate(row.session.createdAt), formatDate(row.session.expiresAt),
      row.session.expiresAt > new Date().toISOString() ? <AdminBadge tone="good">有效</AdminBadge> : <AdminBadge>已过期</AdminBadge>,
      <div className="cell-actions"><button className="danger" onClick={() => action.run(() => adminApi.del(`/api/admin/sessions/${row.session.id}`), '会话已撤销')}>撤销会话</button></div>,
    ])} empty="暂无会话" />
    {data && <AdminPagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={q.setPage} />}
  </div>;
}

