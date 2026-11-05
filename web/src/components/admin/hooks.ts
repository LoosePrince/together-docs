import { useCallback, useEffect, useState } from 'react';
import { api, patch, post, del } from '../../api';
import { buildQuery } from '../../format';

export function useAdminData<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!url) return;
    setBusy(true);
    try { setData(await api<T>(url)); setError(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [url]);
  useEffect(() => { load(); }, [url, ...deps]);
  return { data, error, busy, reload: load, setData };
}

export function useAdminAction(onSuccess?: () => void | Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await action();
      if (success) setMessage(success);
      await onSuccess?.();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return { busy, error, message, run, setError, setMessage };
}

export function usePagedQuery(initial: Record<string, string> = {}) {
  const [state, setState] = useState<Record<string, string>>({ page: '1', ...initial });
  const set = (key: string, value: string) => setState(current => ({ ...current, [key]: value, page: key === 'page' ? value : '1' }));
  const setPage = (page: number) => setState(current => ({ ...current, page: String(page) }));
  return { state, set, setPage, page: Number(state.page) || 1, query: buildQuery(state) };
}

export const adminApi = {
  get: <T,>(url: string) => api<T>(url),
  post: <T,>(url: string, body?: unknown) => post<T>(url, body),
  patch: <T,>(url: string, body: unknown) => patch(url, body) as Promise<T>,
  del: <T,>(url: string) => del(url) as Promise<T>,
};
