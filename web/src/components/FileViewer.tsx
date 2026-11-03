import { useEffect, useState } from 'react';
import { Download, FileBox, ExternalLink, UploadCloud } from 'lucide-react';
import type { Resource } from '../api';

export default function FileViewer({ resource }: { resource: Resource }) {
  const isOffice = resource.type.startsWith('office');
  return <div className="file-viewer"><div className="file-illustration"><FileBox size={58} strokeWidth={1.2} /></div><h3>{resource.name}</h3><p>{isOffice ? 'Office 原始文件已安全保存' : '此文件作为附件保存在你的空间中'}</p><a className="primary download-button" href={`/api/files/${resource.fileId}`}><Download size={17} /> 下载文件</a>{isOffice && <div className="office-notice">在服务端配置 OnlyOffice 后，可直接在线编辑 DOCX / XLSX。<br />当前可下载到本地编辑，重新上传会生成新的资源。</div>}</div>;
}
