import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, List, ListOrdered, Quote, Code, Highlighter, Link2, Table2, Undo2, Redo2, Check, Cloud } from 'lucide-react';
import type { Account } from '../api';
import { PromptDialog } from './Dialogs';

export default function DocumentEditor({ resourceId, account, canEdit }: { resourceId: string; account: Account; canEdit: boolean }) {
  const [status, setStatus] = useState('连接中');
  const [linkOpen, setLinkOpen] = useState(false);
  const doc = useMemo(() => new Y.Doc(), [resourceId]);
  const provider = useMemo(() => new WebsocketProvider(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, `documents/${resourceId}`, doc), [doc, resourceId]);
  const editor = useEditor({
    editable: canEdit,
    extensions: [StarterKit.configure({ history: false }), Underline, Highlight, Link.configure({ openOnClick: false }), Placeholder.configure({ placeholder: '输入 / 唤起更多可能，从这里开始书写…' }), Table.configure({ resizable: true }), TableRow, TableCell, TableHeader, TaskList, TaskItem.configure({ nested: true }), Collaboration.configure({ document: doc }), CollaborationCursor.configure({ provider, user: { name: account.displayName, color: '#7c6cf2' } })],
    editorProps: { attributes: { class: 'prose', spellcheck: 'true' } },
  }, [doc, provider, canEdit]);
  useEffect(() => { provider.on('status', ({ status }: any) => setStatus(status === 'connected' ? '已自动保存' : '连接中')); return () => { provider.disconnect(); provider.destroy(); doc.destroy(); }; }, [provider, doc]);
  if (!editor) return <div className="editor-loading">正在准备编辑器…</div>;
  const tools = [
    { icon: Bold, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold'), title: '粗体' },
    { icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic'), title: '斜体' },
    { icon: UnderlineIcon, action: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive('underline'), title: '下划线' },
    { icon: Strikethrough, action: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike'), title: '删除线' },
    { icon: Highlighter, action: () => editor.chain().focus().toggleHighlight().run(), active: editor.isActive('highlight'), title: '高亮' },
  ];
  return <div className="document-editor"><div className="editor-toolbar"><div className="tool-group">{tools.map(({ icon: Icon, action, active, title }) => <button key={title} onClick={action} className={active ? 'active' : ''} title={title} disabled={!canEdit}><Icon size={17} /></button>)}</div><span className="toolbar-divider" /><button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? 'active' : ''} title="一级标题"><Heading1 size={19} /></button><button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="二级标题"><Heading2 size={19} /></button><button onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表"><List size={18} /></button><button onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序列表"><ListOrdered size={18} /></button><button onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用"><Quote size={17} /></button><button onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="代码块"><Code size={17} /></button><button onClick={() => setLinkOpen(true)} title="链接"><Link2 size={17} /></button><button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="插入表格"><Table2 size={17} /></button><div className="toolbar-right"><button onClick={() => editor.chain().focus().undo().run()} title="撤销"><Undo2 size={17} /></button><button onClick={() => editor.chain().focus().redo().run()} title="重做"><Redo2 size={17} /></button></div></div><div className="document-paper"><EditorContent editor={editor} /></div><div className="save-status">{status === '已自动保存' ? <Check size={13} /> : <Cloud size={13} />}{status}<span> · </span><span className="online-dot" /> 在线协同</div>{linkOpen && <PromptDialog title="插入链接" description="支持 http://、https:// 和 mailto: 链接。" placeholder="https://example.com" confirmText="插入链接" onClose={() => setLinkOpen(false)} onSubmit={url => {
      if (!/^(https?:\/\/|mailto:)/i.test(url)) throw new Error('请输入有效的 http、https 或 mailto 链接');
      editor.chain().focus().setLink({ href: url }).run(); setLinkOpen(false);
    }} />}</div>;
}
