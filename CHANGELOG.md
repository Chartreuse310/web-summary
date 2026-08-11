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
- 标签编辑功能从弹窗迁移到阅读页右栏
- 删除操作从弹窗内按钮迁移到阅读页头部
- 新增 ESC 键关闭阅读页
- 移除已废弃的 `#detailModal` 弹窗结构及关联的 `closeModal()`、`renderModalTags()` 函数

### 技术说明

- 仅改动前端（`public/app.js`、`public/style.css`、`public/index.html`），后端无需改动
- 后端 `extract.js` 的 `sanitizeHtml()` 已对全文 HTML 做白名单过滤，前端直接 `innerHTML` 渲染安全
- 后端 `sanitizeHtml()` 已为 H 标签添加 id，前端 TOC 锚点跳转基于此 id
