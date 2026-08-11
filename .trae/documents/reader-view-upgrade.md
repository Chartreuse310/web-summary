# 文章详情升级为三栏阅读视图 — 实现计划

## 概述

将剪藏库的文章详情从弹窗升级为全屏三栏阅读视图：左栏显示文章目录，中栏渲染格式化全文，右栏展示一句话总结、摘要、标签、模型用量等元信息。后端已完整支持全文存储与清洗，本次仅改动前端。

## 当前状态分析

### 已具备的条件（无需改动）

| 组件 | 状态 | 说明 |
|------|------|------|
| `src/extract.js` | ✅ 已就绪 | `extractContent()` 返回 `contentHtml`（白名单清洗的安全HTML，H标签已加id）+ `contentText` |
| `src/db.js` | ✅ 已就绪 | 表有 `content_text`/`content_html` 列，含幂等迁移；`rowToObj` 已映射字段 |
| `src/router/clippings.js` | ✅ 已就绪 | POST/GET 已处理 `contentText`/`contentHtml` |
| `server.js` | ✅ 已就绪 | `/api/summarize` 已返回 `contentText`/`contentHtml` |
| `public/index.html` | ⚠️ 部分就绪 | 已有 `#readerView` 三栏结构（hidden），但从未被 JS 使用 |

### 需要修复的问题

| 问题 | 严重度 | 位置 |
|------|--------|------|
| `handleSave()` 未传 `contentText`/`contentHtml`，导致保存的剪藏无全文 | BUG | `app.js` 第 270-288 行 |
| `openDetail()` 打开弹窗而非阅读视图 | 需重写 | `app.js` 第 380-426 行 |
| 阅读视图无 CSS 样式 | 缺失 | `style.css` |
| 阅读视图无 JS 驱动逻辑 | 缺失 | `app.js` |
| 旧剪藏无 `contentHtml`（保存时未传） | 需降级处理 | `app.js` 渲染逻辑 |

## 变更文件清单

| 文件 | 变更类型 | 内容 |
|------|----------|------|
| `public/app.js` | 修改 | 修复 BUG + 重写 openDetail + 新增 reader 函数 + 更新事件绑定 |
| `public/style.css` | 修改 | 新增 `.reader` 系列样式（三栏布局 + 文章排版 + 响应式） |
| `public/index.html` | 修改 | 移除废弃的 `#detailModal` 弹窗结构 |
| `CHANGELOG.md` | 新建 | 记录本次变更（含日期、修改建议、实现计划） |

## 具体变更

### 1. `public/app.js` — 修复 handleSave BUG

**位置**：`handleSave()` 函数（约第 263-298 行）

**问题**：POST body 中缺少 `contentText` 和 `contentHtml`，导致保存的剪藏没有全文数据。`state.currentResult` 已包含这两个字段（来自 `/api/summarize` 响应），只是未传递。

**修改**：在 `body: JSON.stringify({...})` 中 `cost` 字段后追加：

```javascript
cost: u.priced ? u.totalCost : 0,
contentText: d.contentText,   // 新增
contentHtml: d.contentHtml     // 新增
```

### 2. `public/app.js` — 新增 state 字段

在全局 `state` 对象中追加 `currentReaderClipping: null`，供标签编辑函数持有当前剪藏引用。

### 3. `public/app.js` — 重写 openDetail 函数（核心）

**位置**：替换原 `openDetail(id)` 函数（约第 380-426 行）

**逻辑**：
1. 调用 `GET /api/clippings/:id` 获取剪藏数据
2. 隐藏 `.container`（主页面），显示 `#readerView`（阅读页）
3. 填充头部：标题、元信息（平台/作者/发布时间/收藏时间）、显示删除按钮
4. 调用 `renderReaderArticle(d)` 渲染中栏全文
5. 调用 `buildReaderToc(d)` 构建左栏目录（依赖中栏 DOM 已渲染）
6. 填充右栏：一句话总结、摘要、标签（可编辑）、模型用量、原文链接
7. 存储 clippingId 到 `#readerView.dataset` 供删除使用
8. 滚动到顶部

### 4. `public/app.js` — 新增 renderReaderArticle 函数

**降级策略**：
- 有 `contentHtml` → 直接 `innerHTML` 渲染（后端已白名单清洗，安全）
- 无 `contentHtml` 但有 `contentText` → 显示纯文本 + 降级提示
- 两者都无 → 显示"未保留全文"提示

**安全说明**：`contentHtml` 经后端 `sanitizeHtml()` 白名单过滤（标签/属性/事件属性均已清理），前端可直接 `innerHTML` 渲染。降级路径的 `contentText` 用 `escapeHtml` 转义。

### 5. `public/app.js` — 新增 buildReaderToc 函数

**TOC 生成策略**：
1. 优先从中栏 DOM 的 H1-H4 标签构建可点击 TOC → 点击 `scrollIntoView({ behavior: 'smooth' })` 平滑滚动
2. DOM 无足够标题但 `outline` 字段有数据 → 降级为静态目录（不可点击，仅参考）
3. 两者都无 → 隐藏左栏

**id 去重**：后端为 H 标签生成的 id 可能重复，前端通过 `usedIds` Set 去重，对重复 id 追加序号。

### 6. `public/app.js` — 新增 renderReaderTags 函数

从原 `renderModalTags` 迁移，逻辑一致（增删标签即时 PUT 到后端），容器改为 `#readerTags`。

### 7. `public/app.js` — 新增 closeReader 和 handleReaderDelete 函数

- `closeReader()`：隐藏阅读页，显示主页面，清空中栏 DOM
- `handleReaderDelete()`：确认后 DELETE 剪藏，关闭阅读页，刷新列表

### 8. `public/app.js` — 更新 initEvents

- 移除：`modalClose` 和 `detailModal` backdrop 的点击绑定
- 新增：`readerBack` 点击 → `closeReader`；`readerDelete` 点击 → `handleReaderDelete`
- 新增：ESC 键监听 → 阅读页打开时关闭

### 9. `public/app.js` — 移除废弃函数

移除 `renderModalTags()` 和 `closeModal()`（已被 reader 版本替代）。

### 10. `public/style.css` — 新增阅读页样式

在文件末尾追加完整的 `.reader` 系列样式：

- **布局**：`position: fixed` 全屏，`display: grid` 三栏（220px / 1fr / 280px）
- **顶部栏**：sticky 定位，含返回按钮、标题、元信息
- **左栏**：sticky 跟随滚动，TOC 链接有 hover 高亮 + 层级缩进
- **中栏**：白底卡片，完整富文本排版（H1-H4 / p / img / blockquote / pre-code / table / ul-ol / hr）
- **右栏**：sticky 跟随滚动，各 info-block 独立卡片
- **响应式三档**：`>1100px` 三栏 / `769-1100px` 两栏+信息下移 / `<=768px` 单栏堆叠

### 11. `public/index.html` — 移除废弃弹窗

移除 `#detailModal` 整段（第 255-262 行），保留 `#providerModal`（服务商配置弹窗，仍在使用）。

### 12. 新建 `CHANGELOG.md`

在项目根目录新建，记录本次变更（含日期、变更类型、技术说明）。

## 实现顺序

```
1. 修复 handleSave BUG（无依赖）
2. 新增 reader 函数（renderReaderArticle / buildReaderToc / renderReaderTags / closeReader / handleReaderDelete）
3. 重写 openDetail（依赖步骤 2）
4. 更新 initEvents（依赖 closeReader / handleReaderDelete）
5. 移除废弃函数（依赖步骤 3-4 无引用）
6. 添加 reader CSS（与 JS 并行）
7. 清理 HTML（无依赖）
8. 新建 CHANGELOG.md
```

## 假设与决策

1. **阅读视图完全替代弹窗**：不再保留 `#detailModal`，点击剪藏直接进入全屏阅读页
2. **标签编辑迁移到右栏**：保持原有增删即时保存的交互
3. **TOC 优先用 DOM 标题**：比 `outline` 字段更可靠（后端 outline 提取有 fallback 逻辑，但 DOM 是最终渲染结果）
4. **旧剪藏降级展示**：无 `contentHtml` 时显示纯文本 + 提示，不自动重新抓取（避免无 API Key 时失败）
5. **`contentHtml` 直接 innerHTML 渲染**：安全性依赖后端 `sanitizeHtml()` 白名单，已验证其处理了标签/属性/事件属性

## 验证步骤

1. 保存新剪藏 → 确认数据库 `content_html`/`content_text` 列有值
2. 点击剪藏条目 → 确认进入三栏阅读视图
3. 点击左栏目录项 → 确认中栏平滑滚动到对应标题
4. 右栏添加/删除标签 → 确认即时保存
5. 点击"返回剪藏库" → 确认回到列表
6. 按 ESC → 确认关闭阅读页
7. 点击删除 → 确认剪藏删除并返回列表
8. 打开无 `contentHtml` 的旧剪藏 → 确认显示纯文本 + 降级提示
9. 打开无 H 标签的文章 → 确认左栏降级为静态目录或隐藏
10. 缩小窗口至 1100px / 768px 以下 → 确认布局正确降级
11. 确认全文中图片自适应、代码块深色背景、表格有边框、引用块有左侧色条
