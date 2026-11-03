import { useEffect, useState } from 'react';
import { Copy, Link as LinkIcon, Pencil, UserPlus, X } from 'lucide-react';
import { api, post } from '../api';
import Select from './Select';

const roleOptions = [{ value: 'viewer', label: '可浏览' }, { value: 'commenter', label: '可评论' }, { value: 'editor', label: '可编辑' }, { value: 'manager', label: '管理员' }];
const roleLabels: Record<string, string> = { viewer: '可浏览', commenter: '可评论', editor: '可编辑', manager: '管理员' };

export default function SharePanel({ resourceId }: { resourceId: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('editor');
  const [link, setLink] = useState('');
  const [scope, setScope] = useState('both');
  const [message, setMessage] = useState('');
  const [persona, setPersona] = useState<{ accountId: string; value: string } | null>(null);

  async function load() {
    try {
      const [memberData, requestData] = await Promise.all([api<any[]>(`/api/resources/${resourceId}/members`), api<any[]>(`/api/resources/${resourceId}/requests`)]);
      setMembers(memberData); setRequests(requestData);
    } catch (e) { setMessage((e as Error).message); }
  }
  useEffect(() => { load(); }, [resourceId]);
  async function run(action: () => Promise<unknown>, success?: string) {
    setMessage('');
    try { await action(); await load(); if (success) setMessage(success); } catch (e) { setMessage((e as Error).message); }
  }
  return <div className="share-panel">
    <section><h4><UserPlus size={17} /> 添加协作者</h4><div className="inline-form">
      <input placeholder="输入对方的用户名" value={username} onChange={event => setUsername(event.target.value)} />
      <Select label="协作者角色" value={role} options={roleOptions} onChange={setRole} />
      <button className="primary" disabled={!username.trim()} onClick={() => run(async () => { await post(`/api/resources/${resourceId}/members`, { username, role }); setUsername(''); }, '协作者已添加')}>添加</button>
    </div></section>
    <section><h4><LinkIcon size={17} /> 链接权限申请</h4><p className="muted">受邀用户打开链接后，可以申请加入项目或仅申请当前文档。</p><div className="inline-form">
      <Select label="分享申请范围" value={scope} options={[{ value: 'both', label: '申请人选择范围' }, { value: 'project', label: '仅申请加入项目' }, { value: 'document', label: '仅申请当前文档' }]} onChange={setScope} />
      <button onClick={() => run(async () => { const result = await post<{ token: string }>(`/api/resources/${resourceId}/shares`, { scope }); setLink(`${location.origin}/?share=${result.token}`); })}>生成链接</button>
      {link && <button onClick={async () => { try { await navigator.clipboard.writeText(link); setMessage('链接已复制'); } catch { setMessage('无法自动复制，请手动复制链接'); } }}><Copy size={15} /> 复制</button>}
    </div>{link && <input className="share-url" readOnly value={link} onFocus={event => event.target.select()} />}</section>
    <section><h4>成员 <span className="count">{members.length}</span></h4>{members.map(({ member, account }) => <div className="member-row" key={member.id}>
      <div className="avatar">{account.displayName[0]}</div><div><strong>{member.persona || account.displayName}</strong><span>@{account.username}</span></div>
      <span className="role-label">{roleLabels[member.role]}</span><button className="icon-button" title="设置马甲" onClick={() => setPersona({ accountId: account.id, value: member.persona })}><Pencil size={14} /></button>
    </div>)}{persona && <div className="inline-form"><input value={persona.value} onChange={event => setPersona({ ...persona, value: event.target.value })} placeholder="本文档中的显示昵称" />
      <button className="primary" disabled={!persona.value.trim()} onClick={() => run(async () => { await api(`/api/resources/${resourceId}/persona`, { method: 'PATCH', body: JSON.stringify({ accountId: persona.accountId, persona: persona.value.trim(), locked: true }) }); setPersona(null); }, '马甲已更新')}>保存马甲</button><button onClick={() => setPersona(null)}><X size={15} /></button>
    </div>}</section>
    <section><h4>待处理申请 <span className="count">{requests.filter(item => item.status === 'pending').length}</span></h4>{requests.filter(item => item.status === 'pending').map(item => <div className="request-row" key={item.id}>
      <div><strong>{item.scope === 'project' ? '申请加入项目' : '申请当前文档'}</strong><span>{item.message || '未填写申请说明'}</span></div>
      <button className="primary" onClick={() => run(() => post(`/api/requests/${item.id}/review`, { approved: true, role: item.role }), '已同意申请')}>同意</button><button onClick={() => run(() => post(`/api/requests/${item.id}/review`, { approved: false }), '已拒绝申请')}>拒绝</button>
    </div>)}</section>{message && <p className="success-message">{message}</p>}
  </div>;
}
