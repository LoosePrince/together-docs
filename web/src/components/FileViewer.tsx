import { Download, FileBox } from 'lucide-react';
import type { Resource } from '../api';

export default function FileViewer({ resource }: { resource: Resource }) {
  return <div className="file-viewer"><div className="office-fallback"><div className="file-illustration"><FileBox size={58} strokeWidth={1.2} /></div><h3>{resource.name}</h3><p>此文件作为附件保存在你的空间中</p><a className="primary download-button" href={`/api/files/${resource.fileId}`}><Download size={17} /> 下载文件</a><div className="office-notice">此类型暂不支持在线编辑；DOCX、XLSX 使用 BetterOffice 引擎打开。</div></div></div>;
}
