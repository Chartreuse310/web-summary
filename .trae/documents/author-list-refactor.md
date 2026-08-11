# 重构计划：作者字段从单字符串改为 JSON 数组（统计时拆分）

## 摘要

将 `author` 字段从单一 `TEXT` 字符串改为 JSON 字符串数组存储，使一篇文章可关联多个作者。统计（`byAuthor`）时展开数组，每个作者独立计数，并补充 token/费用维度。同步增强网页抓取时的作者提取逻辑（多 meta 收集 + JSON-LD 解析 + 分隔符拆分），并对历史数据做幂等迁移。

参照现有 `tags` / `outline` 两个 JSON 列表字段的成熟模式实现，保持代码风格一致。

## 当前状态分析

- **数据库**（[src/db.js](file:///Users/z/Programs/web-summary/src/db.js)）：第 31 行 `author TEXT` 单字符串列；`rowToObj` 第 88 行直接返回 `row.author`；`insertClipping` 第 135 行 `author: d.author || null`；`updateClipping` 第 207 行**不支持 author**；`getStats` 第 281-286 行 `GROUP BY author` 整串聚合，只统计篇数。
- **抓取**（[src/extract.js](file:///Users/z/Programs/web-summary/src/extract.js)）：第 45-51 行用 `||` 短路链取单个 meta 作者，忽略多作者场景。
- **路由**（[src/router/clippings.js](file:///Users/z/Programs/web-summary/src/router/clippings.js)）：PUT 第 86-92 行白名单不含 author。
- **前端**（[public/app.js](file:///Users/z/Programs/web-summary/public/app.js)）：7 处把 author 当字符串渲染（第 184、380、519-522、556、1066、1161 行）。
- **已有参照**：`tags`（第 37 行注释 `JSON 字符串数组`、第 141 行 `JSON.stringify(d.tags || [])`、第 94 行 `safeParse(row.tags, [])`、第 289-302 行 JS 层聚合统计）；`outline` 同模式。

## 假设与决策

1. **存储格式**：`author` 列存 JSON 数组字符串（如 `'["张三","李四"]'`、`'[]'` 表示空），与 `tags`/`outline` 一致。无需新建列，复用现有 `author TEXT`。
2. **历史数据迁移**：幂等。对非 null 且非合法 JSON 数组的旧值，按分隔符 `[,，、;；&]` 及 ` and / 和 / 与 ` 拆分、trim、去空，存为 JSON 数组。已是数组的跳过。
3. **统计拆分语义**：一篇文章有 N 个作者时，每个作者各计 +1 篇、各累计该文 full token/cost（即"共同署名各享全文"，非按比例分摊）。空作者归入 `'未知'`。与 `topTags` 的 JS 层聚合风格一致。
4. **搜索**：`author LIKE @q` 保持不变——对 JSON 字符串做子串匹配，效果等同按作者名模糊搜索（与 `tags LIKE` 同策略，个人库量级够用）。
5. **提取增强范围**：多 meta 标签收集 + JSON-LD `author` 解析 + 单值分隔符拆分。不处理 `@graph` 以外的极复杂嵌套。
6. **统计新增字段不破坏前端**：`byAuthor` 增加 `totalTokens`/`totalCost`，但 `renderDist`（第 1164 行）是通用渲染、按传入的 `valKey` 取值，`loadStats` 第 1161 行仍传 `'count'`，无需改动。

## 改动清单

### 1. src/db.js — 数据库层

**1a. 注释更新（第 31 行）**
```js
author            TEXT,        -- JSON 字符串数组
```

**1b. 新增 migration 块（插入第 66 行之后，`content_html` 迁移块之后）**

幂等：用 `safeParse`（函数声明，已提升可用）判断旧值是否已是数组。
```js
// ===== 幻移：author 从单字符串迁移为 JSON 数组（幂等，可反复重启）=====
{
  const rows = db.prepare("SELECT id, author FROM clippings WHERE author IS NOT NULL").all();
  const upd = db.prepare("UPDATE clippings SET author = ? WHERE id = ?");
  for (const r of rows) {
    const parsed = safeParse(r.author, null);
    if (Array.isArray(parsed)) continue; // 已是 JSON 数组，跳过
    // 旧单字符串：按常见分隔符拆分
    const parts = (r.author || '').split(/[,，、;；&]|\s+and\s+|\s+和\s+|\s+与\s+/i);
    const arr = parts.map((p) => p.trim()).filter(Boolean);
    upd.run(JSON.stringify(arr), r.id);
  }
}
```

**1c. rowToObj 读取（第 88 行）**
```js
author: safeParse(row.author, []),
```

**1d. insertClipping 写入（第 135 行）**
```js
author: JSON.stringify(d.author || []),
```

**1e. updateClipping 支持 author（第 207 行参数解构 + 第 237 行 outline 分支后新增分支）**

参数解构加入 `author`：
```js
function updateClipping(id, { title, summary, oneliner, tags, author, contentHtml, contentText, outline } = {}) {
```
在 `outline` 分支后、`if (sets.length === 0)` 之前加入：
```js
  if (author !== undefined) {
    sets.push('author = @author');
    params.author = JSON.stringify(author);
  }
```
同步更新第 205 行注释，把 `author` 加入支持字段列表。

**1f. getStats byAuthor 改为 JS 层展开聚合（替换第 280-286 行）**

替换原 `GROUP BY author` SQL 查询为 JS 聚合（与第 289-302 行 `topTags` 同风格），展开数组并补充 token/费用：
```js
  // 按作者分布（从 JSON 数组展开，每个作者独立计数 + 累计 token/费用）
  const allAuthorRows = db.prepare('SELECT author, total_tokens, cost FROM clippings').all();
  const authorStat = {};
  for (const row of allAuthorRows) {
    const arr = safeParse(row.author, []);
    const names = Array.isArray(arr) && arr.length
      ? arr.map((a) => (typeof a === 'string' ? a.trim() : '')).filter(Boolean)
      : [];
    const keys = names.length ? names : ['未知'];
    for (const k of keys) {
      if (!authorStat[k]) authorStat[k] = { count: 0, totalTokens: 0, totalCost: 0 };
      authorStat[k].count += 1;
      authorStat[k].totalTokens += row.total_tokens || 0;
      authorStat[k].totalCost += row.cost || 0;
    }
  }
  const byAuthor = Object.entries(authorStat)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([author, v]) => ({ author, count: v.count, totalTokens: v.totalTokens, totalCost: v.totalCost }));
```

### 2. src/extract.js — 抓取提取增强

**2a. 新增两个 helper 函数（放在 `extractMetadata` 之前，第 34 行注释块之后）**
```js
/** 按常见分隔符拆分作者名并加入 set（去重） */
function splitAuthors(raw, set) {
  const parts = raw.split(/[,，、;；&]|\s+and\s+|\s+和\s+|\s+与\s+/i);
  for (const p of parts) {
    const name = p.trim();
    if (name) set.add(name);
  }
}

/** 递归收集 JSON-LD 中的 author 字段（支持 @graph 嵌套） */
function collectJsonLdAuthors(data, set) {
  if (!data) return;
  const arr = Array.isArray(data) ? data : [data];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    if (item.author) {
      const authors = Array.isArray(item.author) ? item.author : [item.author];
      for (const a of authors) {
        const name = typeof a === 'string' ? a : a?.name;
        if (name) splitAuthors(String(name), set);
      }
    }
    if (item['@graph']) collectJsonLdAuthors(item['@graph'], set);
  }
}
```

**2b. 替换 extractMetadata 中作者提取逻辑（第 44-51 行）**

把单 `||` 链替换为多源收集：
```js
  // 作者（多源合并 + 分隔符拆分，返回去重数组）
  const authorSet = new Set();
  // 1. 收集所有 author 相关 meta 标签（article:author 可能有多个）
  document.querySelectorAll(
    'meta[property="article:author"], meta[name="article:author"], ' +
    'meta[property="og:article:author"], meta[name="author"], meta[name="twitter:creator"]'
  ).forEach((el) => {
    const v = el.getAttribute('content')?.trim();
    if (v) splitAuthors(v, authorSet);
  });
  // 2. JSON-LD 结构化数据（最可靠的多作者来源）
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      collectJsonLdAuthors(JSON.parse(s.textContent || ''), authorSet);
    } catch { /* 忽略非法 JSON-LD */ }
  });
  const author = [...authorSet];
```

第 77 行 `return { author, platform, publishedAt };` 无需改（author 现已是数组）。第 261 行 `author: meta.author` 透传，无需改。

### 3. src/router/clippings.js — PUT 白名单

**3a. 第 92 行后新增 author 白名单分支**
```js
    if (body.author !== undefined) payload.author = body.author;
```
**3b. 第 6 行注释** 把 author 加入 PUT 支持字段列表。

### 4. public/app.js — 前端渲染（数组 join）

**4a. 第 184 行**（renderResult 摘要结果卡片）
```js
    if (d.author && d.author.length) metaParts.push(`作者：${d.author.join('、')}`);
```

**4b. 第 380 行**（renderLibrary 列表项 meta）
```js
          it.author && it.author.length && escapeHtml(it.author.join('、')),
```

**4c. 第 556 行**（openDetail 阅读页文章信息）
```js
      d.author && d.author.length && escapeHtml('作者：' + d.author.join('、')),
```

**4d. 第 1066 行**（renderHomeRecent 首页最近剪藏）
```js
          it.author && it.author.length && escapeHtml(it.author.join('、')),
```

> 第 519-522 行（作者排行渲染）与第 1161 行（loadStats renderDist）**无需改动**：byAuthor 统计结果中 `author` 仍是单个名字字符串，`renderDist` 通用取 `r.author`。

### 5. CHANGELOG.md — 更新日志

在 `## 2026-08-11` 下新增一个 section（插入在第 16 行「用量趋势改柱状图」之后、第 17 行「重构：全宽布局」之前）：

```markdown
### 重构：作者字段改为列表，统计时拆分

将 `author` 从单字符串改为 JSON 数组存储，一篇文章可关联多个作者；统计时按作者展开独立计数。

- **多作者提取**：抓取网页时用 `querySelectorAll` 收集所有 `article:author`/`author` meta 标签、解析 JSON-LD `author` 数组、对含分隔符（逗号/顿号/分号/`&`/和/与/and）的值拆分，去重后存为数组
- **统计拆分**：`byAuthor` 由 `GROUP BY author` 整串聚合改为 JS 层展开数组聚合（与 `topTags` 同风格），每个作者独立计数；空作者归入「未知」；新增 `totalTokens`/`totalCost` 维度，共同署名各享全文 token/费用
- **历史数据迁移**：启动时幂等迁移旧单字符串——按分隔符拆分为数组，已是数组的跳过
- **编辑支持**：`updateClipping` 与 PUT 路由白名单加入 `author`，可在编辑页修改作者
- **前端适配**：列表/详情/首页/摘要结果 4 处作者展示改为 `join('、')`；作者排行与统计页 `renderDist` 通用渲染无需改动
- **搜索不变**：`author LIKE @q` 对 JSON 字符串子串匹配，效果等同按作者名模糊搜索（与 `tags LIKE` 同策略）
```

## 验证步骤

1. **启动无报错**：`node server.js` 启动，migration 块幂等执行，无 SQL 错误。
2. **迁移正确性**：检查 `data/clippings.db`——旧 `author` 值如 `"张三, 李四"` 应变为 `'["张三","李四"]'`；单值 `"张三"` 变为 `'["张三"]'`；`NULL` 保持 `NULL`。重启后再次执行不重复迁移。
3. **新抓取多作者**：抓取一个有多作者的页面（如部分新闻/博客），确认 `author` 存为数组、前端展示为 `作者：张三、李四`。
4. **统计拆分**：`GET /api/stats` 的 `byAuthor` 每项含 `{author, count, totalTokens, totalCost}`；多作者文章的每个作者各计 +1。
5. **前端展示**：摘要结果卡、剪藏库列表、阅读页、首页最近剪藏 4 处作者正确显示为顿号分隔；作者排行点击仍能触发搜索。
6. **编辑作者**：PUT `/api/clippings/:id` 传 `author: ["新作者"]` 能更新成功。
7. **搜索**：搜索框输入作者名仍能命中该作者的文章。
