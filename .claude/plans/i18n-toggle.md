# 中英文切换功能实现方案

## 目标
新增中英文界面切换，覆盖范围：①前端 UI 文案（HTML 静态 + app.js 动态生成）②后端用户可见错误信息 ③AI 摘要输出语言。首次访问根据 `navigator.language` 自动判断，切换后记忆到 localStorage。

## 架构

### 1. 新增前端 i18n 模块 `public/i18n.js`（新建，全局 `window.I18n`，vanilla JS，匹配项目无构建风格）
- `MESSAGES = { zh: {…}, en: {…} }`，键用语义化点路径（如 `header.subtitle`、`tab.home`、`btn.addClipping`、`err.urlRequired`）
- `getLang()` / `setLang(lang)`：写入 localStorage `web-summary:lang`，设 `<html lang>`，派发 `langchange` 事件
- `t(key, params)`：`{name}` 占位插值；缺键回退到 zh，再回退到 key 本身
- `applyTo(root=document)`：遍历 `[data-i18n]` 设 textContent、`[data-i18n-ph]` 设 placeholder、`[data-i18n-title]` 设 title
- `initLang()`：localStorage → 否则 `navigator.language.startsWith('zh') ? 'zh' : 'en'`

### 2. `public/index.html`
- 给所有静态中文文案加 `data-i18n="key"`（title/subtitle、3 个 tab、首页 stat 标签与 section-label、library 工具栏 label/select options、settings 标题与 hint、modal 标题与 label/placeholder、reader 各 aside 标题、footer 等；`<html lang>` 默认 `zh-CN`）
- header 右侧加语言切换按钮：`<button id="langToggle">中 / EN</button>`，当前语言高亮，点击切换
- `<script src="i18n.js" defer></script>` 置于 `app.js` 之前

### 3. `public/app.js`
- 所有硬编码中文字符串改为 `I18n.t(...)` 调用（含提示语、按钮临时文案如"保存中…/已保存"、空状态提示、热力图 tooltip、oneliner 模板、`renderDist`/`renderProviderList` 等）
- 监听 `langchange` → `I18n.applyTo()` 后按当前 Tab 重渲染（loadHome/loadLibrary/loadStats/renderProviderList；若阅读页打开则用 currentReaderClipping 重渲染）
- `api()` 助手注入 `X-Lang` 头；`/api/summarize` 请求体加 `lang` 字段
- 启动时 `I18n.initLang()` → `I18n.applyTo()`

### 4. 新增后端 i18n 模块 `src/i18n.js`（新建）
- `t(lang, key, params)` + 与前端一致的中英字典（后端用到的子集，主要是错误信息）
- 导出 `pickLang(req)`：读 `req.headers['x-lang']`，默认 `zh`

### 5. 后端错误信息本地化
- `server.js`：路由读 `lang = pickLang(req)`，传给 `extractContent`/`summarize`；validation 错误改 `t(lang, ...)`
- `src/extract.js`：`extractContent(url, lang)`，所有 `throw new Error('中文')` 改 `throw new Error(t(lang, 'err.xxx', {…}))`
- `src/llm.js`：
  - `SYSTEM_PROMPT` → `buildSystemPrompt(lang)`：zh 用现有中文 prompt；en 用英文版（要求 tags 用英文、≤3 词等），保证 `4. 即使原文…所有输出都用对应语言呈现` 一致
  - `summarize({…, lang})` 透传；`resolveProvider`/模型校验等错误信息改 `t(lang, ...)`
- `src/router/clippings.js`：validation 与 catch 错误改 `t(lang, ...)`，`lang = pickLang(req)`
- `src/router/stats.js`：若有用户可见错误同样处理（检查后大部分无）

### 6. `public/style.css`
- 加 `.lang-toggle` 样式（小按钮/分段控件，匹配现有 `.btn-secondary` 视觉），header 宽屏与移动端（`.header { flex-direction: column }` 断点）适配

## 影响文件
- 新增：`public/i18n.js`、`src/i18n.js`
- 改：`public/index.html`、`public/app.js`、`public/style.css`、`server.js`、`src/extract.js`、`src/llm.js`、`src/router/clippings.js`、`src/router/stats.js`（如需）
- 不动：`src/db.js`、`src/usage.js`、`config/providers.js`、`public/chart.js`（图表无文案或仅轴标签数字）

## 注意事项 / 兼容性
- 已有剪藏的 summary/oneliner/tags 是历史中文数据，切到英文界面仍显示原中文内容（属内容而非 UI），符合预期；新剪藏按当前语言生成
- 后端错误信息此前依赖正则 `/超时|无法访问|HTTP \d+|未配置|无效或已过期|访问被拒绝/` 判断 502 状态码 —— 改用 i18n key 后此正则失效，改为：抛错时附带 `err.code` 字段（如 `'timeout' | 'fetch_failed' | 'http_error' | 'not_configured' | 'auth_invalid' | 'access_denied'`），server.js 按 code 决定 502/400，更稳健
- `fmtAuthors` 用顿号分隔 → en 界面改用 `, ` 分隔（按 lang 切换 joiner）
- 日期格式保持 `YYYY-MM-DD`（语言无关）
- `<html lang>` 同步更新，利于无障碍/字体回退

## 验证
- `node server.js` 启动；浏览器默认中文→界面中文；点切英文→所有 UI 英文、重新生成摘要得到英文输出、后端错误（如故意填错 URL）显示英文
- 清 localStorage 模拟英文浏览器→默认英文
- 旧中文剪藏详情页在英文界面下仍正常显示
