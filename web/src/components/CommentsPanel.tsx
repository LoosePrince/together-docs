import { useEffect, useState } from 'react';
import { MessageSquare, Send, Check, X } from 'lucide-react';
import { api, post, patch } from '../api';

type Comment = { id: string; persona: string; accountId: string; content: string; anchor: string | null; resolved: boolean; mentions: string[]; createdAt: string };

export default function CommentsPanel({ resourceId, canComment, onClose }: { resourceId: string; canComment: boolean; onClose: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]); const [content, setContent] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function load() { try { setComments(await api<Comment[]>(`/api/resources/${resourceId}/comments`)); setError(''); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { load(); }, [resourceId]);
  return <aside className="comments-panel"><header><div><MessageSquare size={17} /><strong>评论</strong></div><button className="icon-button" onClick={onClose} title="关闭评论"><X size={17} /></button></header>
    <div className="comment-list">{comments.map(comment => <article className={`comment-item ${comment.resolved ? 'resolved' : ''}`} key={comment.id}><div className="comment-head"><strong>{comment.persona}</strong><time>{new Date(comment.createdAt).toLocaleString('zh-CN')}</time></div><p>{comment.content}</p>{comment.anchor && <span className="comment-anchor">选区：{comment.anchor.slice(0, 40)}</span>}<div className="comment-actions"><button onClick={async () => { await patch(`/api/comments/${comment.id}`, { resolved: !comment.resolved }); await load(); }}><Check size={13} /> {comment.resolved ? '重新打开' : '标记解决'}</button></div></article>)}{!comments.length && <div className="comment-empty">还没有评论，开始一场讨论吧</div>}</div>
    {canComment && <form className="comment-compose" onSubmit={async event => { event.preventDefault(); if (!content.trim()) return; setBusy(true); try { await post(`/api/resources/${resourceId}/comments`, { content: content.trim() }); setContent(''); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><textarea value={content} onChange={event => setContent(event.target.value)} placeholder="写下评论，使用 @ 可提及伙伴…" maxLength={2000} /><button className="primary" type="submit" disabled={busy || !content.trim()}><Send size={14} /> 发送</button></form>}
    {error && <div className="form-error">{error}</div>}
  </aside>;
}
