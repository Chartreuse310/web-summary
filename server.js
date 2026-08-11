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
const { summarize } = require('./src/llm');
const { calcUsage } = require('./src/usage');
// 引入 db 模块会自动建表（src/db.js 顶层执行）
require('./src/db');

const clippingsRouter = require('./src/router/clippings');
const statsRouter = require('./src/router/stats');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 服务商预设模板（供前端做种子，用户在设置里填 Key 后启用）
// 不暴露 .env 是否配置——前端配置以 localStorage 为准
app.get('/api/provider-presets', (req, res) => {
  res.json({ providers });
});

// 抓取 + 总结主流程
app.post('/api/summarize', async (req, res) => {
  try {
    const { url, provider, providerId, model } = req.body || {};
    if (!url) return res.status(400).json({ error: '请输入要总结的网址' });
    if (!model) return res.status(400).json({ error: '请选择模型' });
    if (!provider && !providerId) {
      return res.status(400).json({ error: '请选择服务商（或到「设置」中配置）' });
    }

    // 1. 抓取 + 元数据 + 大纲
    const extracted = await extractContent(url);

    // 2. AI 总结（provider 优先来自前端 localStorage，providerId 兜底 .env）
    const llmResult = await summarize({
      provider,
      providerId,
      model,
      text: extracted.text,
      title: extracted.title
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
    const message = err.message || '未知错误';
    const status = /超时|无法访问|HTTP \d+|未配置|无效或已过期|访问被拒绝/.test(message) ? 502 : 400;
    res.status(status).json({ error: message });
  }
});

// 测试服务商连接（设置页用）：用提供的 Key 发一个最小请求，验证可用性
app.post('/api/test-provider', async (req, res) => {
  try {
    const { baseUrl, apiKey, model } = req.body || {};
    if (!baseUrl || !apiKey || !model) {
      return res.status(400).json({ error: '请填写 baseUrl、API Key、模型' });
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
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 5
      })
    });
    if (resp.ok) {
      return res.json({ ok: true, message: '连接成功' });
    }
    if (resp.status === 401) return res.json({ ok: false, message: 'API Key 无效或已过期' });
    if (resp.status === 404) return res.json({ ok: false, message: '接口地址错误或模型不存在' });
    if (resp.status === 429) return res.json({ ok: false, message: '请求过于频繁或额度用完' });
    let detail = '';
    try { detail = (await resp.json())?.error?.message || ''; } catch {}
    return res.json({ ok: false, message: `服务商返回 HTTP ${resp.status}${detail ? '：' + detail : ''}` });
  } catch (err) {
    if (err.name === 'TimeoutError') return res.json({ ok: false, message: '连接超时（15 秒）' });
    return res.json({ ok: false, message: `连接失败：${err.message}` });
  }
});

// 剪藏 + 统计
app.use('/api/clippings', clippingsRouter);
app.use('/api/stats', statsRouter);

app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

app.listen(PORT, () => {
  const configured = providers
    .filter((p) => process.env[p.apiKeyEnv])
    .map((p) => p.name)
    .join('、') || '（无，请在 .env 配置 API Key）';
  console.log(`\n  网页剪藏库已启动`);
  console.log(`  地址：http://localhost:${PORT}`);
  console.log(`  数据：data/clippings.db`);
  console.log(`  可用服务商：${configured}\n`);
});
