/**
 * Express 服务入口
 *
 * 路由：
 *   GET  /api/config      已配置的服务商 + 模型列表
 *   POST /api/summarize   抓取 + AI 总结，返回完整结果（含元数据/大纲/tags）
 *   /api/clippings        剪藏 CRUD（见 src/router/clippings.js）
 *   /api/stats            统计 + 趋势（见 src/router/stats.js）
 */
require('dotenv').config();
const path = require('path');
const express = require('express');

const { providers } = require('./config/providers');
const { extractContent } = require('./src/extract');
const { summarize, extractOutlineByAi } = require('./src/llm');
const { calcUsage } = require('./src/usage');
// 引入 db 模块会自动建表（src/db.js 顶层执行）
require('./src/db');

const clippingsRouter = require('./src/router/clippings');
const statsRouter = require('./src/router/stats');
const highlightsRouter = require('./src/router/highlights');
const { t, pickLang } = require('./src/i18n');
const { downloadImages } = require('./src/images');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// 本地化的正文图片（data/images），微信等防盗链站点下载后走本地路径
app.use('/images', express.static(path.join(__dirname, 'data', 'images')));

// 服务商预设模板（供前端做种子，用户在设置里填 Key 后启用）
// 不暴露 .env 是否配置——前端配置以 localStorage 为准
app.get('/api/provider-presets', (req, res) => {
  res.json({ providers });
});

// 抓取 + 总结主流程
app.post('/api/summarize', async (req, res) => {
  const lang = pickLang(req);
  try {
    const { url, provider, providerId, model, parseMode } = req.body || {};
    if (!url) return res.status(400).json({ error: t(lang, 'err.urlRequired') });
    if (!model) return res.status(400).json({ error: t(lang, 'err.modelRequired') });
    if (!provider && !providerId) {
      return res.status(400).json({ error: t(lang, 'err.providerRequiredSrv') });
    }

    // 1. 抓取 + 元数据 + 大纲
    const extracted = await extractContent(url, lang);

    // AI 辅助大纲（可选）：parseMode='ai' 时用 LLM 重新提取，
    // 补 js 规则漏掉的样式标题（加粗短段落等）；失败回退 js 解析的 outline
    if (parseMode === 'ai') {
      try {
        const aiOutline = await extractOutlineByAi({
          provider, providerId, model, text: extracted.text, title: extracted.title, lang
        });
        if (aiOutline && aiOutline.length >= 2) extracted.outline = aiOutline;
      } catch (e) {
        console.warn('[parseMode=ai] AI 大纲提取失败，回退 js outline：', e.message);
      }
    }

    // 1.5 图片本地化：防盗链站点（微信等）的 <img> 下载到本地并改写 src；
    // 失败的图保留远程地址，不阻塞主流程
    try {
      extracted.contentHtml = await downloadImages(extracted.contentHtml);
    } catch (e) {
      console.warn('[images] 图片本地化失败：', e.message);
    }

    // 2. AI 总结（provider 优先来自前端 localStorage，providerId 兜底 .env）
    const llmResult = await summarize({
      provider,
      providerId,
      model,
      text: extracted.text,
      title: extracted.title,
      lang
    });

    // 3. token / 费用
    const usageInfo = calcUsage(model, llmResult.usage);

    res.json({
      title: extracted.title,
      summary: llmResult.summary,
      oneliner: llmResult.oneliner,
      tags: llmResult.tags,
      url: extracted.url,
      author: extracted.author,
      platform: extracted.platform,
      publishedAt: extracted.publishedAt,
      outline: extracted.outline,
      contentText: extracted.text,
      contentHtml: extracted.contentHtml,
      model: llmResult.model,
      usage: usageInfo
    });
  } catch (err) {
    const message = err.message || t(lang, 'err.unknown');
    // 按 err.code 判定状态码：网络/上游/配置类 → 502，其余 → 400
    const gatewayCodes = ['timeout', 'fetch_failed', 'http_error', 'not_configured', 'auth_invalid', 'access_denied', 'rate_limit'];
    const status = (err.code && gatewayCodes.includes(err.code)) ? 502 : 400;
    res.status(status).json({ error: message });
  }
});

// 测试服务商连接（设置页用）：用提供的 Key 发一个最小请求，验证可用性
app.post('/api/test-provider', async (req, res) => {
  const lang = pickLang(req);
  try {
    const { baseUrl, apiKey, model } = req.body || {};
    if (!baseUrl || !apiKey || !model) {
      return res.status(400).json({ error: t(lang, 'test.fillRequired') });
    }
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: lang === 'en' ? 'Hi' : '你好' }],
        max_tokens: 5
      })
    });
    if (resp.ok) {
      return res.json({ ok: true, message: t(lang, 'test.ok') });
    }
    if (resp.status === 401) return res.json({ ok: false, message: t(lang, 'test.authInvalid') });
    if (resp.status === 404) return res.json({ ok: false, message: t(lang, 'test.urlError') });
    if (resp.status === 429) return res.json({ ok: false, message: t(lang, 'test.rateLimit') });
    let detail = '';
    try { detail = (await resp.json())?.error?.message || ''; } catch {}
    const detailStr = detail ? (lang === 'en' ? ': ' + detail : '：' + detail) : '';
    return res.json({ ok: false, message: t(lang, 'test.httpError', { status: resp.status, detail: detailStr }) });
  } catch (err) {
    if (err.name === 'TimeoutError') return res.json({ ok: false, message: t(lang, 'test.timeout') });
    return res.json({ ok: false, message: t(lang, 'test.failed', { msg: err.message }) });
  }
});

// 剪藏 + 统计 + 高亮
app.use('/api/clippings', clippingsRouter);
app.use('/api/stats', statsRouter);
app.use('/api', highlightsRouter);

app.use((req, res) => res.status(404).json({ error: t(pickLang(req), 'err.notFound') }));

// 仅绑定到本机回环地址：该工具无身份认证，且 /api/summarize 与 /api/test-provider
// 会按请求体里的 baseUrl 让本服务发起任意 POST（SSRF 原语）。若 0.0.0.0 暴露到局域网，
// 同网段任意主机可读写整个剪藏库并借本服务探测内网。回环绑定规避此风险。
app.listen(PORT, '127.0.0.1', () => {
  const configured = providers
    .filter((p) => process.env[p.apiKeyEnv])
    .map((p) => p.name)
    .join('、') || '（无，请在 .env 配置 API Key）';
  console.log(`\n  网页剪藏库已启动`);
  console.log(`  地址：http://localhost:${PORT}`);
  console.log(`  数据：data/clippings.db`);
  console.log(`  可用服务商：${configured}\n`);
});
