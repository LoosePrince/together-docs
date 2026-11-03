import { useState } from 'react';
import { ArrowRight, LogIn } from 'lucide-react';
import { post } from '../api';
import Modal from './Modal';
import Select from './Select';

export default function ShareRequest({ token, loggedIn, onLogin }: { token: string; loggedIn: boolean; onLogin: () => void }) {
  const [scope, setScope] = useState('document');
  const [role, setRole] = useState('viewer');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Modal title="申请协作文档" onClose={() => history.replaceState({}, '', '/')}>
    {done ? <div className="request-success"><h2>申请已提交</h2><p>管理员审批后，你就可以访问这份文档。</p><button className="primary" onClick={() => location.href = '/'}>返回工作台</button></div> : <div className="share-request">
      <p className="muted">申请获得此文档的访问权限。管理员可以根据情况调整你的角色。</p>
      {loggedIn ? <>
        <label>申请范围<Select value={scope} options={[{ value: 'document', label: '仅申请当前文档' }, { value: 'project', label: '申请加入所属项目' }]} onChange={setScope} /></label>
        <label>希望获得的权限<Select value={role} options={[{ value: 'viewer', label: '可浏览' }, { value: 'commenter', label: '可评论' }, { value: 'editor', label: '可编辑' }]} onChange={setRole} /></label>
        <label>申请说明<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="介绍一下自己或说明用途（可选）" /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await post(`/api/shares/${token}/apply`, { scope, role, message }); setDone(true); } catch (e) { setError((e as Error).message); setBusy(false); } }}>{busy ? '提交中…' : '提交申请'} <ArrowRight size={16} /></button>
      </> : <button className="primary large" onClick={onLogin}><LogIn size={17} /> 登录后申请</button>}
    </div>}
  </Modal>;
}
