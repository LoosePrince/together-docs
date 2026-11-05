import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, Check, Inbox, Star, Trash2, RotateCcw, BellRing, ShieldCheck, Plus, Copy, FileText, Table2, Database, Folder, Clock3, UserRound, Activity, KeyRound } from 'lucide-react';
import { api, post, del, type Account, type Resource } from '../api';
import { ConfirmDialog } from './Dialogs';

export type WorkspacePageKind = 'recent' | 'favorites' | 'requests' | 'trash' | 'notifications' | 'admin';
const titles: Record<WorkspacePageKind, string> = { recent: '最近访问', favorites: '我的收藏', requests: '收到的申请', trash: '回收站', notifications: '通知', admin: '站点管理' };
const subtitles: Record<WorkspacePageKind, string> = {
  recent: '继续打开最近使用过的文档', favorites: '收藏的重要文档都在这里', requests: '审批伙伴对项目或文档的访问申请',
  trash: '已移入回收站的资源，可恢复或永久删除', notifications: '协作动态与审批结果', admin: '邀请、账号与全站审计',
};
const resourceIcons: Record<string, any> = { native_document: FileText, native_spreadsheet: Table2, smart_table: Database, folder: Folder, office_document: FileText, office_spreadsheet: Table2, attachment: FileText };
const resourceLabels: Record<string, string> = { folder: '文件夹', native_document: '文档', native_spreadsheet: '表格', smart_table: '智能表格', office_document: 'Word', office_spreadsheet: 'Excel', attachment: '附件' };

function ResourceTile({ resource, meta, actions }: { resource: Resource; meta: string; actions?: ReactNode }) {
  const Icon = resourceIcons[resource.type] || FileText;
  return <article className="document-card"><div className={`doc-preview ${resource.type}`}><Icon size={42} strokeWidth={1.25} /><div className="preview-lines"><i /><i /><i /></div><span className="doc-type-badge">{resourceLabels[resource.type] || '文件'}</span></div><div className="doc-info"><div><h3>{resource.name}</h3><p>{meta}</p></div></div>{actions && <div className="card-actions">{actions}</div>}</article>;
}

export default function WorkspacePage({ page, account, onBack, onOpen, onChanged }: {
  page: WorkspacePageKind; account: Account; onBack: () => void; onOpen: (resource: Resource) => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [newInvite, setNewInvite] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [purge, setPurge] = useState<any>(null);

  async function load() {
    setError('');
    try {
      if (page === 'admin') {
        const [inviteData, accountData, logData] = await Promise.all([api<any[]>('/api/admin/invites'), api<any[]>('/api/admin/accounts'), api<any[]>('/api/admin/audit')]);
        setInvites(inviteData); setAccounts(accountData); setLogs(logData); setItems([]);
      } else {
        const endpoints: Record<Exclude<WorkspacePageKind, 'admin'>, string> = { recent: '/api/workspace/recent', favorites: '/api/workspace/favorites', trash: '/api/workspace/trash', requests: '/api/workspace/requests', notifications: '/api/notifications' };
        setItems(await api<any[]>(endpoints[page]));
      }
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { load(); }, [page]);
  async function run(action: () => Promise<unknown>, success?: string) {
    setError(''); setMessage('');
    try { await action(); await load(); onChanged(); if (success) setMessage(success); } catch (e) { setError((e as Error).message); }
  }
  const isResourcePage = page === 'recent' || page === 'favorites' || page === 'trash';
  return <div className="page-view">
    <header className="workspace-header"><button className="icon-button" onClick={onBack} title="返回工作台"><ArrowLeft size={20} /></button><div className="page-header-title"><h1>{titles[page]}</h1><p>{subtitles[page]}</p></div><div className="page-header-count">{page === 'admin' ? `${accounts.length} 位成员` : `${items.length} 项`}</div><div className="avatar small">{account.displayName[0]}</div></header>
    <div className="page-content">
      {error && <div className="form-error">{error}</div>}{message && <div className="success-message">{message}</div>}
      {!isResourcePage && page !== 'admin' && !items.length && <div className="page-empty"><Inbox size={38} strokeWidth={1.2} /><h3>这里还是空的</h3><p>有新动态时会自动出现在这里</p></div>}
      {isResourcePage && (items.length ? <div className="document-grid">{items.map(item => {
        const resource: Resource = item.resource || item;
        const meta = page === 'recent' ? `访问于 ${new Date(item.visitedAt).toLocaleString('zh-CN')}` : page === 'trash' ? `删除于 ${new Date(resource.deletedAt || '').toLocaleString('zh-CN')}` : `更新于 ${new Date(resource.updatedAt).toLocaleDateString('zh-CN')}`;
        return <ResourceTile key={resource.id} resource={resource} meta={meta} actions={<>
          {page !== 'trash' && <button onClick={() => onOpen(resource)}>打开</button>}
          {page === 'favorites' && <button onClick={() => run(() => del(`/api/resources/${resource.id}/favorite`), '已取消收藏')}>取消收藏</button>}
          {page === 'trash' && <><button onClick={() => run(() => post(`/api/resources/${resource.id}/restore`, {}), '资源已恢复')}><RotateCcw size={13} /> 恢复</button><button className="danger" onClick={() => setPurge(resource)}>彻底删除</button></>}
        </>} />;
      })}</div> : <div className="page-empty"><Star size={38} strokeWidth={1.2} /><h3>暂无内容</h3><p>{page === 'recent' ? '打开文档后会出现在这里' : page === 'favorites' ? '在文档右上角点击星标即可收藏' : '回收站是空的'}</p></div>)}
      {page === 'notifications' && <div className="page-rows">{items.map(item => <article className={`page-row ${item.readAt ? 'dim' : ''}`} key={item.id}><div className="page-row-icon"><Bell size={17} /></div><div className="page-row-main"><strong>{item.title}</strong><span>{item.body}</span></div><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>{!item.readAt && <button onClick={() => run(() => post(`/api/notifications/${item.id}/read`, {}))}><Check size={14} /> 标为已读</button>}</article>)}</div>}
      {page === 'requests' && <div className="page-rows">{items.map(item => <article className="page-row" key={item.id}><div className="page-row-icon"><BellRing size={17} /></div><div className="page-row-main"><strong>{item.scope === 'project' ? '申请加入项目' : '申请访问文档'}</strong><span>{item.message || '未填写申请说明'} · 申请角色：{{ viewer: '浏览', commenter: '评论', editor: '编辑' }[item.role as string] || item.role}</span></div><span className={`status-badge ${item.status}`}>{item.status === 'pending' ? '待处理' : item.status === 'approved' ? '已通过' : '已拒绝'}</span>{item.status === 'pending' && <><button className="primary" onClick={() => run(() => post(`/api/requests/${item.id}/review`, { approved: true, role: item.role }), '申请已通过')}>同意</button><button onClick={() => run(() => post(`/api/requests/${item.id}/review`, { approved: false }), '申请已拒绝')}>拒绝</button></>}</article>)}</div>}
      {page === 'admin' && <div className="admin-page">
        <section className="page-section"><header><div><KeyRound size={18} /><h2>注册邀请</h2><p>一次性邀请链接，有效期 7 天</p></div><button className="primary" onClick={() => run(async () => { const result = await post<{ url: string }>('/api/admin/invites', {}); setNewInvite(result.url); }, '邀请链接已创建')}><Plus size={15} /> 创建邀请</button></header>{newInvite && <div className="invite-result"><input readOnly value={newInvite} onFocus={event => event.target.select()} /><button onClick={async () => { try { await navigator.clipboard.writeText(newInvite); setMessage('邀请链接已复制'); } catch { setMessage('请手动复制链接'); } }}><Copy size={16} /></button></div>}<div className="page-rows">{invites.map(invite => <article className="page-row" key={invite.id}><div className="page-row-icon"><KeyRound size={16} /></div><div className="page-row-main"><strong>{invite.usedAt ? '已使用' : invite.revokedAt ? '已撤销' : invite.expiresAt < new Date().toISOString() ? '已过期' : '待使用'}</strong><span>创建于 {new Date(invite.createdAt).toLocaleString('zh-CN')}</span></div>{!invite.usedAt && !invite.revokedAt && <button className="danger" onClick={() => run(() => del(`/api/admin/invites/${invite.id}`), '邀请已撤销')}>撤销</button>}</article>)}</div></section>
        <section className="page-section"><header><div><UserRound size={18} /><h2>站点账号</h2><p>封闭注册，所有成员均由站长邀请</p></div></header><div className="page-rows">{accounts.map(item => <article className="page-row" key={item.id}><div className="avatar">{item.displayName[0]}</div><div className="page-row-main"><strong>{item.displayName}{item.siteAdmin && <span className="status-badge approved">站长</span>}</strong><span>@{item.username}</span></div><span className="page-row-meta">{item.disabledAt ? '已禁用' : '正常'}</span></article>)}</div></section>
        <section className="page-section"><header><div><Activity size={18} /><h2>操作审计</h2><p>最近 200 条关键操作</p></div></header><div className="page-rows">{logs.slice(0, 50).map(log => <article className="page-row" key={log.id}><div className="page-row-icon"><Activity size={16} /></div><div className="page-row-main"><strong>{log.action}</strong><span>{log.resourceId || '全站操作'}</span></div><time>{new Date(log.createdAt).toLocaleString('zh-CN')}</time></article>)}</div></section>
      </div>}
    </div>
    {purge && <ConfirmDialog title="彻底删除" description={<>「{purge.name}」将被永久删除，无法恢复。</>} confirmText="永久删除" danger onClose={() => setPurge(null)} onConfirm={async () => { await del(`/api/resources/${purge.id}/permanent`); setPurge(null); await load(); onChanged(); }} />}
  </div>;
}
