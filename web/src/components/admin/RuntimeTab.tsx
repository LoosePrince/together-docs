import { useEffect, useState } from 'react';
import { Activity, Cpu, Server, Wifi, XCircle } from 'lucide-react';
import { ConfirmDialog } from '../Dialogs';
import { AdminBadge, AdminCard, AdminKeyValue, AdminTable, AdminToolbar, RefreshButton } from './AdminUI';
import { formatBytes, formatDate, formatDuration } from '../../format';
import { adminApi, useAdminAction, useAdminData } from './hooks';

type Room = { resourceId: string; kind: string; clients: number; detail?: Record<string, unknown> };
type Connection = { id: string; kind: string; resourceId: string; accountId: string; role: string; connectedAt: string; account?: { username: string; displayName: string }; resource?: { name: string } };
type Runtime = {
  status: string; startedAt: string; uptimeSeconds: number; timestamp: string;
  process: { pid: number; nodeVersion: string; platform: string; arch: string; nodeEnv: string; memoryRssBytes: number; memoryHeapUsedBytes: number; memoryHeapTotalBytes: number; cpuCount: number; loadAverage: number[]; totalMemoryBytes: number; freeMemoryBytes: number };
  database: { path: string; bytes: number; walBytes: number; pageCount: number; pageSize: number; journalMode: unknown; foreignKeys: boolean; busyTimeout: unknown; sqliteVersion: { version: string } };
  storage: { driver: string; localStorageDir: string; blobFiles: number; blobBytes: number; s3Bucket: string | null; s3Configured: boolean; localScanAvailable: boolean };
  collaboration: { liveConnections: number; documentConnections: number; officeConnections: number; rooms: Room[] };
  http: { total: number; errors: number; durationMs: number; startedAt: string; averageDurationMs: number; statusCodes: Record<string, number> };
  connections: Connection[];
  detailed: boolean;
};

export default function RuntimeTab() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { data, busy, reload } = useAdminData<Runtime>('/api/admin/runtime?detailed=true');
  const [closeAll, setCloseAll] = useState(false);
  const [closeOne, setCloseOne] = useState<Connection | null>(null);
  const action = useAdminAction(reload);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, reload]);
  if (!data) return <div className="admin-empty"><h4>正在读取运行状态…</h4></div>;
  const p = data.process; const d = data.database; const s = data.storage; const h = data.http;
  const heapPercent = Math.min(100, Math.round(p.memoryHeapUsedBytes / Math.max(1, p.memoryHeapTotalBytes) * 100));
  const memoryPercent = Math.min(100, Math.round((p.totalMemoryBytes - p.freeMemoryBytes) / Math.max(1, p.totalMemoryBytes) * 100));
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <AdminToolbar>
      <AdminBadge tone="good">{data.status === 'ok' ? '服务正常' : data.status}</AdminBadge>
      <span className="muted">每 10 秒自动刷新 · 采样时间 {formatDate(data.timestamp)}</span>
      <button onClick={() => setAutoRefresh(!autoRefresh)}>{autoRefresh ? '暂停自动刷新' : '启用自动刷新'}</button>
      <RefreshButton onClick={reload} busy={busy} />
    </AdminToolbar>
    <div className="admin-grid">
      <AdminCard title="进程" icon={<Cpu size={17} />} description="Node.js 应用进程（单实例模块化单体）">
        <AdminKeyValue items={[
          ['进程 PID', String(p.pid)],
          ['Node 版本', p.nodeVersion],
          ['运行平台', `${p.platform} / ${p.arch} · ${p.nodeEnv}`],
          ['CPU 核心', `${p.cpuCount} 核 · 负载 ${p.loadAverage.map(value => value.toFixed(2)).join(' / ')}`],
          ['启动时间', formatDate(data.startedAt)],
          ['运行时长', formatDuration(data.uptimeSeconds)],
          ['常驻内存', formatBytes(p.memoryRssBytes)],
          ['堆内存', `${formatBytes(p.memoryHeapUsedBytes)} / ${formatBytes(p.memoryHeapTotalBytes)}`],
        ]} />
        <div className="admin-meter"><i style={{ width: `${heapPercent}%` }} /></div><span className="muted">堆使用率 {heapPercent}%</span>
        <div className="admin-meter"><i style={{ width: `${memoryPercent}%` }} /></div><span className="muted">系统内存使用率 {memoryPercent}%（共 {formatBytes(p.totalMemoryBytes)}）</span>
      </AdminCard>
      <AdminCard title="数据库与存储" icon={<Server size={17} />} description="SQLite 与文件驱动实时状态">
        <AdminKeyValue items={[
          ['数据库', <span className="mono">{d.path}</span>],
          ['主文件 / WAL', `${formatBytes(d.bytes)} / ${formatBytes(d.walBytes)}`],
          ['页数量 / 页大小', `${d.pageCount} / ${formatBytes(d.pageSize)}`],
          ['SQLite 版本', d.sqliteVersion.version],
          ['WAL 模式', String(d.journalMode)],
          ['外键约束', d.foreignKeys ? '已开启' : '未开启'],
          ['Busy Timeout', `${d.busyTimeout} ms`],
          ['存储驱动', s.driver === 's3' ? `S3 · ${s.s3Bucket}` : '本地磁盘'],
          ['blob 文件', `${s.blobFiles} 个 · ${formatBytes(s.blobBytes)}`],
        ]} />
      </AdminCard>
      <AdminCard title="HTTP 请求" icon={<Activity size={17} />} description="自进程启动以来的请求统计">
        <AdminKeyValue items={[
          ['请求总数', String(h.total)],
          ['错误响应（≥400）', String(h.errors)],
          ['错误率', `${h.total ? (h.errors / h.total * 100).toFixed(2) : '0.00'}%`],
          ['平均响应时间', `${h.averageDurationMs} ms`],
          ['累计处理时间', `${Math.round(h.durationMs / 1000)} 秒`],
          ['状态分布', Object.entries(h.statusCodes).map(([key, value]) => `${key}: ${value}`).join(' · ') || '暂无'],
        ]} />
      </AdminCard>
      <AdminCard title="协同服务" icon={<Wifi size={17} />} description="应用内 Yjs / Yrs WebSocket relay 房间">
        <AdminKeyValue items={[
          ['在线连接', `${data.collaboration.liveConnections} 个`],
          ['原生文档连接', `${data.collaboration.documentConnections} 个`],
          ['Office 连接', `${data.collaboration.officeConnections} 个`],
          ['活跃房间', `${data.collaboration.rooms.length} 个`],
        ]} />
        <div className="admin-drawer-actions" style={{ marginTop: 14 }}><button className="danger" disabled={!data.collaboration.liveConnections} onClick={() => setCloseAll(true)}><XCircle size={13} /> 关闭全部连接</button></div>
      </AdminCard>
      <AdminCard title="协同房间" icon={<Wifi size={17} />} description="按资源隔离的在线编辑房间" wide>
        <AdminTable headers={['资源 ID', '类型', '在线人数', '房间状态']} rows={data.collaboration.rooms.map(room => [
          <span className="mono">{room.resourceId.slice(0, 8)}…</span>, room.kind === 'document' ? '原生文档' : 'Office', `${room.clients} 人`,
          <span className="mono">{Object.entries(room.detail || {}).map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || '—'}</span>,
        ])} empty="当前没有活跃房间" />
      </AdminCard>
      <AdminCard title="在线连接" icon={<Wifi size={17} />} description="可强制关闭单个连接（被撤销权限时同样会触发）" wide>
        <AdminTable headers={['连接 ID', '账号', '资源', '类型', '角色', '连接时间', '操作']} rows={data.connections.map(connection => [
          <span className="mono">{connection.id}</span>,
          connection.account ? `${connection.account.displayName} (@${connection.account.username})` : <span className="mono">{connection.accountId.slice(0, 8)}</span>,
          connection.resource?.name || <span className="mono">{connection.resourceId.slice(0, 8)}</span>,
          connection.kind === 'document' ? '原生文档' : 'Office', connection.role, formatDate(connection.connectedAt),
          <div className="cell-actions"><button className="danger" onClick={() => setCloseOne(connection)}>关闭</button></div>,
        ])} empty="当前没有在线协同连接" />
      </AdminCard>
    </div>
    {closeOne && <ConfirmDialog title="关闭协同连接" description={<>将强制关闭 {closeOne.account?.displayName || closeOne.accountId} 的协同连接，客户端需要重新同步。</>} confirmText="关闭连接" danger onClose={() => setCloseOne(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/connections/${closeOne.id}`), '连接已关闭'); setCloseOne(null); }} />}
    {closeAll && <ConfirmDialog title="关闭全部协同连接" description={<>将关闭当前所有在线协同连接，在线用户需要刷新页面重新同步。不会丢失已保存的数据库内容。</>} confirmText="全部关闭" danger onClose={() => setCloseAll(false)} onConfirm={async () => { await action.run(() => adminApi.post('/api/admin/connections/close', {}), '全部连接已关闭'); setCloseAll(false); }} />}
  </div>;
}

