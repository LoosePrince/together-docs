import { useEffect, useState } from 'react';
import { History, Plus, RotateCcw } from 'lucide-react';
import { api, post } from '../api';
import Modal from './Modal';
import { ConfirmDialog } from './Dialogs';

export default function VersionPanel({ resourceId, canEdit, onClose }: { resourceId: string; canEdit: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [restore, setRestore] = useState<any>(null);
  async function load() { try { setVersions(await api<any[]>(`/api/resources/${resourceId}/versions`)); } catch (e) { setMessage((e as Error).message); } }
  useEffect(() => { load(); }, [resourceId]);
  return <Modal title="历史版本" onClose={onClose}><div className="versions-panel">
    {canEdit && <button className="primary" onClick={async () => { try { await post(`/api/resources/${resourceId}/versions`, { name: `手动保存 · ${new Date().toLocaleString('zh-CN')}` }); await load(); setMessage('已保存当前版本'); } catch (e) { setMessage((e as Error).message); } }}><Plus size={16} /> 保存当前版本</button>}
    {versions.map(version => <div className="version-row" key={version.id}><History size={17} /><div><strong>{version.name}</strong><span>{new Date(version.createdAt).toLocaleString('zh-CN')}</span></div>{canEdit && <button onClick={() => setRestore(version)}><RotateCcw size={14} /> 恢复</button>}</div>)}
    {!versions.length && <p className="muted">还没有命名版本。编辑过程会自动保存，你也可以手动保存一个里程碑。</p>}{message && <p className="success-message">{message}</p>}
  </div>{restore && <ConfirmDialog title="恢复历史版本" description={`恢复「${restore.name}」？当前内容会先自动备份为一个新版本。`} confirmText="恢复版本" onClose={() => setRestore(null)} onConfirm={async () => {
    await post(`/api/resources/${resourceId}/versions/${restore.id}/restore`, {}); setRestore(null); await load(); setMessage('版本已恢复');
  }} />}</Modal>;
}
