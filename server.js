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

// 服务商配置
app.get('/api/config', (req, res) => {
  const available = providers
    .filter((p) => !!process.env[p.apiKeyEnv])
    .map((p) => ({ id: p.id, name: p.name, models: p.models }));
  res.json({ providers: available });
});

// 抓取 + 总结主流程
app.post('/api/summarize', async (req, res) => {
  try {
    const { url, providerId, model } = req.body || {};
    if (!url) return res.status(400).json({ error: '请输入要总结的网址' });
    if (!providerId) return res.status(400).json({ error: '请选择服务商' });
    if (!model) return res.status(400).json({ error: '请选择模型' });

    // 1. 抓取 + 元数据 + 大纲
    const extracted = await extractContent(url);

    // 2. AI 总结（返回 {summary, tags, usage, model}）
    const llmResult = await summarize({
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
      tags: llmResult.tags,
      url: extracted.url,
      author: extracted.author,
      platform: extracted.platform,
      publishedAt: extracted.publishedAt,
      outline: extracted.outline,
      contentText: extracted.text,
      model: llmResult.model,
      usage: usageInfo
    });
  } catch (err) {
    const message = err.message || '未知错误';
    const status = /超时|无法访问|HTTP \d+|未配置|无效或已过期|访问被拒绝/.test(message) ? 502 : 400;
    res.status(status).json({ error: message });
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
