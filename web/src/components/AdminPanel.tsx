import { useState } from 'react';
import { Copy, Plus, ShieldCheck } from 'lucide-react';
import { post } from '../api';
import Modal from './Modal';

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [invite, setInvite] = useState(''); const [message, setMessage] = useState('');
  return <Modal title="站点管理" onClose={onClose}><div className="admin-panel"><div className="admin-badge"><ShieldCheck size={22} /><div><strong>站长控制台</strong><span>你拥有站点全部管理权限</span></div></div><h4>邀请新成员</h4><p className="muted">生成一次性邀请链接，有效期 7 天。对方注册后即可通过用户名添加到项目或文档。</p><button className="primary" onClick={async () => { const result = await post<{ url: string }>('/api/admin/invites'); setInvite(result.url); }}><Plus size={16} /> 创建邀请链接</button>{invite && <div className="invite-result"><input readOnly value={invite} /><button onClick={async () => { await navigator.clipboard.writeText(invite); setMessage('邀请链接已复制'); }}><Copy size={16} /></button></div>}{message && <p className="success-message">{message}</p>}</div></Modal>;
}
