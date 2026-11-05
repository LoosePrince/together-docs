import { useEffect, useState } from 'react';
import { ArrowRightLeft, Eye, FileText, FolderInput, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import Select from '../Select';
import { ConfirmDialog, PromptDialog } from '../Dialogs';
import { AdminBadge, AdminPagination, AdminTable, AdminToolbar, RefreshButton } from './AdminUI';
import { buildQuery, formatBytes, formatDate } from '../../format';
import { adminApi, useAdminAction, useAdminData, usePagedQuery } from './hooks';

const typeLabels: Record<string, string> = { folder: '文件夹', native_document: '原生文档', native_spreadsheet: '原生表格', smart_table: '智能表格', office_document: 'Word', office_spreadsheet: 'Excel', attachment: '附件' };

type ResourceRow = {
  id: string; name: string; type: string; typeLabel: string; state: string; ownerId: string;
  owner: { username: string; displayName: string } | null; projectId: string | null;
  project: { name: string } | null; parentId: string | null; fileId: string | null; fileSize: number;
  permissionVersion: number; deletedAt: string | null; createdAt: string; updatedAt: string;
};
type ListData = { items: ResourceRow[]; total: number; page: number; pageSize: number; types: { type: string; label: string }[] };
type Detail = {
  resource: ResourceRow; owner: { id: string; username: string; displayName: string } | null;
  project: { id: string; name: string } | null; parent: { id: string; name: string } | null;
  file: { id: string; name: string; size: number; sha256: string; key: string; mimeType: string; createdAt: string } | null;
  members: { id: string; accountId: string; role: string; roleLabel: string; persona: string; locked: boolean; account: { username: string; displayName: string } }[];
  shares: { id: string; token: string; enabled: boolean; scope: string; requireApproval: boolean; defaultRole: string; uses: number; expiresAt: string | null; hasPassword: boolean }[];
  versions: { id: string; name: string; createdAt: string; fileId: string | null }[];
  counts: Record<string, number>;
};
type AccountOption = { id: string; username: string; displayName: string };
type ContentData = { documentText: string; spreadsheet: Record<string, string> | null; records: { id: string; valuesJson: string; createdAt: string }[]; fields: { id: string; name: string; type: string }[]; comments: { id: string; content: string; personaSnapshot: string; createdAt: string }[] };

export default function DocumentsTab({ initialState, onChanged }: { initialState?: string; onChanged?: () => void }) {
  const q = usePagedQuery({ state: initialState || 'active', pageSize: '20' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [content, setContent] = useState<ContentData | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [rename, setRename] = useState<ResourceRow | null>(null);
  const [purge, setPurge] = useState<ResourceRow | null>(null);
  const [bulkPurge, setBulkPurge] = useState(false);
  const [transfer, setTransfer] = useState<ResourceRow | null>(null);
  const [transferTarget, setTransferTarget] = useState('');
  const [moveProject, setMoveProject] = useState<ResourceRow | null>(null);
  const [projectTarget, setProjectTarget] = useState('');
  const [bulkAction, setBulkAction] = useState('');
  const [bulkTarget, setBulkTarget] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const url = `/api/admin/resources${buildQuery({ search, type: q.state.type, state: q.state.state, ownerId: ownerFilter, page: q.state.page, pageSize: q.state.pageSize })}`;
  const { data, busy, reload } = useAdminData<ListData>(url);
  const action = useAdminAction(async () => { await reload(); onChanged?.(); });
  useEffect(() => { q.set('state', initialState || 'active'); }, [initialState]);
  useEffect(() => { q.set('search', search); }, [search]);
  useEffect(() => { q.set('ownerId', ownerFilter); }, [ownerFilter]);
  useEffect(() => { adminApi.get<AccountOption[]>('/api/admin/accounts').then(setAccounts).catch(() => {}); }, []);
  useEffect(() => { adminApi.get<{ items: { id: string; name: string }[] }>('/api/admin/projects?pageSize=100').then(result => setProjects(result.items)).catch(() => {}); }, []);

  async function openDetail(id: string) {
    setContent(null);
    try { setDetail(await adminApi.get<Detail>(`/api/admin/resources/${id}`)); }
    catch (e) { action.setError((e as Error).message); }
  }
  async function openContent(id: string) {
    try { setContent(await adminApi.get<ContentData>(`/api/admin/resources/${id}/content`)); }
    catch (e) { action.setError((e as Error).message); }
  }
  async function refreshDetail(id: string) { await reload(); await openDetail(id); }
  const stateFilter = [
    { value: '', label: '全部状态' }, { value: 'active', label: '正常' }, { value: 'trash', label: '回收站' },
  ];

  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}
    {action.message && <div className="success-message">{action.message}</div>}
    <AdminToolbar search={search} onSearch={setSearch} placeholder="按名称搜索资源…" filters={[
      { label: '状态', value: q.state.state || '', options: stateFilter, onChange: value => q.set('state', value) },
      { label: '类型', value: q.state.type || '', options: [{ value: '', label: '全部类型' }, ...(data?.types || []).map(item => ({ value: item.type, label: item.label }))], onChange: value => q.set('type', value) },
      { label: '所有者', value: ownerFilter, options: [{ value: '', label: '全部所有者' }, ...accounts.map(item => ({ value: item.id, label: `${item.displayName} (@${item.username})` }))], onChange: setOwnerFilter },
    ]}>
      <RefreshButton onClick={reload} busy={busy} />
    </AdminToolbar>
    {selected.length > 0 && <div className="admin-notice">已选择 {selected.length} 个资源。批量操作会立即执行，永久删除不可恢复。</div>}
    <div className="admin-toolbar">
      <Select label="批量操作" value={bulkAction} options={[{ value: '', label: '选择批量操作' }, { value: 'trash', label: '移到回收站' }, { value: 'restore', label: '从回收站恢复' }, { value: 'moveProject', label: '移动到项目' }, { value: 'transfer', label: '转移所有权' }, { value: 'purge', label: '永久删除' }]} onChange={setBulkAction} />
      {(bulkAction === 'moveProject' || bulkAction === 'transfer') && <Select label="目标" value={bulkTarget} options={bulkAction === 'transfer' ? [{ value: '', label: '选择账号' }, ...accounts.map(item => ({ value: item.id, label: item.displayName }))] : [{ value: '', label: '个人空间（移出项目）' }, ...projects.map(item => ({ value: item.id, label: item.name }))]} onChange={setBulkTarget} />}
      <button className="primary" disabled={!selected.length || !bulkAction || action.busy} onClick={async () => {
        if (bulkAction === 'purge') { setBulkPurge(true); return; }
        await action.run(() => adminApi.post('/api/admin/resources/bulk', { ids: selected, action: bulkAction, accountId: bulkAction === 'transfer' ? bulkTarget : undefined, projectId: bulkAction === 'moveProject' ? bulkTarget || null : undefined }), '批量操作完成');
        setSelected([]);
      }}>执行批量操作</button>
      <button onClick={() => setSelected([])} disabled={!selected.length}>清空选择</button>
    </div>
    <AdminTable headers={[<input type="checkbox" aria-label="全选" checked={!!data?.items.length && selected.length === data.items.length} onChange={e => setSelected(e.target.checked ? (data?.items || []).map(item => item.id) : [])} />, '资源', '类型', '所有者 / 空间', '大小', '更新时间', '状态', '操作']} rows={(data?.items || []).map(item => [
      <input type="checkbox" aria-label={`选择 ${item.name}`} checked={selected.includes(item.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, item.id] : ids.filter(value => value !== item.id))} />,
      <div className="cell-main"><strong>{item.name}</strong><span className="mono">{item.id.slice(0, 8)} · 权限版本 {item.permissionVersion}</span></div>,
      <AdminBadge tone="info">{item.typeLabel || typeLabels[item.type] || item.type}</AdminBadge>,
      <div className="cell-main"><span>{item.owner?.displayName || '未知账号'}</span><span>{item.project?.name || '个人空间'}</span></div>,
      item.fileSize ? formatBytes(item.fileSize) : '—',
      <span>{formatDate(item.updatedAt)}</span>,
      item.state === 'trash' ? <AdminBadge tone="bad">回收站</AdminBadge> : <AdminBadge tone="good">正常</AdminBadge>,
      <div className="cell-actions">
        <button onClick={() => openDetail(item.id)}><Eye size={12} /> 详情</button>
        <button onClick={() => setRename(item)}><Pencil size={12} /> 重命名</button>
        <button onClick={() => { setTransfer(item); setTransferTarget(''); }}><ArrowRightLeft size={12} /> 转移</button>
        <button onClick={() => { setMoveProject(item); setProjectTarget(item.projectId || ''); }}><FolderInput size={12} /> 位置</button>
        {item.state === 'trash' ? <button onClick={() => action.run(() => adminApi.post(`/api/admin/resources/${item.id}/trash`, { restore: true }), '资源已恢复')}><RotateCcw size={12} /> 恢复</button>
          : <button onClick={() => action.run(() => adminApi.post(`/api/admin/resources/${item.id}/trash`, {}), '已移入回收站')}><Trash2 size={12} /> 回收站</button>}
        <button className="danger" onClick={() => setPurge(item)}>永久删除</button>
      </div>,
    ])} empty="没有符合条件的资源" />
    {data && <AdminPagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={q.setPage} />}

    {detail && <Modal title={`资源详情 · ${detail.resource.name}`} onClose={() => { setDetail(null); setContent(null); }} wide><div className="admin-drawer-body">
      <AdminKeyValueSlot detail={detail} />
      <div className="admin-drawer-actions">
        <button onClick={() => openContent(detail.resource.id)}><FileText size={13} /> 查看内容摘要</button>
        {detail.file && <a href={`/api/admin/files/${detail.file.id}/download`}><button>下载原始文件</button></a>}
        <button onClick={() => setRename(detail.resource)}>重命名</button>
        <button onClick={() => { setTransfer(detail.resource); setTransferTarget(''); }}>转移所有权</button>
        <button className="danger" onClick={() => setPurge(detail.resource)}>永久删除</button>
      </div>
      {content && <div className="admin-drawer-section"><h4>内容摘要</h4>
        {content.documentText && <p className="admin-code">{content.documentText || '（空文档）'}</p>}
        {content.spreadsheet && <p className="admin-code">{Object.entries(content.spreadsheet).slice(0, 100).map(([cell, value]) => `${cell}: ${value}`).join('\n') || '（空表格）'}</p>}
        {content.records.length > 0 && <p className="admin-code">{content.fields.map(field => field.name).join(' | ')}{'\n'}{content.records.slice(0, 50).map(record => content.fields.map(field => JSON.parse(record.valuesJson)[field.id] ?? '').join(' | ')).join('\n')}</p>}
        {!content.documentText && !content.spreadsheet && !content.records.length && <p className="muted">此资源没有可提取的文本内容（Office 与附件请下载原文件查看）。共 {content.comments.length} 条评论。</p>}
      </div>}
      <div className="admin-drawer-section"><h4>协作者（{detail.members.length}）</h4>
        <AdminTable headers={['账号', '角色', '马甲', '锁定', '操作']} rows={detail.members.map(member => [
          <div className="cell-main"><strong>{member.account.displayName}</strong><span>@{member.account.username}</span></div>,
          <AdminBadge tone="info">{member.roleLabel}</AdminBadge>, member.persona || '—', member.locked ? '是' : '否',
          <div className="cell-actions"><button className="danger" onClick={() => action.run(() => adminApi.del(`/api/admin/resources/${detail.resource.id}/members/${member.accountId}`), '成员已移除').then(() => refreshDetail(detail.resource.id))}>移除</button></div>,
        ])} empty="暂无直接授权成员" />
      </div>
      <div className="admin-drawer-section"><h4>分享链接（{detail.shares.length}）</h4>
        <AdminTable headers={['状态', '范围', '角色', '使用次数', '有效期', '密码']} rows={detail.shares.map(share => [
          share.enabled ? <AdminBadge tone="good">启用</AdminBadge> : <AdminBadge>停用</AdminBadge>,
          share.scope === 'both' ? '项目或文档' : share.scope === 'project' ? '加入项目' : '仅文档',
          share.defaultRole, String(share.uses), formatDate(share.expiresAt), share.hasPassword ? '已设置' : '无',
        ])} empty="暂无分享链接" />
      </div>
      <div className="admin-drawer-section"><h4>版本与统计</h4>
        <AdminKeyValueSlotCounts detail={detail} />
      </div>
    </div></Modal>}

    {rename && <PromptDialog title="重命名资源" initialValue={rename.name} onSubmit={async name => { await action.run(() => adminApi.patch(`/api/admin/resources/${rename.id}`, { name }), '名称已更新'); setRename(null); if (detail?.resource.id === rename.id) await refreshDetail(rename.id); }} onClose={() => setRename(null)} />}
    {transfer && <Modal title="转移所有权" onClose={() => setTransfer(null)}><div className="create-form"><p className="muted">「{transfer.name}」将归属于新账号。原所有者若没有项目或文档授权，将失去访问权限。</p>
      <label>新所有者<Select label="新所有者" value={transferTarget} options={[{ value: '', label: '选择账号' }, ...accounts.map(item => ({ value: item.id, label: `${item.displayName} (@${item.username})` }))]} onChange={setTransferTarget} /></label>
      <button className="primary large" disabled={!transferTarget || action.busy} onClick={async () => { await action.run(() => adminApi.post(`/api/admin/resources/${transfer.id}/transfer`, { accountId: transferTarget }), '所有权已转移'); if (detail?.resource.id === transfer.id) await refreshDetail(transfer.id); setTransfer(null); }}>确认转移</button>
    </div></Modal>}
    {moveProject && <Modal title="调整所在空间" onClose={() => setMoveProject(null)}><div className="create-form"><p className="muted">「{moveProject.name}」将被移动到所选项目根目录，或个人空间。</p>
      <label>目标位置<Select label="目标位置" value={projectTarget} options={[{ value: '', label: '个人空间' }, ...projects.map(item => ({ value: item.id, label: item.name }))]} onChange={setProjectTarget} /></label>
      <button className="primary large" onClick={async () => { await action.run(() => adminApi.patch(`/api/admin/resources/${moveProject.id}`, { projectId: projectTarget || null }), '位置已调整'); if (detail?.resource.id === moveProject.id) await refreshDetail(moveProject.id); setMoveProject(null); }}>保存位置</button>
    </div></Modal>}
    {purge && <ConfirmDialog title="永久删除资源" description={<>「{purge.name}」及其子资源、协同数据、版本、评论、权限和分享链接将被永久删除，无法恢复。</>} confirmText="永久删除" danger onClose={() => setPurge(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/resources/${purge.id}`), '资源已永久删除'); if (detail?.resource.id === purge.id) setDetail(null); setPurge(null); }} />}
    {bulkPurge && <ConfirmDialog title="批量永久删除" description={<>将永久删除选中的 {selected.length} 个资源及其全部关联数据，无法恢复。</>} confirmText="全部删除" danger onClose={() => setBulkPurge(false)} onConfirm={async () => { await action.run(() => adminApi.post('/api/admin/resources/bulk', { ids: selected, action: 'purge' }), '批量删除完成'); setSelected([]); setBulkPurge(false); }} />}
  </div>;
}

function AdminKeyValueSlot({ detail }: { detail: Detail }) {
  const r = detail.resource;
  return <dl className="admin-kv">
    <dt>资源 ID</dt><dd className="mono">{r.id}</dd>
    <dt>类型</dt><dd>{r.typeLabel}</dd>
    <dt>所有者</dt><dd>{detail.owner ? `${detail.owner.displayName} (@${detail.owner.username})` : '未知'}</dd>
    <dt>所在空间</dt><dd>{detail.project?.name || '个人空间'}{detail.parent ? ` / ${detail.parent.name}` : ''}</dd>
    <dt>状态</dt><dd>{r.deletedAt ? `回收站（${formatDate(r.deletedAt)}）` : '正常'} · 权限版本 {r.permissionVersion}</dd>
    <dt>创建 / 更新</dt><dd>{formatDate(r.createdAt)} / {formatDate(r.updatedAt)}</dd>
    <dt>原始文件</dt><dd>{detail.file ? `${detail.file.name} · ${formatBytes(detail.file.size)} · ${detail.file.mimeType}` : '无'}</dd>
    {detail.file && <><dt>SHA-256</dt><dd className="mono">{detail.file.sha256}</dd><dt>存储 Key</dt><dd className="mono">{detail.file.key}</dd></>}
  </dl>;
}

function AdminKeyValueSlotCounts({ detail }: { detail: Detail }) {
  const c = detail.counts;
  return <><AdminKeyValueSlotCountsInner c={c} versions={detail.versions.length} /></>;
}
function AdminKeyValueSlotCountsInner({ c, versions }: { c: Record<string, number>; versions: number }) {
  return <dl className="admin-kv">
    <dt>历史版本</dt><dd>{versions} 个</dd>
    <dt>评论</dt><dd>{c.comments || 0} 条</dd>
    <dt>智能表格记录</dt><dd>{c.records || 0} 行 / {c.fields || 0} 字段 / {c.views || 0} 视图</dd>
    <dt>行列权限规则</dt><dd>行 {c.rowPolicies || 0} 条 · 字段 {c.fieldPolicies || 0} 条</dd>
    <dt>权限申请</dt><dd>{c.requests || 0} 条</dd>
    <dt>协同更新帧</dt><dd>{c.collabUpdates || 0} 帧</dd>
  </dl>;
}

