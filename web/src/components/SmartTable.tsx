import { useEffect, useState } from 'react';
import { LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { api, post, patch, del, put } from '../api';
import Select from './Select';
import { ConfirmDialog, PromptDialog } from './Dialogs';

type Field = { id: string; name: string; type: string; access: string; options: { options?: string[] } };
type RecordRow = { id: string; access: string; values: Record<string, any> };
type Member = { account: { id: string; username: string; displayName: string } };
const roleOptions = [{ value: 'hidden', label: '不可见' }, { value: 'viewer', label: '只读' }, { value: 'editor', label: '可编辑' }];

export default function SmartTable({ resourceId, canEdit, canManage }: { resourceId: string; canEdit: boolean; canManage: boolean }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policy, setPolicy] = useState({ kind: 'row', targetId: '', accountId: '', access: 'viewer' });
  const [fieldDialog, setFieldDialog] = useState(false);
  const [fieldType, setFieldType] = useState('text');
  const [deleteField, setDeleteField] = useState<Field | null>(null);

  async function load() {
    try {
      const data = await api<{ fields: Field[]; records: RecordRow[] }>(`/api/resources/${resourceId}/table`);
      setFields(data.fields); setRecords(data.records); setError('');
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
  const targetOptions = policy.kind === 'row'
    ? records.map(row => ({ value: row.id, label: `记录 #${records.indexOf(row) + 1}` }))
    : fields.map(field => ({ value: field.id, label: field.name }));

  if (loading) return <div className="editor-loading">正在加载数据…</div>;
  return <div className="smart-table">
    <div className="table-tabs">
      <button className="active">表格视图</button>
      <button onClick={() => run(() => post(`/api/resources/${resourceId}/records`, {}))} disabled={!canEdit}><Plus size={16} /> 新建记录</button>
      <button onClick={() => setFieldDialog(true)} disabled={!canManage}><Plus size={16} /> 新建字段</button>
      <button onClick={() => setPolicyOpen(!policyOpen)} disabled={!canManage}><LockKeyhole size={15} /> 行列权限</button>
    </div>
    {error && <div className="form-error">{error}</div>}
    {policyOpen && <div className="policy-panel">
      <Select label="权限类型" value={policy.kind} options={[{ value: 'row', label: '行权限' }, { value: 'field', label: '字段权限' }]} onChange={kind => setPolicy({ ...policy, kind, targetId: '' })} />
      <Select label="权限目标" value={policy.targetId} options={targetOptions} placeholder="选择目标" onChange={targetId => setPolicy({ ...policy, targetId })} />
      <Select label="被授权成员" value={policy.accountId} options={members.map(({ account }) => ({ value: account.id, label: `${account.displayName} (@${account.username})` }))} placeholder="选择成员" onChange={accountId => setPolicy({ ...policy, accountId })} />
      <Select label="访问级别" value={policy.access} options={roleOptions} onChange={access => setPolicy({ ...policy, access })} />
      <button className="primary" disabled={!policy.targetId || !policy.accountId} onClick={() => run(async () => { await put(`/api/resources/${resourceId}/policies`, policy); setPolicyOpen(false); })}>保存</button>
    </div>}
    <div className="grid-scroll"><table>
      <thead><tr><th className="row-number">#</th>{fields.map(field => <th key={field.id}>{field.name}<span className="field-type">{{ select: '单选', multiselect: '多选', number: '数字', checkbox: '复选', date: '日期' }[field.type] || '文本'}</span>{canManage && <button className="delete-field" title={`删除字段 ${field.name}`} onClick={() => setDeleteField(field)}><Trash2 size={12} /></button>}</th>)}<th /></tr></thead>
      <tbody>{records.map((row, index) => <tr key={row.id}><td className="row-number">{index + 1}</td>{fields.map(field => {
        const disabled = !canEdit || field.access === 'viewer' || row.access === 'viewer';
        return <td key={field.id}>{field.type === 'select'
          ? <Select className="cell-select" label={`${field.name}，第 ${index + 1} 行`} disabled={disabled} value={row.values[field.id] || ''} placeholder="未选择" options={(field.options.options || []).map(option => ({ value: option, label: option }))} onChange={value => change(row, field, value)} />
          : <input type={field.type === 'number' ? 'number' : field.type === 'checkbox' ? 'checkbox' : field.type === 'date' ? 'date' : 'text'} checked={field.type === 'checkbox' ? Boolean(row.values[field.id]) : undefined} disabled={disabled} value={field.type === 'checkbox' ? undefined : row.values[field.id] ?? ''} onChange={event => change(row, field, field.type === 'number' ? Number(event.target.value) : field.type === 'checkbox' ? event.target.checked : event.target.value)} />}</td>;
      })}<td><button className="icon-button" title="删除记录" disabled={!canEdit || row.access === 'viewer'} onClick={() => run(() => del(`/api/resources/${resourceId}/records/${row.id}`))}><Trash2 size={14} /></button></td></tr>)}</tbody>
    </table>{!records.length && <div className="table-empty">还没有记录，点击「新建记录」开始</div>}</div>
    {fieldDialog && <PromptDialog title="新建字段" placeholder="例如：负责人" onClose={() => setFieldDialog(false)} onSubmit={async name => {
      await post(`/api/resources/${resourceId}/fields`, { name, type: fieldType });
      setFieldDialog(false); await load();
    }} />}
    {deleteField && <ConfirmDialog title="删除字段" description={<>确定删除字段「{deleteField.name}」吗？此操作会移除该字段及其权限设置。</>} confirmText="删除字段" danger onClose={() => setDeleteField(null)} onConfirm={async () => {
      await del(`/api/resources/${resourceId}/fields/${deleteField.id}`); setDeleteField(null); await load();
    }} />}
  </div>;
}
