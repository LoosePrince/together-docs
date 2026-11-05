import { useEffect, useState } from 'react';
import { Save, Server, Settings2, ShieldCheck } from 'lucide-react';
import Select from '../Select';
import { AdminCard, AdminKeyValue } from './AdminUI';
import { formatBytes } from '../../format';
import { adminApi, useAdminAction, useAdminData } from './hooks';

type Definition = {
  key: string; label: string; group: string; description: string; kind: 'string' | 'number' | 'boolean';
  min?: number; max?: number; maxLength?: number; options?: { value: string; label: string }[]; unit?: string;
};
type SettingsData = {
  values: Record<string, string | number | boolean>;
  definitions: Definition[];
  environment: Record<string, unknown>;
  updatedAt: Promise<string>;
};

export default function SettingsTab() {
  const { data, busy, reload } = useAdminData<SettingsData>('/api/admin/settings');
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const action = useAdminAction(reload);
  useEffect(() => { if (data) setDraft(data.values); }, [data]);
  if (!data) return <div className="admin-empty"><h4>正在加载站点配置…</h4></div>;
  const groups = [...new Set(data.definitions.map(item => item.group))];
  const dirtyKeys = Object.keys(draft).filter(key => draft[key] !== data.values[key]);
  const env = data.environment as Record<string, any>;
  return <div className="admin-tab-content">
    {action.error && <div className="form-error">{action.error}</div>}{action.message && <div className="success-message">{action.message}</div>}
    <div className="admin-toolbar">
      <button className="primary" disabled={!dirtyKeys.length || action.busy} onClick={() => action.run(() => adminApi.patch('/api/admin/settings', { values: Object.fromEntries(dirtyKeys.map(key => [key, draft[key]])) }), '站点配置已保存')}><Save size={14} /> 保存更改{dirtyKeys.length ? `（${dirtyKeys.length} 项）` : ''}</button>
      <button disabled={!dirtyKeys.length} onClick={() => setDraft(data.values)}>放弃更改</button>
      <button disabled={busy} onClick={reload}>重新加载</button>
    </div>
    <div className="admin-notice">配置保存在数据库中，修改后立即生效。上传大小不能超过服务启动时环境变量 <strong>MAX_UPLOAD_BYTES</strong> 设置的上限；会话有效期只影响新登录的会话。</div>
    {groups.map(group => <section className="admin-settings-group" key={group}>
      <h4><Settings2 size={15} /> {group}</h4>
      {data.definitions.filter(item => item.group === group).map(item => {
        const value = draft[item.key];
        return <div className="admin-setting" key={item.key}>
          <div className="admin-setting-info"><strong>{item.label}</strong><p>{item.description}</p><span className="mono">{item.key}</span></div>
          <div className="admin-setting-control">
            {item.kind === 'boolean' ? <button className={`admin-toggle ${value ? 'on' : ''}`} aria-label={item.label} aria-pressed={Boolean(value)} onClick={() => setDraft({ ...draft, [item.key]: !value })} />
              : item.options ? <Select label={item.label} value={String(value ?? '')} options={item.options} onChange={next => setDraft({ ...draft, [item.key]: next })} />
                : <><input type={item.kind === 'number' ? 'number' : 'text'} min={item.min} max={item.max} maxLength={item.maxLength} value={String(value ?? '')} onChange={event => setDraft({ ...draft, [item.key]: item.kind === 'number' ? Number(event.target.value) : event.target.value })} />{item.unit && <span className="unit">{item.unit}</span>}</>}
          </div>
        </div>;
      })}
    </section>)}
    <div className="admin-grid">
      <AdminCard title="运行环境" icon={<Server size={17} />} description="由环境变量 / 启动参数决定，修改后需重启服务">
        <AdminKeyValue items={[
          ['Node / 环境', String(env.nodeEnv)],
          ['监听地址', `${env.host}:${env.port}`],
          ['公开地址', String(env.publicUrl)],
          ['跨域来源', Array.isArray(env.corsOrigins) ? env.corsOrigins.join(', ') : String(env.corsOrigins)],
          ['数据库', String(env.databasePath)],
          ['数据目录', String(env.dataDir)],
          ['存储驱动', String(env.storageDriver)],
          ['本地文件目录', String(env.localStorageDir)],
          ['上传上限（环境）', formatBytes(Number(env.maxUploadBytesFromEnv))],
          ['会话天数（环境）', `${env.sessionDaysFromEnv} 天`],
          ['S3 桶', env.s3Bucket ? String(env.s3Bucket) : '未配置（使用本地存储）'],
        ]} />
      </AdminCard>
      <AdminCard title="安全与部署检查" icon={<ShieldCheck size={17} />} description="只读检查，不展示任何密钥内容">
        <AdminKeyValue items={[
          ['会话密钥', env.secretConfigured ? '已配置自定义 SESSION_SECRET' : '使用开发默认值'],
          ['会话 Cookie', 'HttpOnly · SameSite=Lax'],
          ['匿名分享查看', data.values.allowAnonymousShareView ? '允许' : '禁止（推荐）'],
          ['注册方式', data.values.registrationMode === 'closed' ? '已关闭注册' : '邀请注册'],
          ['分享审批', data.values.defaultRequireApproval ? '默认需要审批' : '默认自动通过'],
          ['回收站保留', `${data.values.trashRetentionDays} 天`],
          ['历史版本上限', `${data.values.maxVersionsPerResource} 个`],
          ['配置最后更新', '见保存后返回值'],
        ]} />
        <div className="admin-notice warn" style={{ marginTop: 14 }}>生产部署必须使用 HTTPS、设置长度至少 32 字节的 SESSION_SECRET，并同时备份 SQLite 与文件存储。备份与恢复入口位于「数据与文件」。</div>
      </AdminCard>
    </div>
  </div>;
}

