import { useEffect, useState } from 'react';
import { ArrowRight, LogIn, KeyRound } from 'lucide-react';
import { api, post } from '../api';
import Modal from './Modal';
import Select from './Select';

export default function ShareRequest({ token, loggedIn, onLogin }: { token: string; loggedIn: boolean; onLogin: () => void }) {
  const [info, setInfo] = useState<any>(null); const [scope, setScope] = useState('document'); const [role, setRole] = useState('viewer'); const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [done, setDone] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<any>(`/api/shares/${token}`).then(data => { setInfo(data); setRole(data.defaultRole || 'viewer'); setScope(data.scope === 'project' ? 'project' : 'document'); }).catch(e => setError((e as Error).message)); }, [token]);
  return <Modal title="申请协作文档" onClose={() => history.replaceState({}, '', '/')}>
    {done ? <div className="request-success"><h2>申请已提交</h2><p>管理员审批后，你就可以访问这份文档。</p><button className="primary" onClick={() => location.href = '/'}>返回工作台</button></div> : <div className="share-request">
      <p className="muted">{info?.resourceName ? `申请访问「${info.resourceName}」。` : '正在读取分享信息…'}</p>
      {error && <div className="form-error">{error}</div>}
      {loggedIn && info ? <>
        {info.scope === 'both' && <label>申请范围<Select value={scope} options={[{ value: 'document', label: '仅申请当前文档' }, { value: 'project', label: '申请加入所属项目' }]} onChange={setScope} /></label>}
        <label>希望获得的权限<Select value={role} options={[{ value: 'viewer', label: '可浏览' }, { value: 'commenter', label: '可评论' }, { value: 'editor', label: '可编辑' }]} onChange={setRole} /></label>
        {info.hasPassword && <label>分享密码<span className="password-input"><KeyRound size={15} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="请输入分享密码" /></span></label>}
        <label>申请说明<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="介绍一下自己或说明用途（可选）" /></label>
        <button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await post(`/api/shares/${token}/apply`, { scope, role, message, password }); setDone(true); } catch (e) { setError((e as Error).message); setBusy(false); } }}>{busy ? '提交中…' : '提交申请'} <ArrowRight size={16} /></button>
      </> : !error && <button className="primary large" onClick={onLogin}><LogIn size={17} /> 登录后申请</button>}
    </div>}
  </Modal>;
}
