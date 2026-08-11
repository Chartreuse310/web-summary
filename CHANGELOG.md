# 更新日志

## 2026-08-11

### 新增：三栏阅读视图

将文章详情从弹窗升级为全屏三栏阅读视图，提升阅读体验。

- **左栏（目录）**：从全文 HTML 的 H1-H4 标题自动生成可点击目录，点击平滑滚动到对应标题；旧剪藏无 H 标签时降级为静态目录展示
- **中栏（全文）**：渲染后端清洗后的结构化全文 HTML（支持图片、代码块、表格、引用等富文本）；旧剪藏无 contentHtml 时降级为纯文本展示并显示提示
- **右栏（摘要信息）**：一句话总结、摘要、标签编辑、模型与用量、原文链接

### 修复

- `handleSave()` 保存时缺失 `contentText` 和 `contentHtml` 字段，导致已保存剪藏无法在阅读页显示全文（BUG 修复）

### 变更

- `openDetail(id)` 从打开弹窗改为打开全屏阅读视图
- 文章元信息（平台/作者/发布时间/收藏时间）从阅读页头部迁移到右栏顶部「文章信息」区块，显示在一句话总结前面，每项独立一行
- 标签编辑功能从弹窗迁移到阅读页右栏
- 删除操作从弹窗内按钮迁移到阅读页头部
- 新增 ESC 键关闭阅读页
- 移除已废弃的 `#detailModal` 弹窗结构及关联的 `closeModal()`、`renderModalTags()` 函数

### 技术说明

- 仅改动前端（`public/app.js`、`public/style.css`、`public/index.html`），后端无需改动
- 后端 `extract.js` 的 `sanitizeHtml()` 已对全文 HTML 做白名单过滤，前端直接 `innerHTML` 渲染安全
- 后端 `sanitizeHtml()` 已为 H 标签添加 id，前端 TOC 锚点跳转基于此 id

### 新增：正文与元信息编辑功能

在阅读页支持原地编辑正文、一句话总结、摘要，并可将段落转换为不同级别的标题。

- **正文编辑**：点击「编辑」按钮进入编辑模式，正文区域变为 `contentEditable`，可直接修改文字内容
- **一句话总结 / 摘要编辑**：编辑模式下右栏对应区域均可直接编辑
- **标题级别转换**：编辑模式下工具栏提供 H1/H2/H3/H4/正文 五个按钮，将光标置于段落中点击即可转换该段落的标题级别；转换后自动重建目录
- **旧剪藏兼容**：纯文本降级内容在进入编辑模式时自动包装为 `<p>` 段落，确保可编辑
- **保存与取消**：保存时收集 contentHtml/contentText/oneliner/summary/outline 一并 PUT 到后端；取消时从快照恢复原始内容
- **ESC 键智能处理**：编辑模式下 ESC 触发取消编辑，非编辑模式下 ESC 关闭阅读页

### 技术说明（编辑功能）

- **后端**：`updateClipping()` 扩展支持 `contentHtml`/`contentText`/`outline` 字段；PUT 路由对 `contentHtml` 强制重新 `sanitizeHtml()` 清洗（XSS 防线）
- **前端**：`document.execCommand('formatBlock')` 实现标题级别转换；`extractOutlineFromDom()` 从 DOM 提取大纲与后端逻辑一致
- **安全**：用户编辑后的 HTML 经后端 `sanitizeHtml()` 白名单过滤后才入库，前端展示时使用后端返回的清洗后版本
- **状态管理**：`state.isEditing` 标记编辑态，`state.editSnapshot` 保存原始数据快照供取消恢复
