import { useEffect, useState } from 'react';
import { api, post } from '../api';

export default function Spreadsheet({ resourceId, canEdit }: { resourceId: string; canEdit: boolean }) {
  const [cells, setCells] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [loaded, setLoaded] = useState(false);
  const letters = Array.from({ length: 10 }, (_, i) => String.fromCharCode(65 + i));
  useEffect(() => { api<{ cells: Record<string, string> }>(`/api/resources/${resourceId}/spreadsheet`).then(data => { setCells(data.cells); setLoaded(true); }); }, [resourceId]);
  return <div className="spreadsheet"><div className="table-tabs"><button className="active">Sheet1</button><span className="muted spreadsheet-note">轻量数据编辑</span><button disabled={!canEdit || !loaded || saving} onClick={async () => { setSaving(true); try { await post(`/api/resources/${resourceId}/spreadsheet`, { cells }); } finally { setSaving(false); } }}>保存</button></div><div className="grid-scroll"><table><thead><tr><th className="row-number" />{letters.map(l => <th key={l}>{l}</th>)}</tr></thead><tbody>{Array.from({ length: 30 }, (_, r) => <tr key={r}><td className="row-number">{r + 1}</td>{letters.map(l => { const key = `${l}${r + 1}`; return <td key={key}><input aria-label={key} value={cells[key] || ''} disabled={!canEdit} onChange={e => setCells(c => ({ ...c, [key]: e.target.value }))} /></td>; })}</tr>)}</tbody></table></div><div className="sheet-status">{saving ? '保存中…' : '基础版：单工作表数据保存。公式、多工作表与 XLSX 编辑请使用 Office 文件'}</div></div>;
}
