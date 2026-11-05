import { Activity, Bell, Database, FileStack, Files, FolderOpen, Gauge, HardDrive, Layers, Link2, MessageSquare, ShieldCheck, Trash2, Users, Wifi } from 'lucide-react';
import { AdminBadge, AdminCard, AdminKeyValue, AdminStat, RefreshButton } from './AdminUI';
import { formatBytes, formatDate, formatDuration } from '../../format';
import { useAdminData } from './hooks';

type Overview = {
  counts: Record<string, number>;
  resourcesByType: { type: string; label: string; count: number }[];
  runtime: { uptimeSeconds: number; liveConnections: number; status: string };
  recentAudit: { id: string; action: string; resourceId: string | null; createdAt: string; account: { username: string; displayName: string } | null }[];
};

export default function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { data, busy, reload } = useAdminData<Overview>('/api/admin/overview');
  if (!data) return <div className="admin-empty"><h4>正在加载站点概览…</h4></div>;
  const c = data.counts;
  return <div className="admin-tab-content">
    <div className="admin-stats">
      <AdminStat label="站点账号" value={c.accounts} hint={`${c.activeAccounts} 个启用`} icon={<Users size={14} />} />
      <AdminStat label="全部资源" value={c.resources} hint={`${c.trashedResources} 个在回收站`} icon={<FileStack size={14} />} />
      <AdminStat label="项目空间" value={c.projects} icon={<FolderOpen size={14} />} />
      <AdminStat label="文件对象" value={c.fileObjects} hint={formatBytes(c.storageBytes)} icon={<Files size={14} />} />
      <AdminStat label="待审申请" value={c.pendingRequests} hint="分享链接权限申请" icon={<Bell size={14} />} />
      <AdminStat label="活跃协同" value={data.runtime.liveConnections} hint={`运行 ${formatDuration(data.runtime.uptimeSeconds)}`} icon={<Wifi size={14} />} />
      <AdminStat label="历史版本" value={c.versions} icon={<Layers size={14} />} />
      <AdminStat label="审计记录" value={c.auditLogs} icon={<ShieldCheck size={14} />} />
    </div>
    <div className="admin-grid">
      <AdminCard title="运行状态" icon={<Gauge size={17} />} description="当前进程与协同连接的实时概况">
        <AdminKeyValue items={[
          ['服务状态', <AdminBadge tone="good">正常</AdminBadge>],
          ['运行时长', formatDuration(data.runtime.uptimeSeconds)],
          ['在线协同连接', `${data.runtime.liveConnections} 个`],
          ['活跃会话', `${c.sessions} 个`],
          ['智能表格记录', `${c.smartRecords} 行`],
          ['站内通知', `${c.notifications} 条`],
          ['评论', `${c.comments} 条`],
          ['分享链接', `${c.shareLinks} 个`],
        ]} />
        <div className="admin-drawer-actions" style={{ marginTop: 14 }}><button onClick={() => onNavigate('runtime')}>查看运行状态</button><button onClick={() => onNavigate('sessions')}>管理会话</button></div>
      </AdminCard>
      <AdminCard title="资源构成" icon={<HardDrive size={17} />} description="按文档类型统计未删除的资源">
        {data.resourcesByType.length ? <AdminKeyValue items={data.resourcesByType.map(row => [row.label, `${row.count} 个`] as [string, React.ReactNode])} /> : <p className="muted">暂无资源</p>}
        <div className="admin-drawer-actions" style={{ marginTop: 14 }}><button onClick={() => onNavigate('documents')}>管理文档</button><button onClick={() => onNavigate('data')}>数据与文件</button></div>
      </AdminCard>
      <AdminCard title="存储占用" icon={<Database size={17} />} description="文件对象累计大小（数据库大小在数据页查看）" wide>
        <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><strong style={{ fontSize: 22 }}>{formatBytes(c.storageBytes)}</strong><p className="muted" style={{ margin: '4px 0 0' }}>{c.fileObjects} 个去重文件对象</p></div>
          <div style={{ flex: 1, minWidth: 220 }}><div className="admin-meter"><i style={{ width: '100%' }} /></div><span className="muted">内容按 SHA-256 去重存储，历史版本会复用同一文件</span></div>
          <div><AdminBadge tone="info">{c.trashedResources} 个回收站资源</AdminBadge></div>
        </div>
      </AdminCard>
      <AdminCard title="最近操作" icon={<Activity size={17} />} description="全站审计日志的最新 8 条记录" wide>
        <div className="admin-logs">{data.recentAudit.length ? data.recentAudit.map(log => <div className="admin-log-row" key={log.id}>
          <time>{formatDate(log.createdAt)}</time><strong>{log.action}</strong><span>{log.account?.displayName || log.account?.username || '系统'} · {log.resourceId || '全站操作'}</span>
        </div>) : <div className="admin-empty"><h4>暂无审计记录</h4></div>}</div>
        <div className="admin-drawer-actions" style={{ marginTop: 12 }}><button onClick={() => onNavigate('audit')}>查看完整审计</button><RefreshButton onClick={reload} busy={busy} /></div>
      </AdminCard>
      <AdminCard title="快捷入口" icon={<Link2 size={17} />} description="常用管理任务" wide>
        <div className="admin-drawer-actions">
          <button onClick={() => onNavigate('users')}>用户与账号</button>
          <button onClick={() => onNavigate('documents')}>文档与资源</button>
          <button onClick={() => onNavigate('projects')}>项目空间</button>
          <button onClick={() => onNavigate('invites')}>注册邀请</button>
          <button onClick={() => onNavigate('settings')}>站点配置</button>
          <button onClick={() => onNavigate('data')}>数据库备份</button>
          <button onClick={() => onNavigate('audit')}>操作审计</button>
          <button onClick={() => onNavigate('trash')}><Trash2 size={12} /> 回收站清理</button>
          <button onClick={() => onNavigate('comments')}><MessageSquare size={12} /> 评论管理</button>
        </div>
      </AdminCard>
    </div>
  </div>;
}
