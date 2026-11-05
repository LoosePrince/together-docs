import { useEffect, useState } from 'react';
import { ArrowLeft, History, Plus, RotateCcw } from 'lucide-react';
import { api, post } from '../api';
import type { Resource } from '../api';
import { ConfirmDialog } from './Dialogs';
import SharePanel from './SharePanel';

export default function DocumentSubPage({ page, resource, canEdit, onBack }: {
  page: 'share' | 'versions'; resource: Resource; canEdit: boolean; onBack: () => void;
}) {
  const [versions, setVersions] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [restore, setRestore] = useState<any>(null);
  async function loadVersions() { try { setVersions(await api<any[]>(`/api/resources/${resource.id}/versions`)); } catch (e) { setMessage((e as Error).message); } }
  useEffect(() => { if (page === 'versions') loadVersions(); }, [page, resource.id]);
  const title = page === 'share' ? '分享与协作' : '历史版本';
  const subtitle = page === 'share' ? '管理协作者、马甲、分享链接和权限申请' : '保存里程碑、恢复历史内容';
  return <div className="page-view document-subpage">
    <header className="workspace-header"><button className="icon-button" onClick={onBack} title="返回文档"><ArrowLeft size={20} /></button><div className="page-header-title"><h1>{title}</h1><p>{resource.name} · {subtitle}</p></div><span className="page-header-count">{resource.name.slice(0, 1)}</span></header>
    <div className="page-content">
      {page === 'share' && <div className="share-page"><SharePanel resourceId={resource.id} /></div>}
      {page === 'versions' && <div className="versions-page"><div className="page-section"><header><div><History size={18} /><h2>版本记录</h2><p>恢复历史版本不会覆盖当前内容，系统会先创建备份</p></div>{canEdit && <button className="primary" onClick={async () => { try { await post(`/api/resources/${resource.id}/versions`, { name: `手动保存 · ${new Date().toLocaleString('zh-CN')}` }); await loadVersions(); setMessage('当前版本已保存'); } catch (e) { setMessage((e as Error).message); } }}><Plus size={15} /> 保存当前版本</button>}</header>{message && <div className="success-message">{message}</div>}<div className="page-rows">{versions.map(version => <article className="page-row" key={version.id}><div className="page-row-icon"><History size={17} /></div><div className="page-row-main"><strong>{version.name}</strong><span>{new Date(version.createdAt).toLocaleString('zh-CN')}</span></div>{canEdit && <button onClick={() => setRestore(version)}><RotateCcw size={14} /> 恢复</button>}</article>)}{!versions.length && <div className="page-empty"><History size={36} strokeWidth={1.2} /><h3>还没有命名版本</h3><p>编辑会自动保存，也可以手动保存里程碑</p></div>}</div></div></div>}
    </div>
    {restore && <ConfirmDialog title="恢复历史版本" description={`恢复「${restore.name}」？当前内容会先自动备份为一个新版本。`} confirmText="恢复版本" onClose={() => setRestore(null)} onConfirm={async () => { await post(`/api/resources/${resource.id}/versions/${restore.id}/restore`, {}); setRestore(null); await loadVersions(); setMessage('版本已恢复'); }} />}
  </div>;
}
