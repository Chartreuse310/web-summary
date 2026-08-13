# 高亮评论功能 实现计划

## 目标
阅读文章时选中文字即可加高亮（可附评论）；左栏可在大纲/高亮间切换查看本篇所有高亮；剪藏库与首页列表展示每篇高亮数。

## 数据模型（src/db.js）

新建 `highlights` 表（迁移块，幂等）：

```sql
CREATE TABLE IF NOT EXISTS highlights (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clipping_id INTEGER NOT NULL,
  exact_text  TEXT NOT NULL,   -- 选中的精确文本
  prefix      TEXT NOT NULL,   -- 选中前在文章 textContent 中的截断上下文（前 80 字符）
  suffix      TEXT NOT NULL,   -- 选中后上下文（前 80 字符）
  comment     TEXT,            -- 评论（可空）
  created_at  TEXT NOT NULL,   -- ISO
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (clipping_id) REFERENCES clippings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_highlights_clipping ON highlights(clipping_id);
```

**定位策略**：不存 XPath/偏移（脆弱）。前端在选中时计算 `prefix/suffix`（基于 `article.textContent` 的偏移），后端只存原文。还原时前端遍历文章文本节点，用 `prefix + exactText + suffix` 三段拼接做子串匹配定位 Range 并包裹 `<mark>`。匹配不到则跳过（容忍文章被编辑过）。

## DB 函数（src/db.js）

- `insertHighlight({ clippingId, exactText, prefix, suffix, comment })` → 返回新建对象
- `listHighlights(clippingId)` → `[{id, clippingId, exactText, prefix, suffix, comment, createdAt, updatedAt}]`，按 created_at 升序（与文中出现顺序一致）
- `updateHighlight(id, { comment })` → 更新评论
- `deleteHighlight(id)`
- `deleteHighlightsByClipping(clippingId)` — 删剪藏时级联（DB FK + WAL 一般开，但 better-sqlite3 默认未开 PRAGMA foreign_keys；显式调一次更稳）
- `getHighlightCounts(clippingIds)` → `Map<id, count>`，一次 `GROUP BY` 查询
- `listClippings` / `getClipping` 返回值增加 `highlightCount`（用子查询 `SELECT COUNT(*)`，列表量级个人库够用）
- `deleteClipping` 内追加 `deleteHighlightsByClipping` 调用

## 路由（新文件 src/router/highlights.js，挂载到 server.js）

```
POST   /api/clippings/:id/highlights    创建（body: exactText, prefix, suffix, comment?）
GET    /api/clippings/:id/highlights    列表
PUT    /api/highlights/:hid             更新评论（body: comment）
DELETE /api/highlights/:hid             删除单条
```

挂载：`app.use('/api', highlightsRouter)`（路径已在 router 内含 `/clippings/:id/highlights`）。

## 前端 HTML（public/index.html）

1. 左栏 `readerTocWrap` 改造：标题行加切换按钮组（目录 / 高亮）+ 高亮数 badge；下方两个容器 `#readerOutline`（原 `#readerToc`）与 `#readerHighlights`。
2. 新增浮动元素：`#hlToolbar`（选中时出现：高亮按钮）+ `#hlCommentPopover`（评论编辑浮窗：textarea + 保存/删除按钮）。挂在 body 末尾。
3. 剪藏列表项 `clip-stats` 处加高亮数 badge（有高亮才显示）。

## 前端逻辑（public/app.js）

- `state.currentReaderClipping` 增加 `highlights` 数组。
- `openDetail`：渲染正文后 → `GET /api/clippings/:id/highlights` → `applyHighlights()`（遍历文本节点匹配定位，包裹 `<mark data-hid>`）→ 渲染左栏高亮列表。
- `mouseup` 监听（仅非编辑模式 + 正文内选区）：选区非空时定位 `#hlToolbar` 到选区上方，点击「高亮」→ 计算 prefix/suffix → `POST` → 用返回对象 apply mark → 刷新左栏列表。
- `<mark>` 点击：打开 `#hlCommentPopover` 定位到 mark 处，加载现有评论；保存 → `PUT`；删除 → `DELETE` + 移除 mark + 刷新左栏。
- 左栏切换：点击「目录/高亮」按钮切两个容器显隐 + active 态。
- 左栏高亮项点击 → `scrollIntoView` + 闪动 mark。
- `loadLibrary`：已有 `/api/clippings` 返回带 `highlightCount`，渲染 badge；`renderHomeRecent` 同理。
- 编辑模式（enterEditMode）：进入前先把现有 `<mark>` 拆回纯文本（unwrap），保存后重新 `applyHighlights`（因为 contentHtml 已变，定位需重算）。退出/取消亦同。
- `closeReader`：清理浮动元素状态。

## 样式（public/style.css）

- `.reader-aside-switch`（按钮组）+ `.aside-switch-btn` + `.aside-switch-btn.active` + `.aside-switch-count`
- `mark.hl`（黄/暖底高亮，圆角，hover 出删除手柄）
- `#hlToolbar`（小气泡按钮，跟随选区）
- `#hlCommentPopover`（卡片，textarea + 按钮，绝对定位）
- `.hl-list-item`（左栏高亮项：文本截断 + 评论预览）
- `.clip-hl-count`（列表 badge，暖色小标签）

## i18n（public/i18n.js，zh + en 各加一组）

`reader.outline`、`reader.highlights`、`hl.add`、`hl.commentPlaceholder`、`hl.save`、`hl.delete`、`hl.deleteConfirm`、`hl.empty`、`hl.listItemComment`、`reader.highlightCount`（列表 badge 文案 "{n} 高亮"）。

## 不做（保持范围）
- 多颜色高亮（单一暖色，与全站编辑风一致）
- 跨设备同步（已落 DB，天然同步）
- 高亮搜索/导出

## 影响文件
1. `src/db.js` — 建表 + 函数 + 列表返回 highlightCount + 级联删除
2. `src/router/highlights.js` — 新增
3. `server.js` — 挂载 router
4. `public/index.html` — 左栏结构 + 浮动元素 + 列表 badge
5. `public/app.js` — 选区交互 + apply/remove + 左栏切换 + 列表 badge
6. `public/style.css` — 相关样式
7. `public/i18n.js` — 文案
