import { useEffect, useState } from 'react';
import { Bell, Check, Inbox, Star, Trash2, RotateCcw, BellRing } from 'lucide-react';
import { api, post, del, type Resource } from '../api';
import { ConfirmDialog } from './Dialogs';

type View = 'recent' | 'favorites' | 'trash' | 'requests' | 'notifications';
export default function WorkspacePanel({ view, onClose, onOpen, onChanged }: { view: View; onClose: () => void; onOpen: (resource: Resource) => void; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(''); const [purge, setPurge] = useState<any>(null);
  const titles: Record<View, string> = { recent: '最近访问', favorites: '我的收藏', trash: '回收站', requests: '收到的申请', notifications: '通知' };
  async function load() {
    const endpoints: Record<View, string> = { recent: '/api/workspace/recent', favorites: '/api/workspace/favorites', trash: '/api/workspace/trash', requests: '/api/workspace/requests', notifications: '/api/notifications' };
    try { setItems(await api<any[]>(endpoints[view])); setError(''); } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { load(); }, [view]);
  async function run(action: () => Promise<unknown>, success?: string) {
    try { await action(); await load(); onChanged(); if (success) setError(success); } catch (e) { setError((e as Error).message); }
  }
  return <div className="workspace-panel"><header><div><Bell size={17} /><strong>{titles[view]}</strong></div><button onClick={onClose}>关闭</button></header>
    <div className="workspace-panel-body">{error && <div className="form-error">{error}</div>}{!items.length && <div className="panel-empty"><Inbox size={34} /><p>暂无内容</p></div>}
      {view === 'notifications' && items.map(item => <article className={`panel-row ${item.readAt ? 'dim' : ''}`} key={item.id}><div><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></div>{!item.readAt && <button title="标记为已读" onClick={() => run(() => post(`/api/notifications/${item.id}/read`, {}))}><Check size={15} /></button>}</article>)}
      {view === 'recent' && items.map(item => <article className="panel-row" key={item.resource.id}><div><strong>{item.resource.name}</strong><span>{new Date(item.visitedAt).toLocaleString('zh-CN')}</span></div><button onClick={() => onOpen(item.resource)}>打开</button></article>)}
      {view === 'favorites' && items.map(item => <article className="panel-row" key={item.resource.id}><div><Star size={15} /><strong>{item.resource.name}</strong></div><button onClick={() => onOpen(item.resource)}>打开</button><button onClick={() => run(() => del(`/api/resources/${item.resource.id}/favorite`))}>取消收藏</button></article>)}
      {view === 'trash' && items.map(item => <article className="panel-row" key={item.id}><div><Trash2 size={15} /><strong>{item.name}</strong><span>{item.deletedAt && new Date(item.deletedAt).toLocaleString('zh-CN')}</span></div><button onClick={() => run(() => post(`/api/resources/${item.id}/restore`, {}), '已恢复')}><RotateCcw size={14} /> 恢复</button><button className="danger" onClick={() => setPurge(item)}>彻底删除</button></article>)}
      {view === 'requests' && items.map(item => <article className="panel-row" key={item.id}><div><BellRing size={15} /><strong>{item.scope === 'project' ? '项目权限申请' : '文档权限申请'}</strong><span>{item.message || '未填写说明'} · {item.status === 'pending' ? '待处理' : item.status === 'approved' ? '已通过' : '已拒绝'}</span></div>{item.status === 'pending' && <button onClick={() => run(() => post(`/api/requests/${item.id}/review`, { approved: true, role: item.role }), '申请已通过')}>同意</button>}</article>)}
    </div>
    {purge && <ConfirmDialog title="彻底删除" description={<>「{purge.name}」将被永久删除，无法恢复。</>} confirmText="永久删除" danger onClose={() => setPurge(null)} onConfirm={async () => { await del(`/api/resources/${purge.id}/permanent`); setPurge(null); await load(); onChanged(); }} />}
  </div>;
}
