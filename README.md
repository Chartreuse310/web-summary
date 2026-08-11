# 📚 网页剪藏库

输入网址 → 自动抓取网页 → AI 生成中文摘要 → 永久收藏、统计与可视化。

每一个剪藏都包含：**标题、作者、发布平台、发布时间、文章目录、摘要、标签、生成模型、Token 用量、预估费用、原文链接**。

## ✨ 功能

### 总结生成
- 📥 自动抓取网页正文（基于 Firefox 阅读模式算法，剔除导航/广告噪声）
- 🔍 自动提取元数据：作者、发布平台、发布时间、文章目录大纲（H1-H3）
- 🤖 AI 生成结构化中文摘要（核心观点 + 关键要点）+ 自动标签
- 🔀 多服务商 / 多模型自由切换（智谱 GLM、并行 paratera 等，66 个文本模型可选）
- 📊 实时显示 Token 用量与费用估算

### 剪藏库（SQLite 持久化）
- 💾 一键保存剪藏，永久存储于本地 `data/clippings.db`
- 🔎 全文搜索（标题/摘要/作者）+ 标签筛选 + 排序（最近/Token/费用）
- 📄 详情查看：完整摘要、文章目录、原文链接、用量详情
- 🏷️ 标签随时增删编辑（保存前后均可）
- 🗑️ 一键删除（带确认）

### 统计与可视化
- 📈 Token 用量趋势图（最近 30 天，原生 Canvas 折线图）
- 🔀 三种指标切换：Token / 费用 / 剪藏数
- 📊 按模型、按平台分布
- 🏷️ 热门标签云（可点击跳转筛选）

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env`，填入至少一个服务商的 key：

```env
ZHIPU_API_KEY=你的智谱key      # https://bigmodel.cn/（有免费额度）
PARATERA_API_KEY=你的paratera  # https://llmapi.paratera.com
PORT=3000
```

> 未配置 key 的服务商会在前端自动隐藏。

### 3. 启动

```bash
npm start
# 或开发模式（文件改动自动重启）
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 🧱 技术架构

```
前端（Tab：总结 / 剪藏库 / 统计）       后端（Express）
  ├─ 原生 HTML/CSS/JS                   ├─ 网页抓取：Node 原生 fetch
  ├─ 原生 Canvas 折线图（零依赖）  ←→    ├─ 正文提取：@mozilla/readability + jsdom
  └─ localStorage 临时统计              ├─ 元数据提取：Open Graph / meta 标签 / <time>
                                        ├─ 大纲提取：DOM H1-H3
                                        ├─ AI 调用：OpenAI 兼容接口（多服务商通用）
                                        └─ 持久化：SQLite（better-sqlite3）
```

所有 AI 服务商均使用 OpenAI 兼容接口，底层调用逻辑一套通吃，新增服务商只需在 `config/providers.js` 追加配置。

## 📁 目录结构

```
web-summary/
├── server.js                  # Express 入口
├── config/
│   ├── providers.js           # 服务商 + 模型配置
│   └── pricing.js             # 定价表（元/百万 token，可编辑）
├── src/
│   ├── extract.js             # 网页抓取 + 正文/元数据/大纲提取
│   ├── llm.js                 # 统一 LLM 调用（含 tags 生成）
│   ├── usage.js               # Token 统计 + 费用计算
│   ├── db.js                  # SQLite 封装（建表/CRUD/统计）
│   └── router/
│       ├── clippings.js       # 剪藏 CRUD 路由
│       └── stats.js           # 统计 + 趋势路由
├── public/
│   ├── index.html             # 主页面（三 Tab）
│   ├── style.css              # 样式
│   ├── app.js                 # 前端交互
│   └── chart.js               # Canvas 折线图
└── data/
    └── clippings.db           # SQLite 数据库（运行时生成，git 忽略）
```

## 📋 剪藏字段

每个剪藏保存以下信息：

| 字段 | 说明 | 来源 |
|------|------|------|
| 标题 | 文章标题 | 网页 meta / Readability |
| 作者 | 文章作者 | `article:author` 等 meta 标签 |
| 发布平台 | 站点名 | `og:site_name` 或域名 |
| 发布时间 | 原文发布日期 | `article:published_time` / `<time>` |
| 目录 | 文章章节大纲 | DOM H1-H3 提取 |
| 摘要 | 中文结构化摘要 | AI 生成 |
| 标签 | 3-5 个主题标签 | AI 生成 + 可编辑 |
| 模型 | 生成摘要的模型 | 记录所选模型 |
| Token 用量 | 输入/输出/总计 | API 响应 `usage` |
| 预估费用 | 人民币估算 | Token × 定价表 |
| 原文链接 | URL | 用户输入 |

## ➕ 新增服务商 / 模型

1. 在 `config/providers.js` 追加：

```js
{
  id: 'myprovider',
  name: '我的服务商',
  baseUrl: 'https://api.example.com/v1',
  apiKeyEnv: 'MYPROVIDER_API_KEY',
  models: [{ group: '分组名', items: ['model-a', 'model-b'] }]
}
```

2. 在 `.env` 加入 `MYPROVIDER_API_KEY=xxx`
3. （可选）在 `config/pricing.js` 补充定价用于费用估算

重启服务即可。

## 💰 关于费用估算

- 定价表 `config/pricing.js` 数值来自各模型官方公开价（元/百万 token），仅供估算参考
- paratera 实际计费以其账户后台为准
- 未在定价表中的模型，UI 显示「价格未知」，仅展示 Token 用量
- 想调整价格，直接编辑 `config/pricing.js`，无需改代码

## 🔒 安全说明

- API Key 仅保存在后端 `.env`，前端永远接触不到
- `.env` 与 `data/` 均在 `.gitignore` 中，不会被提交
- 仅允许 http/https 协议的网址
- 抓取设有 10 秒超时
- 所有数据保存在本地，不上传任何第三方

## 🛠️ 开发

```bash
npm run dev    # 文件改动自动重启
```

数据备份：直接复制 `data/clippings.db` 文件即可。
