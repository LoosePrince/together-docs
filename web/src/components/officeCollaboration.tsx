import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, CloudOff, Loader2, Save } from 'lucide-react';
import { api, post } from '../api';

export type CollaborationTransport = {
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  send(data: Uint8Array): boolean;
  onEvent(listener: (event: { type: string; data?: Uint8Array; reason?: string; error?: unknown }) => void): () => void;
};

function createRoomTransport(resourceId: string): CollaborationTransport {
  const listeners = new Set<(event: any) => void>();
  let socket: WebSocket | null = null;
  let wantsConnection = false;
  let retry = 250;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let drain: ReturnType<typeof setInterval> | null = null;
  const emit = (event: any) => { for (const listener of [...listeners]) listener(event); };
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/office/${resourceId}`;
  const open = () => {
    if (!wantsConnection || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    const next = new WebSocket(url);
    next.binaryType = 'arraybuffer';
    socket = next;
    next.onopen = () => { retry = 250; emit({ type: 'open' }); };
    next.onmessage = event => { if (event.data instanceof ArrayBuffer) emit({ type: 'message', data: new Uint8Array(event.data) }); };
    next.onerror = error => emit({ type: 'error', error });
    next.onclose = event => {
      socket = null;
      emit({ type: 'close', reason: event.reason });
      if (wantsConnection && !timer) timer = setTimeout(() => { timer = null; open(); }, retry = Math.min(retry * 2, 5000));
    };
  };
  return {
    connect() { wantsConnection = true; open(); },
    disconnect() {
      wantsConnection = false;
      if (timer) clearTimeout(timer);
      if (drain) clearInterval(drain);
      timer = null; drain = null;
      const current = socket; socket = null; current?.close(1000, 'Disconnected');
    },
    send(data) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      if (socket.bufferedAmount > 1024 * 1024) {
        if (!drain) drain = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount <= 1024 * 1024) { clearInterval(drain!); drain = null; emit({ type: 'drain' }); }
        }, 50);
        return false;
      }
      const owned = new ArrayBuffer(data.byteLength);
      new Uint8Array(owned).set(data);
      socket.send(owned);
      return true;
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

function toBase64(bytes: Uint8Array | ArrayBuffer) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let result = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) result += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  return btoa(result);
}

export async function saveOfficeBytes(resourceId: string, bytes: Uint8Array | ArrayBuffer) {
  return post<{ fileId: string }>(`/api/resources/${resourceId}/office-save`, { content: toBase64(bytes) });
}

export function useBetterOfficeCollaboration(resourceId: string, format: 'docx' | 'xlsx', accountName: string, Provider: any) {
  const provider = useRef<any>(null);
  const transport = useRef<CollaborationTransport | null>(null);
  const [status, setStatus] = useState('连接中');
  const [initialUpdate, setInitialUpdate] = useState<Uint8Array | undefined>();
  const [ready, setReady] = useState(false);
  const accountRef = useRef(accountName);
  accountRef.current = accountName;
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    api<{ initialUpdate?: string | null }>(`/api/resources/${resourceId}/office-state?format=${format}`)
      .then(data => { if (!cancelled && data.initialUpdate) setInitialUpdate(Uint8Array.from(atob(data.initialUpdate), character => character.charCodeAt(0))); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [resourceId, format]);
  const onReplica = useCallback((replica: any) => {
    provider.current?.destroy?.();
    transport.current?.disconnect();
    if (!replica) return;
    const name = accountRef.current;
    const next = createRoomTransport(resourceId);
    transport.current = next;
    const connected = new Provider(replica, next, { user: { name, color: '#7161df' } });
    provider.current = connected;
    connected.onStatus?.((change: any) => setStatus(change.synced || change.status === 'connected' ? '已同步' : change.status === 'connecting' ? '连接中' : '离线'));
    connected.onError?.(() => setStatus('协同连接异常'));
    connected.connect();
  }, [resourceId, Provider]);
  const collaboration = useMemo(() => ({
    clientId: Math.floor(Math.random() * 2 ** 31),
    initialUpdate,
    user: { name: accountName, color: '#7161df' },
    onReplica,
  }), [initialUpdate, accountName, onReplica]);
  useEffect(() => () => { provider.current?.destroy?.(); transport.current?.disconnect(); }, []);
  return { collaboration: ready ? collaboration : undefined, status };
}

export function OfficeStatusBar({ status, onSave }: { status: string; onSave?: () => void }) {
  return <div className="office-status"><span>{status === '已同步' ? <Cloud size={14} /> : status === '连接中' ? <Loader2 size={14} className="spin" /> : <CloudOff size={14} />}{status}</span>{onSave && <button onClick={onSave}><Save size={14} /> 保存到空间</button>}</div>;
}
