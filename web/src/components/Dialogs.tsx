import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Modal from './Modal';

export function PromptDialog({ title, description, placeholder, initialValue = '', confirmText = '确定', onSubmit, onClose }: {
  title: string; description?: string; placeholder?: string; initialValue?: string; confirmText?: string;
  onSubmit: (value: string) => void | Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) { setError('请输入内容'); return; }
    setBusy(true); setError('');
    try { await onSubmit(value.trim()); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Modal title={title} onClose={busy ? () => {} : onClose}><form className="dialog-form" onSubmit={submit}>
    {description && <p className="muted">{description}</p>}
    <input ref={input} value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} maxLength={100} />
    {error && <div className="form-error">{error}</div>}
    <div className="dialog-actions"><button type="button" onClick={onClose} disabled={busy}>取消</button><button className="primary" type="submit" disabled={busy}>{busy ? '处理中…' : confirmText}</button></div>
  </form></Modal>;
}

export function ConfirmDialog({ title, description, confirmText = '确定', danger = false, onConfirm, onClose }: {
  title: string; description: ReactNode; confirmText?: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title={title} onClose={busy ? () => {} : onClose}><div className="dialog-form">
    <div className="confirm-description">{description}</div>{error && <div className="form-error">{error}</div>}
    <div className="dialog-actions"><button onClick={onClose} disabled={busy}>取消</button><button className={danger ? 'danger-button' : 'primary'} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm(); } catch (e) { setError((e as Error).message); setBusy(false); } }}>{busy ? '处理中…' : confirmText}</button></div>
  </div></Modal>;
}
