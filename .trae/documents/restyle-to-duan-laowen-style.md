# 参考 duan.laowen.cc 风格优化网页剪藏库显示效果

## Summary

将「网页剪藏库」应用的视觉风格从当前的「冷灰底 + 蓝紫主色 + emoji 重的 SaaS 卡片风」原位重样式为参考站 `duan.laowen.cc` 的「暖纸底 + 森林绿主色 + 衬线正文的编辑知识库风」。**只改视觉，不改功能与 DOM 结构**。改动集中在 4 个前端文件：`public/style.css`、`public/index.html`、`public/app.js`、`public/chart.js`。不引入构建工具或新依赖，字体走 Google Fonts CDN。

## Current State Analysis

项目是一个 Node.js Web 应用（`server.js` + `public/` 静态前端），含 4 个 Tab（生成摘要 / 剪藏库 / 统计 / 设置）和一个全屏三栏阅读页 `reader`。

当前视觉特征（`public/style.css`）：
- 配色：冷灰底 `--bg:#f5f7fa`、白卡、蓝紫主色 `--primary:#4f6ef7`、灰阶文字 `#1a2233`→`#9aa3b5`。
- 字体：仅系统无衬线栈，无衬线正文。
- 组件：药丸式 Tab 分段控件、圆角 14px 卡片 + 较重阴影、emoji 承担分区视觉（`📚✨📊⚙️📑💡📝🏷️` 等）、黄橙渐变一句话总结框、普通条形分布图。

参考站真实设计令牌（已从其 Next.js CSS 抓取确认）：
- 配色：暖纸底 `--paper:#fafaf8` / `--paper-mid:#f5f3ef`；白卡 `--surface:#fff`；墨黑文字梯度 `--ink:#18181a` / `--ink-2:#2e2d2a` / `--ink-3:#525048` / `--ink-4:#8a8880` / `--ink-5:#b8b6b0`；森林绿主色 `--forest:#2d5a3d` / `--forest-2:#3d7050` / `--forest-light:#e8f2ec`；暖棕辅色 `--warm:#8b7355` / `--warm-light:#f5f0e8`；边框 `--rule-light:#e0ddd6` / `--rule-mid:#9a9890` / `--rule-heavy:#18181a`；红色强调 `#db3d43`。
- 字体：UI 无衬线 Inter；中文阅读 `"PingFang SC","Noto Sans SC"`；正文衬线 Lora + Noto Serif SC（line-height 1.9）；数字 `tabular-nums` 等宽。
- 关键组件：`eyebrow`（10px 大写小标题，letter-spacing .12em，weight 700，ink-4）；`stat-strip`（顶 2.5px 粗线 + 底 1px 细线，`stat-num` 森林绿衬线 26px weight 700，`stat-label` 11px ink-4）；`rank-row`（grid `22px/1fr/max-content`，底部 rule-light 分隔，`rank-bar` 绝对定位透明绿 `#2d5a3d13` 进度条，`rank-num` 10px ink-5 编号 01/02，`rank-name` 13px weight 500，`rank-count` 11px ink-4；hover bg `#2d5a3d0a`）。

## Proposed Changes

### 核心策略：令牌别名层 + 组件外科手术

1. **替换 `:root`**：以参考站令牌为新基底，同时保留旧变量名（`--primary/--bg/--card/--text/--border` 等）作为兼容别名指向新令牌，使 820 行 CSS 中所有 `var(--primary)` 等引用自动吸收新配色，无需逐行改写。
2. **组件级精修**：对参考站有明确规格的组件（stat-strip、rank-row、eyebrow、衬线正文、oneliner 暖棕框）做定向重写或新增类。
3. **去 emoji**：清理 `index.html` 静态文本与 `app.js` 动态字符串中的 emoji，层级改由 eyebrow 排版承担。
4. **结构不动**：不改任何 DOM 层级、id、data 属性、JS 逻辑；仅在必要处追加/替换 class 名与文本。

---

### 文件 1：`public/style.css`

**1.1 `:root` 令牌替换**（第 4–18 行）— 整体替换为新令牌 + 兼容别名 + 字体栈变量。新增 `--paper/--surface/--ink-*/--forest/--warm/--rule-*/--red`；旧名 `--bg→--paper`、`--card→--surface`、`--primary→--forest`、`--primary-hover→--forest-2`、`--primary-light→--forest-light`、`--text→--ink`、`--text-light→--ink-3`、`--text-lighter→--ink-4`、`--border→--rule-light`、`--error→--red`、`--success→--forest-2`；`--shadow` 改 `0 1px 3px rgba(24,24,26,.04)`、`--radius` 14→8；新增 `--font-ui`（Inter+中文无衬线）与 `--font-serif`（Lora+Noto Serif SC）。

**1.2 body**（第 20–27 行）— `font-family:var(--font-ui)`、`background:var(--paper)`、`color:var(--ink)`；新增 `-webkit-font-smoothing:antialiased` 与 `font-variant-numeric:tabular-nums`。

**1.3 Header**（第 36–38 行）— `.title` 26→28px、`letter-spacing:-.5px`、`color:var(--ink)`；`.subtitle` 改 `var(--ink-4)`、12px、`letter-spacing:.04em`。

**1.4 Tabs：药丸 → 下划线**（第 41–64 行）— `.tabs` 去 `background/padding/border-radius/box-shadow`，改 `border-bottom:1px solid var(--rule-light)`；`.tab` 去 `border-radius`，改 `border-bottom:2px solid transparent`；`.tab.active` 透明底 + `color:var(--forest)` + `font-weight:600` + `border-bottom-color:var(--forest)`；hover 非激活态 `color:var(--ink-2)`。

**1.5 输入/按钮/选择器**（第 84–134 行）— 圆角统一 10→6（`.url-input/.select/.btn-primary/.btn-secondary`）；`.btn-primary:disabled` `#b8c0d6`→`var(--ink-5)`；`.field-label` 改 `var(--ink-3)`、12px、`letter-spacing:.04em`。focus 光环由别名自动变森林绿。

**1.6 `.section-label` → eyebrow**（第 166–171 行）— 10px、weight 700、`var(--ink-4)`、`letter-spacing:.12em`、`text-transform:uppercase`。

**1.7 `.oneliner-box` → 暖棕衬线**（第 191–200 行）— `font-family:var(--font-serif)`、`color:var(--ink-2)`、`background:var(--warm-light)`、`border-left:3px solid var(--warm)`、圆角 8→4。

**1.8 tag-chip / cloud-tag 方角森林绿**（第 204–228、359–367 行）— `border-radius` 20→4；`.cloud-tag` 改 `background:var(--paper-mid)` + `border:1px solid var(--rule-light)`；hover `var(--forest-light)`/`var(--forest)`。

**1.9 `.clip-item` → rank-row 启发**（第 271–307 行）— 改 `display:grid;grid-template-columns:28px 1fr;gap:4px 12px`；圆角 12→8；hover 去 `translateY(-1px)`，改 `border-color:var(--rule-mid)`；新增 `.clip-rank`（10px ink-5 等宽）、`.clip-main`（min-width:0）、`.clip-usage-bar`（3px 轨道 rule-light）、`.clip-usage-fill`（森林绿）；`.clip-tag` 改纸色方角带边框；`.model-badge` 改 forest-light/forest 方角。

**1.10 `.stat-big` → stat-strip**（第 316–324 行）— 去 background/border/box-shadow/radius，改 `border-top:2.5px solid var(--rule-heavy)` + `border-bottom:1px solid var(--rule-light)` + `padding:14px 4px` + `text-align:left`；`.stat-value` 改 `font-family:var(--font-serif)`、26px、weight 700、`var(--forest)`、`tabular-nums`；`.stat-label` 11px `var(--ink-4)`。（`.stat-big` 在 `.card` 之后定义，同特异性后定义胜出，覆盖 `.card`。）

**1.11 `.stats-title` → eyebrow 变体**（第 335 行）— 11px、weight 700、`var(--ink-3)`、`letter-spacing:.08em`（不大写，因含中英混排）。

**1.12 分布行：删 dist-row，新增 rank-row**（替换第 351–356 行）— 删 `.dist-row/.dist-name/.dist-bar/.dist-bar-fill`；新增 `.rank-row`（grid `22px/1fr/max-content`、底 rule-light 分隔、hover `rgba(45,90,61,.04)`）、`.rank-bar`（绝对定位、`rgba(45,90,61,.07)`）、`.rank-num`（10px ink-5）、`.rank-name`（13px weight 500 ink-2、ellipsis）、`.rank-count`（11px ink-4）。

**1.13 spinner / error-card / btn-danger / usage-bar**（第 138–151、240–251、400–410 行）— `.spinner` 改 forest-light/forest；`.error-card` 改 `#fdf3f3` + `rgba(219,61,67,.3)`；`.btn-danger` 改 `#fdf3f3`/`var(--red)`；`.usage-bar` 改 `var(--paper-mid)`，`b` 改 `var(--ink)`。

**1.14 reader 区块**（第 497–731 行）— `.reader-header` 去 `box-shadow`；`.reader-aside-title` → eyebrow 规格；`.reader-article p` 改 `var(--font-serif)` + line-height 1.9；标题 H1-H4 保持 sans（编辑风 sans 标题 + 衬线正文对比）；`blockquote` 改 forest 左边线 + forest-light 底；`pre` 改 ink 深底；行内 code 改 paper-mid 底；`.reader-summary/.reader-plaintext/.result-summary` 加 `var(--font-serif)`；`.reader-fallback-notice` 改暖棕框。

**1.15 modal / 设置页**（第 370–481 行）— `.modal-backdrop` 改 `rgba(24,24,26,.4)`；`.modal-body` 加 rule-light 边框；`.provider-toggle.on` 由别名→forest-2（可显式 `var(--forest)`）。

**1.16 响应式清理**（第 484–491 行）— 删除已失效的 `.dist-name{width:100px}`；其余响应式规则保留。

---

### 文件 2：`public/index.html`

**2.1 `<head>` 引入字体**（第 7 行后）— 加 `<link rel="preconnect">`（googleapis/gstatic）+ 一条 `css2` 链接引入 Inter / Lora / Noto Serif SC / Noto Sans SC（`display=swap`）。

**2.2 去 emoji（纯文本，结构不变）** — 清理所有静态 emoji：标题 `📚`、4 个 Tab 的 `✨📚📊⚙️`、分区标签 `📑💡📝🏷️📈🤖🌐🔌📄`、保存按钮 `💾` 等（共约 21 处）。标签/属性/class 不动。

**2.3 不改 class/结构** — `stat-big`、`dist-list`、`clip-item` 等容器 class 保持不变（rank-row 由 JS 动态生成；stat-strip 由 CSS 原位重写 `.stat-big`）。

---

### 文件 3：`public/app.js`

**3.1 `renderDist`**（第 853–865 行）— 输出 `.rank-row` + `.rank-bar`（绝对定位进度条，width=pct%）+ `.rank-num`（`String(i+1).padStart(2,'0')`）+ `.rank-name` + `.rank-count`，替代旧 `.dist-row` 结构。

**3.2 `renderLibrary`**（第 335–371 行）— `clip-item` 改为 grid 两列：左 `.clip-rank` 编号，右 `.clip-main` 包裹原内容；底部加 `.clip-usage-bar`/`.clip-usage-fill`（width = `totalTokens/maxTokens*100%`，maxTokens 取当前列表最大值）。

**3.3 `drawTrend`**（第 877 行）— `colors` 改 `{tokens:'#2d5a3d', cost:'#8b7355', count:'#db3d43'}`。

**3.4 去 emoji** — `handleSave`（第 296、300 行）`✓ 已保存`→`已保存`、`💾 保存到剪藏库`→`保存到剪藏库`；`refreshProviderSelect` 内 showError（第 107 行）去 `⚙️`；`testProviderConnection`（第 992、995 行）去 `✓ `/`✗ ` 前缀（仅靠 `.ok`/`.fail` 着色）；`renderReaderArticle`（第 462、466 行）去 `⚠️`。

**3.5 不改逻辑** — `renderTagEditor`/`renderReaderTags`/`renderProviderList`/`buildReaderToc` 等函数 class 名不变，配色由 CSS 别名接管。

---

### 文件 4：`public/chart.js`

**4.1 颜色常量**（第 51、70–71 行）— 默认折线色 `#4f6ef7`→`#2d5a3d`；网格线 `#eef1f6`→`#e0ddd6`；轴文字 `#9aa3b5`→`#8a8880`。渲染逻辑、DPR、补日逻辑不动。

---

### 新增 / 删除的 CSS 类

新增：`.rank-row`、`.rank-num`、`.rank-name`、`.rank-count`、`.rank-bar`、`.clip-rank`、`.clip-main`、`.clip-usage-bar`、`.clip-usage-fill`。

删除（CSS 规则移除，JS 不再产出）：`.dist-row`、`.dist-name`、`.dist-bar`、`.dist-bar-fill`。

原位重写、不新增类：`.stat-big`、`.section-label`、`.reader-aside-title`、`.stats-title`、`.oneliner-box`、`.tabs/.tab`、`.clip-item/.clip-tag/.model-badge/.tag-chip/.cloud-tag`。

## Assumptions & Decisions

1. **原位编辑现有文件，不走 `.design` 画布**：本项目是实际运行的 Web 应用，用户要"优化显示效果"即原位重样式；产出是更新后的 `public/` 文件，而非独立画布稿。
2. **别名层优先**：旧变量名映射新令牌，避免 820 行逐行改写，风险最低、覆盖最广。
3. **stat-strip 原位重写 `.stat-big`**：不新增 class、不改 HTML，利用 CSS 后定义胜出覆盖 `.card`。
4. **rank-row 新增类族**：旧 dist-row 结构（name+bar+val）与参考站 rank-row（num+name+count+绝对定位 bar）差异较大，新增类比强行复用更清晰；JS 同步产出。
5. **衬线仅用于正文/oneliner/summary**：标题保持 sans，形成编辑风 sans 标题 + 衬线正文对比；列表页保持 sans 以利扫读。
6. **tab 改下划线式**：药丸分段控件偏 SaaS，下划线 + 底部 rule 更贴合编辑风。
7. **emoji 全清**：层级改由 eyebrow 排版承担；保留 `+`/`←`/`×` 等符号字符（非 emoji）。
8. **chart.js 仅改 3 处颜色常量**：渲染逻辑不动。
9. **字体走 CDN `<link>`**：不引入构建/依赖，纯 CSS+JS 原位改写。
10. **保持功能零影响**：不改 DOM 层级、id、data 属性、JS 业务逻辑。

## Verification Steps

1. **令牌与字体**：body 底色为暖纸 `#fafaf8`；DevTools 检查 `--primary` 解析为 `#2d5a3d`；按钮/链接/focus 光环均为森林绿、无蓝紫残留；Inter/Lora/Noto Serif SC 已加载，正文衬线、UI 无衬线。
2. **生成摘要 Tab**：section-label 为 10px 大写小标题、无 emoji；一句话总结框暖棕底 + 暖棕左边线 + 衬线；摘要正文衬线 line-height 1.8；保存按钮无 `💾`，保存后显示「已保存」无 `✓`；标签 chip 方角森林绿。
3. **剪藏库 Tab**：列表项左侧有 `01/02` 编号（ink-5 等宽）；每项底部 3px 森林绿 token 进度条，宽度随 token 占比变化；切换排序后编号与进度条正确重算；model-badge 森林绿方角、clip-tag 纸色方角带边框；搜索/筛选功能正常。
4. **统计 Tab**：三宫格为 stat-strip（顶 2.5px 粗黑线 + 底 1px 细线、数字森林绿衬线 26px、label 11px ink-4）；模型/平台分布为 rank-row（编号 + 名称 + 计数 + 透明绿进度条 + 底分隔线、hover 淡绿底）；趋势图折线森林绿/暖棕/红、网格线 `#e0ddd6`、轴文字 `#8a8880`；标签云方角纸色、hover 森林绿。
5. **阅读页 reader**：底色暖纸、顶部栏白底 rule-light 分隔；中栏正文段落衬线 line-height 1.9、标题 sans；blockquote 森林绿左边线 + forest-light 底；代码块 ink 深底、行内代码 paper-mid 底；右栏 aside-title 为 eyebrow 小标题、无 emoji；一句话总结框暖棕衬线；旧剪藏降级提示暖棕框无 `⚠️`；编辑模式虚线边框森林绿、focus 光环 forest-light；目录点击平滑滚动、ESC 关闭、返回、删除功能正常。
6. **设置 Tab**：服务商开关开启态森林绿；测试连接结果仅着色无 `✓`/`✗` 前缀；保存功能正常。
7. **响应式**：560px 单列降级正常、clip-item 编号 + 进度条不溢出；阅读页 1100px/768px 断点布局正常。
8. **功能回归**：全流程（生成摘要 → 保存 → 列表 → 阅读 → 编辑 → 保存 → 删除）无 JS 报错、数据正常；DevTools Console 无 404（字体）、无未捕获异常。
