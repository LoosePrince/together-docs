import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocxEditor } from '@betteroffice/docx-react';
import { CollaborationProvider } from '@betteroffice/docx/collaboration';
import { XlsxEditor } from '@betteroffice/xlsx-react';
import { CollaborationProvider as XlsxCollaborationProvider } from '@betteroffice/xlsx/collaboration';
import '@betteroffice/docx-react/styles.css';
import type { Resource } from '../api';
import { OfficeStatusBar, saveOfficeBytes, useBetterOfficeCollaboration } from './officeCollaboration';

export default function BetterOfficeEditor({ resource, canEdit, canSave, accountName }: { resource: Resource; canEdit: boolean; canSave: boolean; accountName: string }) {
  const [file, setFile] = useState<ArrayBuffer | null>(null);
  const [fileKey, setFileKey] = useState(resource.fileId || '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const docxRef = useRef<any>(null);
  const xlsxApi = useRef<any>(null);
  const format = resource.type === 'office_document' ? 'docx' : 'xlsx';
  const Provider = format === 'docx' ? CollaborationProvider : XlsxCollaborationProvider;
  const { collaboration, status } = useBetterOfficeCollaboration(resource.id, format, accountName, Provider);
  useEffect(() => {
    let cancelled = false;
    if (!resource.fileId) { setError('原文件不存在'); return; }
    setFileKey(resource.fileId);
    fetch(`/api/files/${resource.fileId}`, { credentials: 'include' })
      .then(response => { if (!response.ok) throw new Error('无法加载 Office 文件'); return response.arrayBuffer(); })
      .then(bytes => { if (!cancelled) { setFile(bytes); setError(''); } })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [resource.fileId]);
  const save = useCallback(async () => {
    try {
      const bytes = format === 'docx' ? await docxRef.current?.save?.() : await xlsxApi.current?.save?.();
      if (!bytes) throw new Error('编辑器尚未就绪');
      const result = await saveOfficeBytes(resource.id, bytes);
      setFileKey(result.fileId);
      setMessage('已保存到空间'); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [format, resource.id]);
  const handleError = useCallback((e: Error) => setError(e.message), []);
  const onSaveRequest = useCallback(() => { void save(); return false; }, [save]);
  const onXlsxReady = useCallback((api: any) => {
    xlsxApi.current = api;
    return () => { xlsxApi.current = null; };
  }, []);
  const onXlsxChange = useCallback(() => setMessage('有未保存的更改'), []);
  const onSave = canSave ? save : undefined;
  const xlsxBytes = useMemo(() => file ? new Uint8Array(file) : null, [file]);
  if (error && !file) return <div className="editor-loading">{error}</div>;
  if (!file) return <div className="editor-loading">正在加载 BetterOffice 引擎与文档…</div>;
  const shared = { collaboration, onError: handleError, downloadOnSave: false, onSaveRequest, style: { height: '100%', minHeight: 0 } } as any;
  return <div className="betteroffice-editor">
    {format === 'docx'
      ? <DocxEditor key={`${resource.id}:${fileKey}`} ref={docxRef} documentBuffer={file} fileName={resource.name} mode={canEdit ? 'editing' : 'viewing'} readOnly={!canEdit} author={accountName} {...shared} />
      : xlsxBytes && <XlsxEditor key={`${resource.id}:${fileKey}`} file={xlsxBytes} fileName={resource.name} readOnly={!canEdit} onReady={onXlsxReady} onChange={onXlsxChange} {...shared} />}
    <OfficeStatusBar status={status} onSave={onSave} />
    {error && <div className="office-error">{error}</div>}{message && <div className="office-saved">{message}</div>}
  </div>;
}
