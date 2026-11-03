# Together Docs

面向个人、朋友和小团队的私有化协作文档平台。当前仓库是可运行的 **MVP 基础版**。

## 已实现

- 站长初始化、封闭邀请注册、会话登录
- 个人空间与项目空间，项目成员权限
- 原生文档：Tiptap + Yjs 实时协同、常用格式、自动快照
- 原生表格：基础单工作表数据保存
- 智能表格：文本、数字、单选等基础字段；行/字段级服务端权限过滤
- 文档成员、马甲存储、分享链接和项目/单文档权限申请审批
- DOCX/XLSX 和附件上传、授权下载
- SQLite WAL、本地文件存储与 S3 兼容存储接口
- 审计日志基础表及核心操作记录

## 尚未完成（后续迭代）

- Univer 公式、多工作表、图表及 Yjs 表格协同
- OnlyOffice 会话、JWT 回调和版本写入；当前上传的 Office 文件仅可下载
- DOCX/XLSX 到原生格式的有损转换
- 智能表格看板、表单、关联、公式与实时协同推送
- 回收站界面、完整历史版本界面、通知、全文搜索、文件夹
- 完整站点管理和备份恢复工具

## 本地启动

要求 Node.js 22.12+。

```powershell
npm install
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3000
- 首次打开时创建的第一个账号是站长。

当前开发目录如果没有全局 Node.js，可使用已下载的便携运行时：

```powershell
$env:Path = "D:\code\.tools\node-v22.16.0-win-x64;$env:Path"
npm run dev
```

## Docker 部署

复制 `.env.example` 为 `.env`，生成至少 32 字节的随机 `SESSION_SECRET`，并设置实际 `PUBLIC_URL`。生产环境应使用 HTTPS。

```powershell
docker compose up --build -d
```

应用数据保存在 Docker 卷 `app-data`。请同时备份 SQLite 和文件存储。OnlyOffice 目前仅为部署预留，不应视为已接入。

## 测试

```powershell
npm run typecheck
npm test
npm run build
```

## 项目结构

- `server/src/db`：SQLite 与 Drizzle 数据模型
- `server/src/routes`：账号、空间、资源、分享、智能表格、文件 API
- `server/src/modules`：权限、协同和存储
- `web/src/components`：原生文档、表格、智能表格及分享界面
- `1.md`：完整产品方案与迭代边界
