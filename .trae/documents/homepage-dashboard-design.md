# 首页仪表盘设计计划

## 概述

在现有 4-Tab 应用（生成摘要 / 剪藏库 / 统计 / 设置）中新增「首页」Tab 作为第一位、默认激活的着陆页。首页为编辑知识库风仪表盘，复用已建立的视觉令牌（暖纸底 `#fafaf8` + 森林绿 `#2d5a3d` + 衬线正文），包含五个区块：三宫格统计卡片、智能聚合的「一句话总结近期在看」、最近剪藏三条、GitHub 风格贡献热力图、快捷入口按钮。

零新依赖、零构建工具、零 LLM 调用（一句话总结采用纯前端智能聚合，已与用户确认）。

## 现状分析

- 前端为原生 HTML/CSS/JS，Tab 通过 `switchTab(name)` 切换 `.tab` / `.tab-panel`，切到 library/stats/settings 时触发对应 `loadX`。
- 视觉令牌与组件类已就位：`.stats-summary`（上下重边框三宫格）、`.stat-big`、`.oneliner-box`（暖棕衬线引述）、`.clip-item`（编号+进度条）、`.section-label`、`.btn-secondary`、`.empty-hint`。
- `GET /api/stats` 返回 `{count, totalTokens, totalCost, byModel, byPlatform, topTags}`，但 `topTags` 仅前 20 且无去重标签总数。
- `GET /api/stats/trend?days=365` 已支持，返回 `[{date, tokens, cost, count}]`（仅含有数据的天），满足热力图全年需求。
- `GET /api/clippings?sort=recent&limit=N` 已支持，含 title/oneliner/tags/savedAt 等字段。
- 服务端 `substr(saved_at,1,10)` 取的是 UTC 日期，前端热力图需用 UTC 对齐。

## 拟定变更

### 1. `src/db.js` — 新增 `distinctTags` 字段

在 `getStats()` 的返回对象中追加 `distinctTags: Object.keys(tagCount).length`。该函数内部已构建完整的 `tagCount` 频次对象，零额外 SQL、零迁移成本。供首页「标签量」卡片使用。纯加法字段，统计页不读取该字段，向后兼容。

### 2. `src/router/stats.js` — 无需改动

`/api/stats` 直接 `res.json(getStats())`，新增的 `distinctTags` 会自动随响应返回。`/api/stats/trend?days=365` 已支持（`Math.min(Math.max(...||30,1),365)`）。

### 3. `public/index.html` — 新增首页 Tab 与 Panel

- 在 `<nav class="tabs">` 最前面插入 `<button class="tab active" data-tab="home">首页</button>`，并去掉 summarize tab 的 `active`。
- 在 `#panel-summarize` 之前插入 `<section class="tab-panel active" id="panel-home">`，去掉 `#panel-summarize` 的 `active`。

首页 Panel 按以下 section 顺序组织（ID 统一 `home*` 前缀，避免与统计页 `bigCount` 等冲突）：

1. 三宫格统计卡片：复用 `.stats-summary` + `.stat-big`，三个分别为条目数 `#homeCount`、标签量 `#homeTags`、Token 消耗 `#homeTokens`。
2. 一句话总结近期在看：`.section-label` + `.oneliner-box#homeOneliner`（暖棕衬线引述，默认文案「加载中…」）。
3. 最近剪藏三条：`.section-label` + `#homeRecent.library-list`（复用 `.clip-item` 简化结构，默认 `.empty-hint`）。
4. 贡献热力图：外包 `.card`，内含 `.section-label` + `.heatmap-wrap#homeHeatmapWrap > .heatmap#homeHeatmap` + `.heatmap-legend`（5 格色阶图例）。
5. 快捷入口：`.section-label` + `.home-actions`（三个 `.btn-secondary` 带 `data-go="summarize|library|stats"`）。

5 个 tab 在 760px 与 375px 下均不溢出（现有 `.tab{flex:1}` + 窄屏 `font-size:12px` 兜底）。

### 4. `public/style.css` — 追加热力图与快捷入口样式

追加到文件末尾（其余全部复用现有类）：

```css
/* 首页：贡献热力图 */
.heatmap-wrap {
  overflow-x: auto;
  padding: 4px 2px 8px;
  -webkit-overflow-scrolling: touch;
}
.heatmap {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  grid-auto-flow: column;
  grid-auto-columns: 11px;
  gap: 2px;
  width: max-content;
}
.heat-cell { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.heat-L0 { background: var(--rule-light); }
.heat-L1 { background: rgba(45, 90, 61, 0.25); }
.heat-L2 { background: rgba(45, 90, 61, 0.50); }
.heat-L3 { background: rgba(45, 90, 61, 0.75); }
.heat-L4 { background: var(--forest); }
.heat-cell.today { box-shadow: 0 0 0 1.5px var(--rule-heavy); }
.heatmap-legend {
  display: flex; align-items: center; gap: 4px;
  margin-top: 10px; font-size: 11px; color: var(--ink-4);
}
.heatmap-legend .heat-cell { width: 11px; height: 11px; }

/* 首页：快捷入口 */
.home-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.home-actions .btn-secondary { flex: 1; min-width: 92px; text-align: center; }
```

设计要点：`grid-auto-flow:column` + `grid-template-rows:repeat(7,...)` 是无库热力图标准做法，cell 按日追加即自动按周成列；色阶用 `--forest` 的 rgba 递进与主色同源，L0 复用 `--rule-light` 与分隔线一致；`width:max-content` + 外层 `overflow-x:auto` 保证窄屏横向滚动而非压缩 cell（保留 hover/tooltip 命中）。

### 5. `public/app.js` — 四处改动

**5.1 `switchTab` 追加 home 分支**：在现有 library/stats/settings 分支前加 `if (name === 'home') loadHome();`。

**5.2 新增 `loadHome()`**：并行请求三组数据（`Promise.all`），延迟取最慢者：
- `GET /api/stats` → 汇总数字（含 distinctTags）
- `GET /api/stats/trend?days=365` → 热力图 + 近 7 天篇数
- `GET /api/clippings?sort=recent&limit=20` → 最近剪藏（取前 3 展示）+ 近 7 天标签聚合（样本足够，避免二次请求）

任一失败则在 `#homeOneliner` 显示「数据加载失败，请稍后重试。」。成功则依次调用 `renderHomeStats / renderHomeOneliner / renderHomeRecent / renderHeatmap`。

`renderHomeStats`：`#homeCount`=`fmtNum(stats.count)`、`#homeTags`=`fmtNum(stats.distinctTags ?? 0)`、`#homeTokens`=`fmtNum(stats.totalTokens)`。

**5.3 智能聚合文案 `renderHomeOneliner(trend, recentItems)`**（零 LLM）：
- 近 7 天篇数 `n7`：从 `trend` 取最近 7 天 `count` 求和（权威，避免 20 条样本在活跃周截断）。
- 近 7 天标签：从 `recentItems` 筛 `savedAt` 落在近 7 天的条目，聚合 `tags` 频次取前 3。
- 文案分支：
  - `n7 === 0` → 「最近一周还没有新的收藏。去「生成摘要」捕捉下一篇值得留存的内容吧。」
  - 有标签 → 「近 7 天收藏了 N 篇，主要围绕「标签1」、「标签2」等主题。」+ 若 `tok7>0` 追加「累计消耗约 X tokens。」
  - 有收藏无标签 → 「近 7 天收藏了 N 篇，尚未添加标签。」
- 文案用 `textContent` 赋值（非 innerHTML），天然防注入。

**5.4 热力图 `renderHeatmap(trend)`**：
- 用 `map[date] = d` 索引趋势数据；`maxCount = Math.max(1, ...counts)`。
- 以 UTC 构造日期 key（`toISOString().slice(0,10)`），匹配服务端 `substr(saved_at,1,10)`（UTC），避免本地时区 ±1 天错位。
- 起点：`today-364 天` 所在周的周日（GitHub 惯例 Sun-start）；遍历到今日。
- 分级：`level = c===0 ? 0 : Math.min(4, Math.ceil(c / Math.ceil(maxCount/4)))`，按 max 等分 4 带，自适应稀疏/活跃用户。
- 每个 cell：`<span class="heat-cell heat-L{level}{today? ' today':''}" title="YYYY-MM-DD：N 篇">`，原生 `title` tooltip（零 JS、可访问、移动端长按可见）。
- 今日 cell 加 `.today` 描边锚点。
- 全空用户：`maxCount=1`，所有 cell L0，不报错。

**5.5 启动序列与入口按钮**：
- 启动处追加 `loadHome();`（首页为默认 active）。
- `initEvents()` 中绑定 `[data-go]` 按钮：`click → switchTab(dataset.go)`。`switchTab` 已内置 library/stats 数据加载触发，故入口按钮实现极薄；切 summarize 仅切面板（输入页无需预载）。

## 假设与决策

- **一句话总结用智能聚合**（已与用户确认）：零成本、即时、无需配置服务商，无网络额外开销。后续可再加 AI 深度总结按钮。
- **首页为新增默认 Tab**（第一位、默认 active）：符合「打开即见全局」的使用逻辑。
- **热力图取近 365 天**：GitHub 全年贡献图风格最经典耐看；移动端横向滚动而非缩放（缩放破坏 hover/tooltip 命中）。
- **`/api/clippings?limit=20` 一次取 20 条**：既供「最近剪藏三条」展示，又供「一句话总结」近 7 天标签聚合，避免二次请求。
- **复用现有视觉令牌与组件类**：不引入新色/新依赖，首页与全局风格一致。
- **UTC 日期对齐**：服务端 `substr(saved_at,1,10)` 取 UTC 日期，前端用 UTC 构造 key 已对齐；若未来 saved_at 改存本地时间格式需同步调整。

## 验证步骤

1. 默认着陆：清缓存打开应用 → 首页 tab 激活、首页 panel 可见，其余 panel 隐藏。
2. 三宫格数字：首页「条目数」= 统计页「剪藏总数」；「Token 消耗」= 统计页「累计 Token」；「标签量」= 去重标签总数（标签多于 20 时应 ≥ 20）。
3. 一句话总结：有近 7 天数据 → 文案含正确篇数与标签名；删除近 7 天剪藏 → 空态引导文案；有剪藏无标签 → 「尚未添加标签」分支；Network 面板无 `/api/summarize` 调用。
4. 最近剪藏：显示最新 3 条，点击任一条 → 进入阅读页（`openDetail`），返回后仍在首页。
5. 热力图：总 cell 数 ≈ 371（53 周 × 7）且末列含今日；有数据天着色、无数据天为 `--rule-light`；hover 显示日期与篇数；今日 cell 有描边；缩窗至 375px → 横向可滚动、cell 不被压缩。
6. 入口按钮：点「生成摘要」→ 切输入页；点「剪藏库」→ 列表已加载；点「统计」→ 数字/趋势图已渲染。
7. 回归：统计页、剪藏库、设置页、阅读页、编辑模式功能不受影响（仅 db.js 加法字段、app.js 加法函数，未改动既有逻辑）。
8. 浏览器 Console 无 JS 报错。

## 风险与边界

- **`distinctTags` 依赖 `tagCount` 已构建**：若未来重构 `getStats` 移除 `tagCount` 中间变量，需同步保留 distinctTags 计算——加注释提示即可。
- **热力图分级在极 skewed 数据下**：若某天 count 远超均值（如批量导入），其余活跃天会压成 L1。若实测不美观，可切换为「非零天的四分位数」阈值——当前等分-by-max 实现最简且对个人数据足够。
- **L1 色阶偏淡**：5 级 rgba 在某些显示器上 L1(0.25) 区分度可能不足，若实测不美观可提到 0.3，属微调。
