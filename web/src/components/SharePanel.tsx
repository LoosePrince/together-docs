import { useEffect, useState } from 'react';
import { Copy, Link as LinkIcon, Pencil, UserPlus, X, ShieldCheck, CalendarClock } from 'lucide-react';
import { api, post, patch } from '../api';
import Select from './Select';

const roleOptions = [{ value: 'viewer', label: '可浏览' }, { value: 'commenter', label: '可评论' }, { value: 'editor', label: '可编辑' }, { value: 'manager', label: '管理员' }];
const roleLabels: Record<string, string> = { viewer: '可浏览', commenter: '可评论', editor: '可编辑', manager: '管理员' };

export default function SharePanel({ resourceId }: { resourceId: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [shares, setShares] = useState<any[]>([]);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('editor');
  const [link, setLink] = useState('');
  const [scope, setScope] = useState('both');
  const [defaultRole, setDefaultRole] = useState('viewer');
  const [password, setPassword] = useState('');
  const [expiresIn, setExpiresIn] = useState('7');
  const [maxUses, setMaxUses] = useState('');
  const [requireApproval, setRequireApproval] = useState('true');
  const [message, setMessage] = useState('');
  const [persona, setPersona] = useState<{ accountId: string; value: string } | null>(null);

  async function load() {
    try {
      const [memberData, requestData, shareData] = await Promise.all([api<any[]>(`/api/resources/${resourceId}/members`), api<any[]>(`/api/resources/${resourceId}/requests`), api<any[]>(`/api/resources/${resourceId}/shares`)]);
      setMembers(memberData); setRequests(requestData); setShares(shareData);
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
    <section><h4><LinkIcon size={17} /> 链接权限申请</h4><p className="muted">可限制申请范围、默认角色、有效期和最大使用次数，所有申请由管理员审批。</p>
      <div className="share-options"><Select label="申请范围" value={scope} options={[{ value: 'both', label: '申请人选择范围' }, { value: 'project', label: '仅申请加入项目' }, { value: 'document', label: '仅申请当前文档' }]} onChange={setScope} /><Select label="默认申请角色" value={defaultRole} options={roleOptions.filter(option => option.value !== 'manager')} onChange={setDefaultRole} /><input placeholder="分享密码（可选）" value={password} onChange={event => setPassword(event.target.value)} /><Select label="有效期" value={expiresIn} options={[{ value: '1', label: '1 天' }, { value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '0', label: '长期有效' }]} onChange={setExpiresIn} /><Select label="审批方式" value={requireApproval} options={[{ value: 'true', label: '管理员审批' }, { value: 'false', label: '自动授权' }]} onChange={setRequireApproval} /><input type="number" placeholder="最大使用次数（可选）" value={maxUses} min={1} onChange={event => setMaxUses(event.target.value)} /></div>
      <div className="inline-form"><button className="primary" onClick={() => run(async () => { const result = await post<{ token: string }>(`/api/resources/${resourceId}/shares`, { scope, defaultRole, password: password || undefined, expiresAt: expiresIn === '0' ? null : new Date(Date.now() + Number(expiresIn) * 86400000).toISOString(), maxUses: maxUses ? Number(maxUses) : null, requireApproval: requireApproval === 'true' }); setLink(`${location.origin}/?share=${result.token}`); }, '分享链接已生成')}>生成链接</button>{link && <button onClick={async () => { try { await navigator.clipboard.writeText(link); setMessage('链接已复制'); } catch { setMessage('无法自动复制，请手动复制链接'); } }}><Copy size={15} /> 复制</button>}</div>
      {link && <input className="share-url" readOnly value={link} onFocus={event => event.target.select()} />}
      <div className="share-list">{shares.map(share => <div key={share.id} className="share-item"><div><strong>{share.scope === 'project' ? '项目申请' : share.scope === 'document' ? '文档申请' : '项目/文档申请'}</strong><span><CalendarClock size={12} /> {share.expiresAt ? new Date(share.expiresAt).toLocaleDateString('zh-CN') : '长期有效'} · 使用 {share.uses}{share.maxUses ? `/${share.maxUses}` : ''} 次 {share.hasPassword ? '· 有密码' : ''}</span></div><button className={share.enabled ? '' : 'disabled-link'} onClick={() => run(() => patch(`/api/shares/${share.id}`, { enabled: !share.enabled }), share.enabled ? '链接已停用' : '链接已启用')}>{share.enabled ? '停用' : '启用'}</button></div>)}</div>
    </section>
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
