<div align="center">

# CTZ's Web Summary Index

**输入网址 → 自动抓取网页 → AI 生成摘要 → 永久收藏、统计与可视化**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](./package.json)

[English](./README.md) | 简体中文

</div>

---

## 这是什么

一个本地优先的网页剪藏 + AI 总结工具。把文章丢给它，它会抓取正文、提取元数据（作者 / 平台 / 发布时间 / 目录大纲）、调用你自己的 LLM 生成结构化摘要与标签，然后连同 Token 用量和费用估算一起永久存进本地 SQLite。

每一个剪藏都包含：**标题、作者、发布平台、发布时间、文章目录、摘要、标签、生成模型、Token 用量、预估费用、原文链接**。

内置阅读器支持**多颜色高亮与批注**（类似读书笔记）；微信公众号等防盗链站点的图片会自动下载到本地，剪藏后离线可读。

> 📝 规划中的功能与迭代想法见 [TODO.md](./TODO.md)

## 演示

![首页](screenshots/home.png)
*首页：条目计数、贡献热力图、标签云、最近剪藏*

![剪藏库](screenshots/library.png)
*剪藏库：时间聚类、搜索筛选、列表与排行*

## 功能

### 总结生成
- 自动抓取网页正文（基于 Firefox 阅读模式算法，剔除导航 / 广告噪声），含微信等懒加载站点的 `data-src` 图片回填
- 自动提取元数据：作者（中西文姓名混合解析）、发布平台、发布时间、文章目录大纲（H1–H4 + 编号段落合并提取）
- **AI 辅助解析模式**（可选）：js 规则解析为主，LLM 仅增强大纲提取，失败自动回退 js 结果
- AI 生成结构化摘要（核心观点 + 关键要点）+ 自动标签
- 多服务商 / 多模型自由切换（智谱 GLM、并行 paratera 等 OpenAI 兼容接口）
- 实时显示 Token 用量与费用估算

### 阅读与批注
- 三栏阅读页：左侧目录 / 高亮切换，中间全文，右侧摘要与用量信息
- **多颜色高亮**（黄 / 蓝 / 红）+ 高亮批注，支持改色、编辑批注、删除；首页与剪藏库按颜色分色计数展示
- 正文图片本地化：防盗链站点的图片自动下载到 `data/images/`，改写为本地路径
- 内置编辑器：可修改标题、作者、正文与大纲

### 剪藏库（SQLite 持久化）
- 一键保存剪藏，永久存储于本地 `data/clippings.db`
- 全文搜索（标题 / 摘要 / 作者）+ 标签筛选 + 排序（最近 / Token / 费用）
- 详情查看：完整摘要、文章目录、原文链接、用量详情
- 标签随时增删编辑（保存前后均可），中英文剪藏分别存储与筛选

### 统计与可视化
- Token 用量趋势图（原生 Canvas 折线图），三种指标切换：Token / 费用 / 剪藏数
- 按模型、按平台分布
- 热门标签云（可点击跳转筛选）、贡献热力图（GitHub 风格，近 365 天）

### 其他
- 中英文界面一键切换（右上角「中 / EN」，首次访问按浏览器语言自动判断），AI 摘要跟随界面语言生成
- API Key 仅保存在浏览器 localStorage，不进服务器、不落盘

---

## 快速开始

### 0. 前置要求
- **Node.js ≥ 18**（用到了原生 `fetch`、`AbortSignal.timeout` 等）
- 一个可用的 AI 服务商 API Key（智谱 GLM 或并行 paratera，注册即有免费额度）

### 1. 安装依赖并启动

```bash
npm install
npm start
# 或开发模式（文件改动自动重启）
npm run dev
```

首次启动会自动创建 `data/` 目录和 `data/clippings.db` 数据库，无需手动准备。打开 http://localhost:3000 。

### 2. 在页面配置服务商

首次打开会提示尚未配置服务商。点顶部「⚙️ 设置」Tab：

1. 点「+ 添加服务商」
2. 从内置预设选一个（智谱 GLM / 并行 paratera），表单会自动填好 Base URL 和模型列表
3. 只需填入你的 **API Key**（可在对应平台注册获取）
4. 点「测试连接」验证 Key 是否有效
5. 「保存」即可回到首页使用

也可以添加任意 OpenAI 兼容的自定义服务商（填 Base URL + Key + 模型名）。

> **Key 存哪里？** 仅保存在你当前浏览器（localStorage），不进服务器、不落盘、不进 git。换浏览器需重新填写。公共电脑不建议使用。

### （可选）服务端预配置

若想让所有访问者共享同一套 Key（如团队部署），可在 `.env` 配置：

```bash
cp .env.example .env
# 编辑 .env 填 ZHIPU_API_KEY / PARATERA_API_KEY
```

前端未配置时自动回退到 `.env`。

---

## 版本与更新

本项目遵循语义化版本（规则见 [VERSIONING.md](./VERSIONING.md)），更新日志见 [CHANGELOG.md](./CHANGELOG.md)。

升级方式：

```bash
git pull && npm install && npm start
```

数据库 schema 变更会在启动时自动幂等迁移，通常无需手动处理；如有破坏性变更（MAJOR），会在 CHANGELOG 单列「破坏性变更」说明。

## 技术架构

```
前端（Tab：首页 / 剪藏库 / 设置）        后端（Express，无状态转发）
  ├─ 原生 HTML/CSS/JS                    ├─ 网页抓取：Node 原生 fetch
  ├─ 原生 Canvas 折线图（零依赖）  ←→    ├─ 正文提取：@mozilla/readability + jsdom
  ├─ localStorage 存服务商配置+Key        ├─ 元数据：Open Graph / meta / <time>
  ├─ i18n.js 中英文切换                  ├─ 大纲提取：DOM H1-H4 + 编号 fallback
  └─ 请求时把 Key 传给后端转发            ├─ 图片本地化：防盗链下载（data/images）
                                         ├─ AI 调用：OpenAI 兼容接口（用前端传入的 Key 转发）
                                         ├─ i18n：按 X-Lang 头本地化错误 + 摘要语言
                                         └─ 持久化：SQLite（better-sqlite3，按 lang 分区）
```

后端不持有 API Key，只做无状态转发——不同浏览器各自带自己的 Key，互不干扰。

所有 AI 服务商均使用 OpenAI 兼容接口，底层调用逻辑一套通吃，新增服务商只需在 `config/providers.js` 追加配置。

## 目录结构

```
web-summary/
├── server.js                  # Express 入口
├── config/
│   ├── providers.js           # 服务商 + 模型配置
│   └── pricing.js             # 定价表（元/百万 token，可编辑）
├── src/
│   ├── extract.js             # 抓取 + 正文/元数据/大纲提取 + 清洗
│   ├── images.js              # 正文图片本地化（防盗链下载）
│   ├── llm.js                 # 统一 LLM 调用（摘要 + AI 大纲 prompt 双语）
│   ├── usage.js               # Token 统计 + 费用计算
│   ├── db.js                  # SQLite 封装（建表/CRUD/统计，按 lang 分区）
│   ├── i18n.js                # 后端 i18n（错误信息本地化）
│   └── router/
│       ├── clippings.js       # 剪藏 CRUD 路由
│       ├── stats.js           # 统计 + 趋势路由
│       └── highlights.js      # 高亮/批注路由
├── public/
│   ├── index.html             # 主页面
│   ├── style.css              # 样式
│   ├── i18n.js                # 前端 i18n（中英字典）
│   ├── app.js                 # 前端交互
│   └── chart.js               # Canvas 折线图
├── screenshots/               # README 演示截图
│   ├── home.png
│   └── library.png
└── data/
    ├── clippings.db           # SQLite 数据库（运行时生成，git 忽略）
    └── images/                # 本地化的正文图片（运行时生成）
```

## 剪藏字段

| 字段 | 说明 | 来源 |
|------|------|------|
| 标题 | 文章标题 | 网页 meta / Readability |
| 作者 | 文章作者 | `article:author` 等 meta / JSON-LD |
| 发布平台 | 站点名 | `og:site_name` 或域名 |
| 发布时间 | 原文发布日期 | `article:published_time` / `<time>` |
| 目录 | 文章章节大纲 | DOM H1–H4 + 编号段落提取 |
| 摘要 | 结构化摘要 | AI 生成 |
| 一句话总结 | 核心一句话概括 | AI 生成 |
| 标签 | 3-5 个主题标签 | AI 生成 + 可编辑 |
| 模型 | 生成摘要的模型 | 记录所选模型 |
| Token 用量 | 输入/输出/总计 | API 响应 `usage` |
| 预估费用 | 人民币估算 | Token × 定价表 |
| 语言 | 摘要生成语言 | 界面语言（zh/en） |
| 原文链接 | URL | 用户输入 |

## 新增服务商 / 模型

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

## 关于费用估算

- 定价表 `config/pricing.js` 数值来自各模型官方公开价（元/百万 token），仅供估算参考
- paratera 实际计费以其账户后台为准
- 未在定价表中的模型，UI 显示「价格未知」，仅展示 Token 用量
- 想调整价格，直接编辑 `config/pricing.js`，无需改代码

## 安全说明

- API Key 有两种存放方式，按优先级生效：
  1. **前端 localStorage**（默认）：Key 仅存于你当前浏览器，请求时随调用转发给后端，**不落盘、不进 git**。换浏览器需重新填写，公共电脑不建议使用。
  2. **后端 `.env`**（兜底 / 团队共享）：前端未配置时回退读取 `.env`，适合多人共用部署。
- 后端做无状态转发，不持久化任何 Key，不同浏览器各自的 Key 互不干扰。
- `.env` 与 `data/` 均在 `.gitignore` 中，不会被提交。
- 仅允许 http/https 协议的网址。
- 网页抓取设有 10 秒超时；图片下载单图 8 秒超时。
- 所有数据保存在本地，不上传任何第三方。

## 开发

```bash
npm run dev    # 文件改动自动重启
```

数据备份：直接复制 `data/clippings.db` 文件即可。

## License

[MIT](./LICENSE) © 2026 CTZ
