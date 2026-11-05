import { useEffect, useState } from 'react';
import { Database, Download, FileArchive, HardDrive, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../Dialogs';
import { AdminBadge, AdminCard, AdminKeyValue, AdminPagination, AdminTable, AdminToolbar, RefreshButton } from './AdminUI';
import { buildQuery, formatBytes, formatDate } from '../../format';
import { adminApi, useAdminAction, useAdminData, usePagedQuery } from './hooks';

type Backup = { name: string; bytes: number; createdAt: string; path: string };
type DataInfo = {
  counts: Record<string, number>;
  database: { path: string; bytes: number };
  storage: { driver: string; localBlobCount: number; orphanBlobCount: number; orphanBlobBytes: number; s3Bucket: string | null };
  files: { id: string; name: string; size: number; mimeType: string; sha256: string; createdAt: string }[];
  versions: { id: string; name: string; resourceId: string; createdAt: string; fileId: string | null }[];
  backups: Backup[];
  documentTypes: { type: string; label: string; extensions: string[]; editor: string; canExport: boolean }[];
};
type FileRow = { id: string; name: string; mimeType: string; size: number; sha256: string; key: string; createdAt: string; uploader: { username: string; displayName: string } | null; resourceCount: number; versionCount: number; existsOnDisk: boolean | null };

const cleanupOptions = [
  { key: 'expiredSessions', label: '过期登录会话', hint: '删除已过期的 sessions 记录' },
  { key: 'expiredInvites', label: '过期未用邀请', hint: '删除已过期且未使用的注册邀请' },
  { key: 'expiredTrash', label: '超期回收站资源', hint: '按站点配置的保留天数永久删除' },
  { key: 'oldVersions', label: '超出上限的历史版本', hint: '按每个资源的版本保留数裁剪' },
  { key: 'orphanRows', label: '孤立关联数据', hint: '清理资源已不存在的版本、协同、评论与通知' },
  { key: 'orphanBlobs', label: '孤立本地文件', hint: '删除 blobs 目录中未被 file_objects 引用的文件' },
];

export default function DataTab() {
  const info = useAdminData<DataInfo>('/api/admin/data');
  const q = usePagedQuery({ pageSize: '20' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [restore, setRestore] = useState<Backup | null>(null);
  const [removeBackup, setRemoveBackup] = useState<Backup | null>(null);
  const [removeFile, setRemoveFile] = useState<FileRow | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [report, setReport] = useState<Record<string, number> | null>(null);
  useEffect(() => { q.set('search', search); }, [search]);
  const files = useAdminData<{ items: FileRow[]; total: number; page: number; pageSize: number }>(`/api/admin/files${buildQuery({ search, page: q.state.page, pageSize: q.state.pageSize })}`);
  const action = useAdminAction(async () => { await info.reload(); await files.reload(); });
  const data = info.data;
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <div className="admin-grid">
      <AdminCard title="数据库" icon={<Database size={17} />} description="SQLite 单实例 WAL 模式，所有权限与审计数据存储于此">
        {data && <><AdminKeyValue items={[
          ['数据库文件', <span className="mono">{data.database.path}</span>],
          ['主文件大小', formatBytes(data.database.bytes)],
          ['数据表数量', `${Object.keys(data.counts).length} 张`],
          ['总记录数', `${Object.values(data.counts).reduce((sum, value) => sum + value, 0)} 行`],
          ['存储驱动', data.storage.driver === 's3' ? `S3 (${data.storage.s3Bucket})` : '本地磁盘'],
        ]} />
          <div className="admin-meter"><i style={{ width: '100%' }} /></div></>}
      </AdminCard>
      <AdminCard title="文件存储" icon={<HardDrive size={17} />} description="SHA-256 去重文件对象与本地 blob 文件核对">
        {data && <AdminKeyValue items={[
          ['文件对象记录', `${data.counts.file_objects || 0} 个`],
          ['本地 blob 文件', `${data.storage.localBlobCount} 个`],
          ['孤立文件', `${data.storage.orphanBlobCount} 个 · ${formatBytes(data.storage.orphanBlobBytes)}`],
          ['历史版本', `${data.counts.versions || 0} 个`],
          ['协同快照', `${data.counts.collab_snapshots || 0} 个`],
          ['协同更新帧', `${data.counts.collab_updates || 0} 帧`],
        ]} />}
      </AdminCard>
      <AdminCard title="数据库备份" icon={<FileArchive size={17} />} description="使用 VACUUM INTO 生成一致性快照；恢复前请确认在线用户已保存内容" wide>
        <div className="admin-toolbar" style={{ marginBottom: 12 }}>
          <button className="primary" onClick={() => action.run(() => adminApi.post('/api/admin/backups', {}), '备份已创建')}><Database size={14} /> 立即创建备份</button>
          <RefreshButton onClick={info.reload} busy={info.busy} />
        </div>
        <AdminTable headers={['备份文件', '大小', '创建时间', '操作']} rows={(data?.backups || []).map(backup => [
          <span className="mono">{backup.name}</span>, formatBytes(backup.bytes), formatDate(backup.createdAt),
          <div className="cell-actions">
            <a href={`/api/admin/backups/${encodeURIComponent(backup.name)}/download`}><button><Download size={12} /> 下载</button></a>
            <button onClick={() => setRestore(backup)}><RotateCcw size={12} /> 恢复</button>
            <button className="danger" onClick={() => setRemoveBackup(backup)}>删除</button>
          </div>,
        ])} empty="还没有备份，建议先创建一次" />
        <div className="admin-notice warn" style={{ marginTop: 12 }}>备份只包含 SQLite 数据库，不包含 blobs 文件。完整恢复需要同时备份数据目录中的文件对象；恢复操作会关闭所有协同连接并以备份覆盖当前数据库，执行前会生成 before-restore 安全副本。</div>
      </AdminCard>
      <AdminCard title="数据清理" icon={<ShieldAlert size={17} />} description="选择要执行的清理项目，永久删除类操作不可撤销" wide>
        <div className="admin-checklist">{cleanupOptions.map(option => <label key={option.key}>
          <input type="checkbox" checked={selected.includes(option.key)} onChange={event => setSelected(ids => event.target.checked ? [...ids, option.key] : ids.filter(value => value !== option.key))} />
          <span><strong>{option.label}</strong><small>{option.hint}</small></span>
        </label>)}</div>
        <div className="admin-toolbar" style={{ marginBottom: 8 }}>
          <button className="primary" disabled={!selected.length || action.busy} onClick={() => setCleanupConfirm(true)}>执行清理（{selected.length} 项）</button>
          <button disabled={!selected.length} onClick={() => setSelected([])}>清空选择</button>
        </div>
        {report && <AdminKeyValue items={[
          ['过期会话', `${report.expiredSessions || 0} 个`], ['过期邀请', `${report.expiredInvites || 0} 个`],
          ['超期回收站资源', `${report.expiredTrash || 0} 个`], ['裁剪历史版本', `${report.oldVersions || 0} 个`],
          ['孤立关联数据', `${report.orphanRows || 0} 行`], ['孤立本地文件', `${report.orphanBlobs || 0} 个 · ${formatBytes(report.orphanBlobBytes || 0)}`],
        ]} />}
      </AdminCard>
      <AdminCard title="数据表记录数" icon={<Database size={17} />} description="全部业务表当前行数" wide>
        {data && <div className="admin-kv" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '8px 20px' }}>
          {Object.entries(data.counts).map(([name, count]) => <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid #f3f1f7', padding: '6px 0' }}><span className="mono">{name}</span><strong>{count}</strong></div>)}
        </div>}
      </AdminCard>
      <AdminCard title="文档类型驱动" icon={<HardDrive size={17} />} description="注册式驱动，新增类型无需改动权限、分享与存储模块" wide>
        <AdminTable headers={['类型标识', '名称', '扩展名', '编辑器', '可导出']} rows={(data?.documentTypes || []).map(item => [
          <span className="mono">{item.type}</span>, item.label, item.extensions.join(', ') || '—', <AdminBadge tone="info">{item.editor}</AdminBadge>, item.canExport ? '是' : '否',
        ])} empty="暂无类型驱动" />
      </AdminCard>
      <AdminCard title="文件对象" icon={<HardDrive size={17} />} description="去重后的原始文件及其引用计数" wide>
        <AdminToolbar search={search} onSearch={setSearch} placeholder="搜索文件名或 SHA-256…"><RefreshButton onClick={files.reload} busy={files.busy} /></AdminToolbar>
        <AdminTable headers={['文件', '大小 / 类型', '上传者', 'SHA-256', '引用', '本地文件', '创建时间', '操作']} rows={(files.data?.items || []).map(item => [
          <div className="cell-main"><strong>{item.name}</strong><span className="mono">{item.id.slice(0, 8)}</span></div>,
          <div className="cell-main"><span>{formatBytes(item.size)}</span><span>{item.mimeType}</span></div>,
          item.uploader?.displayName || '—', <span className="mono">{item.sha256.slice(0, 12)}…</span>,
          `资源 ${item.resourceCount} · 版本 ${item.versionCount}`,
          item.existsOnDisk === null ? <AdminBadge>S3</AdminBadge> : item.existsOnDisk ? <AdminBadge tone="good">存在</AdminBadge> : <AdminBadge tone="bad">缺失</AdminBadge>,
          formatDate(item.createdAt),
          <div className="cell-actions">
            <a href={`/api/admin/files/${item.id}/download`}><button><Download size={12} /> 下载</button></a>
            <button className="danger" disabled={item.resourceCount + item.versionCount > 0} onClick={() => setRemoveFile(item)}><Trash2 size={12} /> 删除</button>
          </div>,
        ])} empty="暂无文件对象" />
        {files.data && <AdminPagination page={files.data.page} pageSize={files.data.pageSize} total={files.data.total} onPage={q.setPage} />}
      </AdminCard>
    </div>
    {restore && <ConfirmDialog title="恢复数据库备份" description={<>将使用「{restore.name}」覆盖当前数据库。所有在线协同连接会被关闭，当前数据库会生成安全副本。文件对象不会被覆盖，请确保同时拥有匹配的文件备份。</>} confirmText="确认恢复" danger onClose={() => setRestore(null)} onConfirm={async () => { await action.run(() => adminApi.post(`/api/admin/backups/${encodeURIComponent(restore.name)}/restore`, {}), '数据库已恢复，请刷新页面重新登录'); setRestore(null); }} />}
    {removeBackup && <ConfirmDialog title="删除备份" description={<>备份文件「{removeBackup.name}」将被永久删除。</>} confirmText="删除备份" danger onClose={() => setRemoveBackup(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/backups/${encodeURIComponent(removeBackup.name)}`), '备份已删除'); setRemoveBackup(null); }} />}
    {removeFile && <ConfirmDialog title="删除文件对象" description={<>「{removeFile.name}」当前没有被资源或版本引用。删除数据库记录不会自动删除磁盘 blob，需通过「孤立本地文件」清理。</>} confirmText="删除记录" danger onClose={() => setRemoveFile(null)} onConfirm={async () => { await action.run(() => adminApi.del(`/api/admin/files/${removeFile.id}`), '文件记录已删除'); setRemoveFile(null); }} />}
    {cleanupConfirm && <ConfirmDialog title="执行数据清理" description={<>将执行选中的 {selected.length} 项清理操作。永久删除的数据无法恢复。</>} confirmText="执行清理" danger onClose={() => setCleanupConfirm(false)} onConfirm={async () => {
      setCleanupConfirm(false);
      await action.run(async () => { const result = await adminApi.post<{ report: Record<string, number> }>('/api/admin/maintenance', { actions: selected }); setReport(result.report); }, '清理完成');
    }} />}
  </div>;
}
