import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, KeyRound, LockKeyhole } from 'lucide-react';
import { post } from './api';

export default function Auth({ initialized, invite, onDone }: { initialized: boolean; invite?: string; onDone: () => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const registering = !initialized || Boolean(invite);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try { await post(!initialized ? '/api/auth/bootstrap' : invite ? '/api/auth/register' : '/api/auth/login', { username, password, displayName, invite }); onDone(); }
    catch (error) { setError((error as Error).message); } finally { setLoading(false); }
  }
  return <main className="auth-page"><section className="auth-story"><div className="brand"><span className="brand-mark">T</span> Together Docs</div><div className="story-copy"><span className="eyebrow">YOUR SPACE, TOGETHER</span><h1>好想法，<br />一起写成。</h1><p>一个属于你和伙伴的私有协作空间。<br />写文档，理数据，让每个灵感都有回应。</p><div className="story-points"><span><Check size={16} /> 实时协同，所见即所得</span><span><Check size={16} /> 私有部署，数据由你掌控</span><span><Check size={16} /> 灵活身份，轻松管理权限</span></div></div><div className="orb orb-one" /><div className="orb orb-two" /></section><section className="auth-form"><form onSubmit={submit}><div className="form-icon"><LockKeyhole size={24} /></div><h2>{!initialized ? '创建你的站点' : invite ? '接受邀请' : '欢迎回来'}</h2><p className="muted">{!initialized ? '第一个账号将成为拥有完全权限的站长' : invite ? '使用邀请注册，加入伙伴的协作空间' : '登录后继续你的创作'}</p>{registering && <label>你的称呼<input autoFocus value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="如何称呼你？" required maxLength={50} /></label>}<label>用户名<input autoFocus={!registering} value={username} onChange={e => setUsername(e.target.value)} placeholder="字母、数字或 _" autoComplete="username" required minLength={3} /></label><label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 8 个字符" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={8} /></label>{error && <div className="form-error">{error}</div>}<button className="primary large" disabled={loading}>{loading ? '请稍候…' : !initialized ? '开始使用' : invite ? '注册并进入' : '登录'}<ArrowRight size={18} /></button><span className="privacy"><KeyRound size={13} /> 封闭注册 · 仅受邀用户可加入</span></form></section></main>;
}
