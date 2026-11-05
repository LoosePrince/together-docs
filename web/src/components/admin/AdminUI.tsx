import { ChevronLeft, ChevronRight, Search, RefreshCw, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import Select from '../Select';

export function AdminCard({ title, icon, description, wide, children }: { title: string; icon?: ReactNode; description?: string; wide?: boolean; children: ReactNode }) {
  return <section className={`admin-panel-card ${wide ? 'wide' : ''}`}><h3>{icon}{title}</h3>{description && <p>{description}</p>}{children}</section>;
}

export function AdminStat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return <article className="admin-stat"><span className="stat-label">{icon}{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

export function AdminBadge({ children, tone = '' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'info' | '' }) {
  return <span className={`admin-badge ${tone}`}>{children}</span>;
}

export function AdminToolbar({ search, onSearch, placeholder = '搜索…', filters = [], children }: {
  search?: string; onSearch?: (value: string) => void; placeholder?: string;
  filters?: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string }[];
  children?: ReactNode;
}) {
  return <div className="admin-toolbar">
    {onSearch && <div className="search-field"><Search size={15} /><input value={search || ''} onChange={event => onSearch(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>}
    {filters.map(filter => <Select key={filter.label} label={filter.label} value={filter.value} options={filter.options} onChange={filter.onChange} />)}
    {children}
  </div>;
}

export function AdminTable({ headers, rows, empty = '暂无数据' }: { headers: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <div className="admin-empty"><Inbox size={30} strokeWidth={1.2} /><h4>{empty}</h4></div>;
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr>{headers.map((header, index) => <th key={index}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

export function AdminPagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="admin-pagination"><span>共 {total} 条 · 第 {Math.min(page, pages)} / {pages} 页</span><div>
    <button disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={13} /> 上一页</button>
    <button disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页 <ChevronRight size={13} /></button>
  </div></div>;
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return <button onClick={onClick} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? '刷新中…' : '刷新'}</button>;
}

export function AdminKeyValue({ items }: { items: [string, ReactNode][] }) {
  return <dl className="admin-kv">{items.map(([key, value], index) => <div key={index} style={{ display: 'contents' }}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}
