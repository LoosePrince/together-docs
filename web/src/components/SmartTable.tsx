import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, Plus, Trash2, Download, Columns3, KanbanSquare, FileInput, ChevronDown } from 'lucide-react';
import { api, post, patch, del, put } from '../api';
import Select from './Select';
import { ConfirmDialog, PromptDialog } from './Dialogs';

type Field = { id: string; name: string; type: string; access: string; options: { options?: string[] } };
type RecordRow = { id: string; access: string; values: Record<string, any> };
type View = { id: string; name: string; type: 'grid' | 'kanban' | 'form'; configuration: Record<string, any>; isPublic: boolean };
type Member = { account: { id: string; username: string; displayName: string } };
const roleOptions = [{ value: 'hidden', label: '不可见' }, { value: 'viewer', label: '只读' }, { value: 'editor', label: '可编辑' }];
const fieldTypeLabels: Record<string, string> = { currency: '货币', percent: '百分比', datetime: '日期时间', longtext: '多行文本', created_by: '创建人', updated_by: '修改人', created_at: '创建时间', updated_at: '修改时间', auto_number: '自动编号', attachment: '附件', person: '人员', url: '链接', date: '日期', checkbox: '复选', multiselect: '多选', select: '单选', number: '数字', text: '文本' };
const fieldTypeOptions = Object.entries(fieldTypeLabels).map(([value, label]) => ({ value, label }));
const computedTypes = new Set(['created_by', 'updated_by', 'created_at', 'updated_at', 'auto_number']);

export default function SmartTable({ resourceId, canEdit, canManage }: { resourceId: string; canEdit: boolean; canManage: boolean }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [activeView, setActiveView] = useState('grid');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policy, setPolicy] = useState({ kind: 'row', targetId: '', accountId: '', access: 'viewer' });
  const [fieldDialog, setFieldDialog] = useState(false);
  const [fieldType, setFieldType] = useState('text');
  const [viewDialog, setViewDialog] = useState(false);
  const [viewType, setViewType] = useState('grid');
  const [deleteField, setDeleteField] = useState<Field | null>(null);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const data = await api<{ fields: Field[]; records: RecordRow[]; views: View[] }>(`/api/resources/${resourceId}/table`);
      setFields(data.fields); setRecords(data.records); setViews(data.views); setError('');
      if (canManage) setMembers(await api<Member[]>(`/api/resources/${resourceId}/members`));
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { setLoading(true); load(); }, [resourceId]);
  async function run(action: () => Promise<unknown>) {
    setError('');
    try { await action(); await load(); } catch (e) { setError((e as Error).message); await load(); }
  }
  const change = (row: RecordRow, field: Field, value: any) => {
    setRecords(rows => rows.map(item => item.id === row.id ? { ...item, values: { ...item.values, [field.id]: value } } : item));
    run(() => patch(`/api/resources/${resourceId}/records/${row.id}`, { values: { [field.id]: value } }));
  };
  const active = views.find(view => view.id === activeView);
  const currentType = active?.type || 'grid';
  const targetOptions = policy.kind === 'row'
    ? records.map(row => ({ value: row.id, label: `记录 #${records.indexOf(row) + 1}` }))
    : fields.map(field => ({ value: field.id, label: field.name }));
  const kanbanField = fields.find(field => field.type === 'select');
  const viewOptions = [{ value: 'grid', label: '表格视图' }, ...views.map(view => ({ value: view.id, label: `${view.name}${view.type === 'kanban' ? '（看板）' : view.type === 'form' ? '（表单）' : ''}` }))];

  async function importCsv(file: File) {
    const content = await file.text(); const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) throw new Error('CSV 至少需要表头和一行数据');
    const split = (line: string) => (line.match(/(?:"([^"]|"")*"|[^,])*(?:,|$)/g) || []).map(part => part.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"'));
    const headers = split(lines[0]!);
    const known = fields.filter(field => !computedTypes.has(field.type));
    const newFields: string[] = [];
    for (const header of headers) if (!known.some(field => field.name === header)) newFields.push(header);
    for (const name of newFields) await post(`/api/resources/${resourceId}/fields`, { name, type: 'text' });
    const updatedFields = await api<{ fields: Field[] }>(`/api/resources/${resourceId}/table`);
    const writable = updatedFields.fields.filter(field => !computedTypes.has(field.type) && field.access !== 'viewer' && field.access !== 'hidden' && field.type !== 'select');
    for (const line of lines.slice(1)) {
      const cells = split(line); const result = await post<{ id: string }>(`/api/resources/${resourceId}/records`, {});
      const values: Record<string, string> = {};
      headers.forEach((header, index) => {
        const field = writable.find(item => item.name === header);
        if (field && cells[index] !== undefined && field.id) values[field.id] = cells[index]!;
      });
      if (Object.keys(values).length) await patch(`/api/resources/${resourceId}/records/${result.id}`, { values });
    }
  }
  async function submitForm() {
    const result = await post<{ id: string }>(`/api/resources/${resourceId}/records`, {});
    const values = Object.fromEntries(Object.entries(formValues).filter(([, value]) => value !== '' && value !== undefined));
    if (Object.keys(values).length) await patch(`/api/resources/${resourceId}/records/${result.id}`, { values });
    setFormValues({}); await load(); setError('表单已提交');
  }
  if (loading) return <div className="editor-loading">正在加载数据…</div>;
  return <div className="smart-table">
    <div className="table-tabs">
      <Select className="view-switcher" label="视图" value={activeView} options={viewOptions} onChange={setActiveView} />
      <button onClick={() => run(() => post(`/api/resources/${resourceId}/records`, {}))} disabled={!canEdit}><Plus size={16} /> 新建记录</button>
      <button onClick={() => setFieldDialog(true)} disabled={!canManage}><Plus size={16} /> 新建字段</button>
      <button onClick={() => setViewDialog(true)} disabled={!canManage}><Plus size={16} /> 新建视图</button>
      <button onClick={() => setPolicyOpen(!policyOpen)} disabled={!canManage}><LockKeyhole size={15} /> 行列权限</button>
      <a className="table-action" href={`/api/resources/${resourceId}/table/export`}><Download size={15} /> 导出 CSV</a>
      <button onClick={() => fileInput.current?.click()} disabled={!canEdit}><FileInput size={15} /> 导入 CSV</button>
      <input ref={fileInput} hidden type="file" accept=".csv,text/csv" onChange={async event => { const file = event.target.files?.[0]; if (file) { try { await importCsv(file); await load(); setError('CSV 导入完成'); } catch (e) { setError((e as Error).message); } } event.target.value = ''; }} />
    </div>
    {error && <div className={error.includes('完成') || error.includes('已提交') ? 'success-message' : 'form-error'}>{error}</div>}
    {policyOpen && <div className="policy-panel">
      <Select label="权限类型" value={policy.kind} options={[{ value: 'row', label: '行权限' }, { value: 'field', label: '字段权限' }]} onChange={kind => setPolicy({ ...policy, kind, targetId: '' })} />
      <Select label="权限目标" value={policy.targetId} options={targetOptions} placeholder="选择目标" onChange={targetId => setPolicy({ ...policy, targetId })} />
      <Select label="被授权成员" value={policy.accountId} options={members.map(({ account }) => ({ value: account.id, label: `${account.displayName} (@${account.username})` }))} placeholder="选择成员" onChange={accountId => setPolicy({ ...policy, accountId })} />
      <Select label="访问级别" value={policy.access} options={roleOptions} onChange={access => setPolicy({ ...policy, access })} />
      <button className="primary" disabled={!policy.targetId || !policy.accountId} onClick={() => run(async () => { await put(`/api/resources/${resourceId}/policies`, policy); setPolicyOpen(false); })}>保存</button>
    </div>}
    {currentType === 'kanban' ? <div className="kanban-board">{kanbanField ? (kanbanField.options.options || ['未分组']).map(group => {
      const rows = records.filter(row => (row.values[kanbanField.id] || '未分组') === group);
      return <section key={group}><header><strong>{group}</strong><span>{rows.length}</span></header>{rows.map(row => <article key={row.id}><h4>{String((fields[0] && row.values[fields[0].id]) || `记录 #${records.indexOf(row) + 1}`)}</h4>{fields.filter(field => field.id !== kanbanField.id && field.id !== fields[0]?.id).slice(0, 3).map(field => <span key={field.id}>{field.name}：{String(row.values[field.id] ?? '—')}</span>)}</article>)}</section>;
    }) : <div className="table-empty">看板视图需要一个单选字段作为分组依据</div>}</div> : currentType === 'form' ? <div className="form-view"><h3>{active?.name || '表单视图'}</h3><p className="muted">提交后会新建一条记录。</p>{fields.filter(field => !computedTypes.has(field.type) && field.access === 'editor' || field.access === 'owner' || field.access === 'manager').map(field => <label key={field.id}>{field.name}{field.type === 'select' ? <Select label={field.name} value={formValues[field.id] || ''} placeholder="请选择" options={(field.options.options || []).map(value => ({ value, label: value }))} onChange={value => setFormValues(values => ({ ...values, [field.id]: value }))} /> : <input type={field.type === 'number' || field.type === 'currency' || field.type === 'percent' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={formValues[field.id] || ''} onChange={event => setFormValues(values => ({ ...values, [field.id]: event.target.value }))} />}</label>)}<button className="primary" disabled={!canEdit} onClick={() => run(submitForm)}>提交表单</button></div> : <div className="grid-scroll"><table>
      <thead><tr><th className="row-number">#</th>{fields.map(field => <th key={field.id}>{field.name}<span className="field-type">{fieldTypeLabels[field.type] || '文本'}</span>{canManage && <button className="delete-field" title={`删除字段 ${field.name}`} onClick={() => setDeleteField(field)}><Trash2 size={12} /></button>}</th>)}<th /></tr></thead>
      <tbody>{records.map((row, index) => <tr key={row.id}><td className="row-number">{index + 1}</td>{fields.map(field => {
        const disabled = !canEdit || computedTypes.has(field.type) || field.access === 'viewer' || row.access === 'viewer';
        return <td key={field.id}>{field.type === 'select' || field.type === 'multiselect' ? <Select className="cell-select" label={`${field.name}，第 ${index + 1} 行`} disabled={disabled} value={row.values[field.id] || ''} placeholder="未选择" options={(field.options.options || []).map(option => ({ value: option, label: option }))} onChange={value => change(row, field, value)} /> : <input type={field.type === 'checkbox' ? 'checkbox' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : ['number', 'currency', 'percent'].includes(field.type) ? 'number' : 'text'} checked={field.type === 'checkbox' ? Boolean(row.values[field.id]) : undefined} disabled={disabled} value={field.type === 'checkbox' ? undefined : row.values[field.id] ?? ''} onChange={event => change(row, field, ['number', 'currency', 'percent'].includes(field.type) ? Number(event.target.value) : field.type === 'checkbox' ? event.target.checked : event.target.value)} />}</td>;
      })}<td><button className="icon-button" title="删除记录" disabled={!canEdit || row.access === 'viewer'} onClick={() => run(() => del(`/api/resources/${resourceId}/records/${row.id}`))}><Trash2 size={14} /></button></td></tr>)}</tbody>
    </table>{!records.length && <div className="table-empty">还没有记录，点击「新建记录」开始</div>}</div>}
    {fieldDialog && <PromptDialog title="新建字段" description="字段类型决定记录中保存的数据格式；系统字段会自动生成。" placeholder="例如：负责人" onClose={() => setFieldDialog(false)} onSubmit={async name => { await post(`/api/resources/${resourceId}/fields`, { name, type: fieldType }); setFieldDialog(false); await load(); }}><div className="dialog-extra"><span>字段类型</span><Select label="字段类型" value={fieldType} options={fieldTypeOptions} onChange={setFieldType} /></div></PromptDialog>}
    {viewDialog && <PromptDialog title="新建视图" placeholder="例如：任务看板" onClose={() => setViewDialog(false)} onSubmit={async name => { await post(`/api/resources/${resourceId}/views`, { name, type: viewType, configuration: {} }); setViewDialog(false); await load(); }}><div className="dialog-extra"><span>视图类型</span><Select label="视图类型" value={viewType} options={[{ value: 'grid', label: '表格视图' }, { value: 'kanban', label: '看板视图' }, { value: 'form', label: '表单视图' }]} onChange={setViewType} /></div></PromptDialog>}
    {deleteField && <ConfirmDialog title="删除字段" description={<>确定删除字段「{deleteField.name}」吗？此操作会移除该字段及其权限设置。</>} confirmText="删除字段" danger onClose={() => setDeleteField(null)} onConfirm={async () => { await del(`/api/resources/${resourceId}/fields/${deleteField.id}`); setDeleteField(null); await load(); }} />}
  </div>;
}
