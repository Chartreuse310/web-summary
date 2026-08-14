<div align="center">

# CTZ's Web Summary Index

**Enter a URL → auto-fetch the page → AI generates a summary → save, analyze, and visualize forever**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](./package.json)

English | [简体中文](./README.zh.md)

</div>

---

## What is this

A local-first web clipping + AI summarization tool. Feed it an article URL: it fetches the body, extracts metadata (authors / platform / publish date / outline), calls **your own LLM** for a structured summary and tags, then persists everything — including token usage and cost estimates — into a local SQLite database.

Every clipping stores: **title, authors, publishing platform, publish date, article outline, summary, tags, model used, token usage, estimated cost, and source link**.

The built-in reader supports **multi-color highlights with comments** (like reading notes). Images from anti-hotlink sites (WeChat etc.) are downloaded locally, so clippings stay readable offline.

> 📝 Planned features and ideas live in [TODO.md](./TODO.md)

## Demo

![Home](screenshots/home.png)
*Home: counts, contribution heatmap, tag cloud, recent clippings*

![Library](screenshots/library.png)
*Library: time clusters, search/filter, list and rankings*

## Features

### Summary generation
- Auto-extract page body (Firefox Readability algorithm; strips nav/ads), with `data-src` backfill for lazy-loading sites like WeChat
- Auto-extract metadata: authors (mixed Chinese/western name parsing), platform, publish date, outline (H1–H4 + numbered paragraphs, merged)
- **AI-assisted parsing** (optional): js rules parse the content; the LLM only enhances outline extraction and falls back to the js result on failure
- AI structured summary (core gist + key points) + auto tags
- Switch freely across providers/models (Zhipu GLM, Paratera, any OpenAI-compatible endpoint)
- Real-time token usage & cost estimates

### Reading & annotating
- Three-pane reader: outline/highlight sidebar, full article, summary & usage info
- **Multi-color highlights** (yellow/blue/red) with comments; recolor, edit, delete; per-color counts on home and library
- Image localization: anti-hotlink images are downloaded to `data/images/` and rewritten to local paths
- Built-in editor for title, authors, body, and outline

### Library (SQLite)
- One-click save, persisted in local `data/clippings.db`
- Full-text search (title/summary/author) + tag filter + sort (recent/tokens/cost)
- Detail view: full summary, outline, source link, usage breakdown
- Editable tags anytime; Chinese/English clippings stored and filtered separately

### Stats & visualization
- Token-usage trend chart (native Canvas line chart), three metrics: tokens / cost / clipping count
- Distribution by model and platform
- Tag cloud (click to filter), contribution heatmap (GitHub-style, last 365 days)

### Extras
- Chinese/English UI toggle (top-right "中 / EN", auto-detected on first visit); AI summaries follow the UI language
- API keys live only in your browser's localStorage — never sent to or stored on the server

---

## Quick Start

### 0. Prerequisites
- **Node.js ≥ 18** (uses native `fetch`, `AbortSignal.timeout`)
- An AI provider API Key (Zhipu GLM or Paratera; free tier on signup)

### 1. Install & Run

```bash
npm install
npm start
# or dev mode (auto-restart on file change)
npm run dev
```

First launch auto-creates `data/` and `data/clippings.db`. Open http://localhost:3000 .

### 2. Configure a Provider

On first open you'll be prompted to configure a provider. Go to the top **⚙️ Settings** tab:

1. Click "+ Add Provider"
2. Pick a built-in preset (Zhipu GLM / Paratera); Base URL and model list auto-fill
3. Enter your **API Key** (from the provider's console)
4. Click "Test Connection" to verify
5. "Save", then start summarizing

You can also add any OpenAI-compatible custom provider (Base URL + Key + model name).

> **Where is the Key stored?** Only in your current browser (localStorage) — never sent to the server, persisted, or committed. Re-enter when switching browsers. Not recommended on shared computers.

### (Optional) Server-side Preset

To share one set of keys across all visitors (e.g. team deploy), configure `.env`:

```bash
cp .env.example .env
# Edit .env: set ZHIPU_API_KEY / PARATERA_API_KEY
```

Falls back to `.env` when the frontend has no provider configured.

---

## Versioning & Updates

This project follows Semantic Versioning (see [VERSIONING.md](./VERSIONING.md)); the changelog lives in [CHANGELOG.md](./CHANGELOG.md).

To upgrade:

```bash
git pull && npm install && npm start
```

Database schema changes migrate automatically and idempotently on startup, so manual steps are rarely needed; any breaking change (MAJOR) will be listed under a dedicated "Breaking Changes" section in the changelog.

## Architecture

```
Frontend (tabs: Home / Library / Settings)  Backend (Express, stateless proxy)
  ├─ vanilla HTML/CSS/JS                    ├─ fetch: native Node fetch
  ├─ native Canvas line chart (no deps) ←→  ├─ body: @mozilla/readability + jsdom
  ├─ localStorage for provider+Key          ├─ metadata: Open Graph / meta / <time>
  ├─ i18n.js zh/en toggle                   ├─ outline: DOM H1-H4 + numbered fallback
  └─ forwards Key to backend per request    ├─ images: localized download (data/images)
                                            ├─ AI: OpenAI-compatible (proxy with caller's Key)
                                            ├─ i18n: X-Lang header → localized errors + summary lang
                                            └─ SQLite (better-sqlite3), partitioned by lang
```

The backend holds no API Key; it only proxies statelessly — each browser carries its own Key.

All AI providers use OpenAI-compatible APIs, so one calling path serves all. Adding a provider only requires appending to `config/providers.js`.

## Project Structure

```
web-summary/
├── server.js                  # Express entry
├── config/
│   ├── providers.js           # providers + models
│   └── pricing.js             # pricing table (editable)
├── src/
│   ├── extract.js             # fetch + body/metadata/outline extraction + sanitize
│   ├── images.js              # article image localization (anti-hotlink download)
│   ├── llm.js                 # unified LLM call (summary + AI outline prompts)
│   ├── usage.js               # token stats + cost calc
│   ├── db.js                  # SQLite wrapper (schema/CRUD/stats, lang-partitioned)
│   ├── i18n.js                # backend i18n (localized errors)
│   └── router/
│       ├── clippings.js       # clippings CRUD routes
│       ├── stats.js           # stats + trend routes
│       └── highlights.js      # highlights/comments routes
├── public/
│   ├── index.html             # main page
│   ├── style.css              # styles
│   ├── i18n.js                # frontend i18n (zh/en dict)
│   ├── app.js                 # frontend logic
│   └── chart.js               # Canvas chart
├── screenshots/               # README demo screenshots
│   ├── home.png
│   └── library.png
└── data/
    ├── clippings.db           # SQLite database (runtime-generated, gitignored)
    └── images/                # localized article images (runtime-generated)
```

## Clipping Fields

| Field | Description | Source |
|------|------|------|
| Title | article title | page meta / Readability |
| Authors | article authors | `article:author` meta / JSON-LD |
| Platform | site name | `og:site_name` or domain |
| Publish date | original publish date | `article:published_time` / `<time>` |
| Outline | section outline | DOM H1–H4 + numbered paragraphs |
| Summary | structured summary | AI |
| One-liner | one-sentence gist | AI |
| Tags | 3-5 topic tags | AI + editable |
| Model | model used | recorded |
| Tokens | in/out/total | API response `usage` |
| Cost | CNY estimate | tokens × pricing table |
| Lang | summary language | UI lang (zh/en) |
| Source URL | URL | user input |

## Add a Provider / Model

1. Append to `config/providers.js`:

```js
{
  id: 'myprovider',
  name: 'My Provider',
  baseUrl: 'https://api.example.com/v1',
  apiKeyEnv: 'MYPROVIDER_API_KEY',
  models: [{ group: 'Group', items: ['model-a', 'model-b'] }]
}
```

2. Add `MYPROVIDER_API_KEY=xxx` to `.env`
3. (Optional) Add pricing in `config/pricing.js` for cost estimation

Restart the server.

## Cost Estimation

- Values in `config/pricing.js` come from official public prices (CNY per million tokens); for reference only
- Paratera's actual billing is per its account console
- Models absent from the pricing table show "Price unknown" with token usage only
- To adjust prices, edit `config/pricing.js` directly — no code changes

## Security

- API Key storage options, by priority:
  1. **Frontend localStorage** (default): Key stays in your browser, forwarded per request — **never persisted or committed**. Re-enter on browser switch; not for shared computers.
  2. **Backend `.env`** (fallback / team-shared): used when the frontend has no config; suitable for shared deployments.
- The backend is a stateless proxy; it persists no Key — browsers don't interfere with each other.
- Both `.env` and `data/` are gitignored.
- Only http/https URLs are allowed.
- Page fetch has a 10s timeout; image downloads 8s per image.
- All data stays local; nothing is uploaded to third parties.

## Development

```bash
npm run dev    # auto-restart on file change
```

Backup: just copy the `data/clippings.db` file.

## License

[MIT](./LICENSE) © 2026 CTZ
