# Together Docs

面向个人、朋友和小团队的私有化协作文档平台。当前仓库是可运行的 **基础协作版**，并非飞书或腾讯文档的完整复刻。

## 已实现

- 站长初始化、封闭邀请注册、会话登录
- 个人空间、项目空间、文件夹、移动、重命名、回收站与恢复
- 文档成员、马甲、项目/文档角色的统一服务端鉴权
- 原生文档：Tiptap + Yjs 实时协同、常用格式、自动快照、命名版本
- 原生表格：单工作表基础数据保存；CSV 转换接口预留
- 智能表格：文本、数字、货币、百分比、单选/多选、日期、复选框、系统字段等；表格/看板/表单视图；CSV 导入导出；服务端行级、字段级权限过滤
- 评论、评论显示名快照、解决状态、评论角色鉴权
- 收藏、最近访问、站内通知、收到的申请
- 分享链接：项目/文档申请范围、默认角色、密码、有效期、最大使用次数、启停、重复申请拦截、审批结果通知
- DOCX/XLSX：BetterOffice React + Rust/WASM 原生 OOXML 在线编辑、Yrs 实时协同、保存到文件对象与历史版本
- DOCX/XLSX/附件上传与授权下载、SHA-256 去重存储；不运行独立 Document Server
- 注册式文档类型驱动接口，新增 PDF/PPTX 等类型无需改动权限、分享和存储模块
- SQLite WAL、本地文件存储与 S3 兼容存储接口
- 审计日志及核心操作记录
- 完整站点管理控制台：总览、文档／资源、回收站、用户账号、项目空间、注册邀请、分享链接、评论、站点配置、数据与文件、运行状态、登录会话、操作审计
- 站长可直接创建账号、禁用/启用、重置密码、授予站长、强制退出会话与协同连接
- 资源接管：重命名、移动空间、转移所有权、内容摘要、成员管理、批量回收站/恢复/永久删除
- 站点配置存数据库并即时生效：注册开关、会话天数、上传大小、回收站保留、历史版本上限、分享默认值与匿名查看
- 数据库一致性备份（VACUUM INTO）、下载、恢复与数据表行数查看；过期会话、孤立数据、孤立 blob 等清理任务
- 运行状态：进程、SQLite、存储、HTTP 请求统计、Yjs/Yrs 协同房间与在线连接，可强制断连
- 全站使用自定义下拉和站内对话框，无原生 `<select>` / `prompt` / `confirm` / `alert`

## 尚未完成（下一轮）

- 用 BetterOffice XLSX 引擎统一替换基础原生表格编辑器
- BetterOffice Yrs relay 的长期 checkpoint、离线重连和跨实例扩展
- BetterOffice 内置评论/修订与平台评论、马甲模型的统一
- DOCX/XLSX 到原生格式的有损转换 UI
- 文档图片/附件上传与编辑器内嵌
- 段落锚点评论、@提及自动补全、富文本颜色及字体设置
- 智能表格关联记录、查找引用、公式字段、日历/画廊/甘特视图、实时协同推送
- 全文搜索、模板、用户组、账号配额界面、邮件/Webhook、Caddy 的正式配置样例及端到端浏览器自动化测试

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

## Office 文件策略

DOCX/XLSX 使用 BetterOffice 0.5.1 的 React/Rust-WASM 编辑器，在浏览器内直接读写 OOXML；无需 OnlyOffice Document Server、Collabora 或其他独立文档服务。

- 浏览器从应用授权接口加载原始文件字节。
- 每个资源使用独立的 `/ws/office/:id` 房间，由应用内 relay 转发 Yrs 同步帧。
- 服务端在每条写帧前重新验证编辑权限；浏览者不能写入协同房间。
- 编辑器的 `save()` 导出新文件字节，写入本地/S3 存储，并把保存前原文件保留为历史版本。
- relay 帧日志有大小上限，只用于在线状态追赶；长期内容以保存后的 Office 文件为准。
- BetterOffice Worker 和 WASM 由 Vite 以 ES module worker 格式输出；生产环境必须允许同源 `worker-src 'self'`。
- 中文 DOCX 排版需要 `@betteroffice/fonts-cjk`，构建产物较大，建议对 `.wasm` 和字体启用 HTTP 压缩与强缓存。

当前仍是基础集成：WebSocket relay 为单实例内存实现，Yrs 帧日志不做 CRDT 合并或永久 checkpoint；跨实例部署需要先扩展共享 relay。

## Docker 部署

生成至少 32 字节的随机 `SESSION_SECRET`，并设置实际 `PUBLIC_URL`。生产环境应使用 HTTPS。

```powershell
docker compose up --build -d
```

应用数据保存在 Docker 卷 `app-data`。请同时备份 SQLite 和文件存储；建议把 BetterOffice 的 WASM/字体静态资源也纳入版本化缓存。

## 测试

```powershell
npm run typecheck
npm test
npm run build
```

## 项目结构

- `server/src/db`：SQLite 与 Drizzle 数据模型
- `server/src/routes`：账号、空间、资源、分享、智能表格、评论、文件、BetterOffice relay 与保存 API
- `server/src/modules`：权限、协同、通知、存储、文档类型驱动
- `web/src/components`：Tiptap、基础表格、智能表格、BetterOffice、分享、评论及工作台组件
- `1.md`：完整产品方案与迭代边界
