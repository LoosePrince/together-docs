import { useState } from 'react';
import {
  Activity, ArrowLeft, Database, FileStack, FolderOpen, Gauge, History, KeyRound,
  Link2, MessageSquare, Settings2, ShieldCheck, Users, Wifi,
} from 'lucide-react';
import type { Account } from '../../api';
import OverviewTab from './OverviewTab';
import DocumentsTab from './DocumentsTab';
import UsersTab from './UsersTab';
import SettingsTab from './SettingsTab';
import DataTab from './DataTab';
import RuntimeTab from './RuntimeTab';
import { ProjectsTab, InvitesTab, SharesTab, CommentsTab, AuditTab, SessionsTab } from './ManagementTabs';

export const adminTabs = [
  { key: 'overview', label: '总览', icon: Gauge },
  { key: 'documents', label: '文档与资源', icon: FileStack },
  { key: 'trash', label: '回收站', icon: History },
  { key: 'users', label: '用户账号', icon: Users },
  { key: 'projects', label: '项目空间', icon: FolderOpen },
  { key: 'invites', label: '注册邀请', icon: KeyRound },
  { key: 'shares', label: '分享链接', icon: Link2 },
  { key: 'comments', label: '评论', icon: MessageSquare },
  { key: 'settings', label: '站点配置', icon: Settings2 },
  { key: 'data', label: '数据与文件', icon: Database },
  { key: 'runtime', label: '运行状态', icon: Activity },
  { key: 'sessions', label: '登录会话', icon: Wifi },
  { key: 'audit', label: '操作审计', icon: ShieldCheck },
] as const;

export type AdminTabKey = typeof adminTabs[number]['key'];

export default function AdminConsole({ account, onBack, onChanged, initialTab }: {
  account: Account; onBack: () => void; onChanged: () => void; initialTab?: AdminTabKey;
}) {
  const [tab, setTab] = useState<AdminTabKey>(initialTab || 'overview');
  return <div className="page-view admin-page-view">
    <header className="workspace-header">
      <button className="icon-button" onClick={onBack} title="返回工作台"><ArrowLeft size={20} /></button>
      <div className="page-header-title"><h1>站点管理</h1><p>文档、用户、配置、数据与运行状态 · 全部操作仅站长可用</p></div>
      <span className="page-header-count"><ShieldCheck size={14} /> {account.displayName}</span>
    </header>
    <div className="page-content admin-page-content">
      <div className="admin-console">
        <nav className="admin-tabs" aria-label="站点管理分区">
          {adminTabs.map(item => {
            const Icon = item.icon;
            return <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}><Icon size={14} /> {item.label}</button>;
          })}
        </nav>
        {tab === 'overview' && <OverviewTab onNavigate={key => setTab(key as AdminTabKey)} />}
        {tab === 'documents' && <DocumentsTab initialState="active" onChanged={onChanged} />}
        {tab === 'trash' && <DocumentsTab initialState="trash" onChanged={onChanged} />}
        {tab === 'users' && <UsersTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'invites' && <InvitesTab />}
        {tab === 'shares' && <SharesTab />}
        {tab === 'comments' && <CommentsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'runtime' && <RuntimeTab />}
        {tab === 'sessions' && <SessionsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  </div>;
}
