# 正文/摘要/目录编辑功能 — 实现计划

## 概述

在阅读页三栏视图基础上新增"编辑模式"。点击"编辑"按钮后，中栏正文、右栏一句话总结和摘要变为 `contentEditable` 可编辑状态，顶部出现格式工具栏（H1/H2/H3/H4/正文）。用户可将光标所在段落转换为不同等级标题。保存时收集五个字段 PUT 到后端，后端对 `contentHtml` 重新执行 `sanitizeHtml` 白名单清洗后落库。

## 当前状态分析

### 后端

| 组件 | 状态 | 说明 |
|------|------|------|
| `src/db.js` `updateClipping` | 需扩展 | 只支持 `title/summary/oneliner/tags`，不支持 `contentHtml/contentText/outline` |
| `src/router/clippings.js` PUT 路由 | 需重写 | 直接透传 `req.body`，无白名单字段过滤、无 contentHtml 重新清洗 |
| `src/extract.js` `sanitizeHtml` | ✅ 可复用 | 已导出，接受 `(raw, baseUrl)`，白名单过滤标签/属性 |

### 前端

| 组件 | 状态 | 说明 |
|------|------|------|
| 阅读页正文 | 只读 | `article.innerHTML = d.contentHtml`，无 contentEditable |
| 一句话总结 | 只读 | `readerOneliner.textContent = d.oneliner` |
| 摘要 | 只读 | `readerSummary.textContent = d.summary` |
| 标签 | ✅ 已可编辑 | `renderReaderTags` 增删即时 PUT |
| TOC | 自动构建 | `buildReaderToc` 从 DOM H1-H4 构建，可点击滚动 |

### 数据库

表已有 `content_html`/`content_text`/`outline` 三列（建表 SQL + 幂等迁移），无需新增迁移。

## 变更文件清单

| 文件 | 变更类型 | 内容 |
|------|----------|------|
| `src/db.js` | 修改 | `updateClipping` 扩展 `contentHtml`/`contentText`/`outline` 三个字段 |
| `src/router/clippings.js` | 修改 | PUT 路由引入 `sanitizeHtml`，显式白名单字段 + contentHtml 重新清洗 |
| `public/index.html` | 修改 | 阅读页 header 新增编辑/保存/取消按钮 + 格式工具栏 |
| `public/app.js` | 修改 | 新增 6 个编辑函数 + 更新 initEvents/closeReader/ESC |
| `public/style.css` | 修改 | 工具栏样式 + contentEditable 编辑态视觉反馈 |
| `CHANGELOG.md` | 修改 | 记录本次变更 |

## 具体变更

### 1. `src/db.js` — 扩展 `updateClipping`

**位置**：第 199-221 行

函数签名从 `{ title, summary, oneliner, tags }` 扩展为 `{ title, summary, oneliner, tags, contentHtml, contentText, outline }`，在 `tags` 处理块之后追加：

```javascript
if (contentHtml !== undefined) {
  sets.push('content_html = @contentHtml');
  params.contentHtml = contentHtml;
}
if (contentText !== undefined) {
  sets.push('content_text = @contentText');
  params.contentText = contentText;
}
if (outline !== undefined) {
  sets.push('outline = @outline');
  params.outline = JSON.stringify(outline);
}
```

三个字段均为可选（`!== undefined`），不影响现有 tags-only PUT 调用。`outline` 需 `JSON.stringify`（与 `tags` 一致）。

### 2. `src/router/clippings.js` — PUT 路由重写

**位置**：第 75-84 行

1. 文件顶部引入 `const { sanitizeHtml } = require('../extract');`
2. PUT 路由改为显式白名单字段构建 payload：
   - 纯文本字段（title/summary/oneliner/tags/contentText/outline）直接透传
   - `contentHtml` 必须经 `sanitizeHtml(body.contentHtml, existing.url)` 重新清洗
   - `existing.url` 作为 baseUrl（剪藏自身 URL，编辑场景下内容已清洗过，URL 均为绝对地址，re-sanitize 幂等安全）

### 3. `public/index.html` — 阅读页 header 扩展

**位置**：第 213-219 行

- `readerTitle` 旁新增按钮组 `.reader-title-actions`：编辑(`readerEdit`)、保存(`readerSave`, hidden)、取消(`readerCancel`, hidden)、删除(`readerDelete`)
- header 底部新增格式工具栏 `#readerToolbar`（hidden），含 H1/H2/H3/H4/正文 五个 `.fmt-btn` 按钮（`data-block` 属性）+ 提示文字

### 4. `public/app.js` — 新增 state 字段

`state` 追加 `isEditing: false` 和 `editSnapshot: null`（编辑前原始数据快照）。

### 5. `public/app.js` — `enterEditMode()` 函数

1. 快照原始数据（contentHtml/oneliner/summary/onelinerBlockHidden）到 `state.editSnapshot`
2. 旧剪藏降级处理：如果当前是纯文本降级显示，将纯文本按空行分段包装为 `<p>` 变为可编辑富文本
3. `article.contentEditable = true`，添加 `.editing` class
4. 一句话总结、摘要设为 `contentEditable = true`，添加 `.editing` class
5. 一句话总结 block 强制显示（即使为空）
6. 设置 `data-placeholder` 属性（配合 CSS 空内容占位）
7. 切换按钮：隐藏编辑/删除，显示保存/取消/工具栏
8. 聚焦到正文

### 6. `public/app.js` — `exitEditMode()` 函数

移除所有 contentEditable，移除 `.editing` class 和 `data-placeholder`，切换按钮恢复，清空 `state.editSnapshot`。

### 7. `public/app.js` — `handleHeadingFormat(tag)` 函数

调用 `document.execCommand('formatBlock', false, tag)` 将光标所在块级元素转换为目标标签。转换后立即调用 `buildReaderToc` 重建目录。

**焦点保持**：工具栏按钮用 `mousedown` + `e.preventDefault()` 绑定（非 `click`），防止按钮获取焦点导致 article 内选区丢失。

### 8. `public/app.js` — `extractOutlineFromDom()` 函数

从中栏 DOM 的 H1-H4 提取 `[{level, text}]` 数组，与后端 `extractOutline` 逻辑一致（跳过超 80 字标题、`level|text` 去重）。供保存时发送到后端。

### 9. `public/app.js` — `handleReaderSave()` 函数

1. 收集 payload：`contentHtml`(article.innerHTML)、`contentText`(article.textContent.trim())、`oneliner`、`summary`、`outline`(extractOutlineFromDom)
2. PUT 到 `/api/clippings/:id`
3. 用后端返回值更新 `state.currentReaderClipping`（含 re-sanitized contentHtml）
4. 退出编辑模式
5. 重新渲染正文（`renderReaderArticle`）+ 重建目录（`buildReaderToc`）
6. 更新一句话总结/摘要显示
7. 调用 `loadLibrary()` 刷新列表

### 10. `public/app.js` — `handleReaderCancel()` 函数

从 `state.editSnapshot` 恢复原始数据：重新渲染正文、恢复一句话总结/摘要文本和可见性、重建目录、退出编辑模式。

### 11. `public/app.js` — 更新 initEvents

追加编辑相关事件绑定：
- `readerEdit` click → `enterEditMode`
- `readerSave` click → `handleReaderSave`
- `readerCancel` click → `handleReaderCancel`
- `.fmt-btn` mousedown(+preventDefault) → `handleHeadingFormat(btn.dataset.block)`

### 12. `public/app.js` — 更新 closeReader 和 ESC

- `closeReader()`：开头加 `if (state.isEditing) exitEditMode()`
- ESC 监听：编辑模式下触发 `handleReaderCancel`，非编辑模式触发 `closeReader`

### 13. `public/style.css` — 编辑模式样式

- `.reader-title-actions`：flex 按钮组
- `.reader-toolbar`：primary-light 背景工具栏，含 `.fmt-btn` 按钮样式
- `.reader-article.editing`：蓝色边框 + 3px primary-light 光环
- `.oneliner-box.editing` / `.reader-summary.editing`：2px outline 聚焦反馈
- `[contenteditable="true"]:empty::before`：空内容占位文字（配合 `data-placeholder`）
- 响应式 768px 以下：工具栏按钮组换行

## 假设与决策

1. **使用 contentEditable + execCommand**：虽已废弃但 Chrome/Edge/Firefox 均可靠支持，个人工具够用，不引入编辑器库
2. **编辑模式为 toggle**：点击"编辑"进入，"保存"或"取消"退出，避免误操作
3. **后端 re-sanitize contentHtml**：contentEditable 可能产生非白名单标签/属性，后端 `sanitizeHtml` 是安全防线
4. **保存后用后端返回值重新渲染**：确保前端 DOM 与 re-sanitized 数据库一致
5. **旧剪藏编辑时升级**：无 contentHtml 的旧剪藏进入编辑模式时，纯文本包装为 `<p>` 段落，保存后即拥有 contentHtml
6. **编辑模式下隐藏删除按钮**：防止编辑中误删
7. **ESC 键分层**：编辑模式下 ESC = 取消编辑，非编辑模式 ESC = 关闭阅读页

## 验证步骤

1. 打开有 contentHtml 的剪藏 → 确认"编辑"按钮可见
2. 点击"编辑" → 确认工具栏出现、正文/一句话总结/摘要出现蓝色边框
3. 光标置于段落 → 点击"H2" → 确认变为 h2 样式、左栏 TOC 新增条目
4. 光标置于标题 → 点击"正文" → 确认变回 p、TOC 条目消失
5. 修改一句话总结和摘要 → 点击"保存" → 确认保存成功、退出编辑模式
6. 刷新重新打开 → 确认编辑后内容已持久化
7. 编辑后点击"取消" → 确认内容恢复到编辑前状态
8. 编辑模式下按 ESC → 确认触发取消编辑
9. 非编辑模式下按 ESC → 确认关闭阅读页
10. 打开无 contentHtml 的旧剪藏 → 点击"编辑" → 确认纯文本变为可编辑 `<p>` 段落
11. 在 DevTools 中注入 `<script>` → 保存 → 重新打开 → 确认被 sanitizeHtml 过滤
12. 缩小窗口至 768px 以下 → 确认工具栏按钮组正确换行
