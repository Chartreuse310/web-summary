/**
 * 剪藏 CRUD 路由
 *   POST   /api/clippings        创建
 *   GET    /api/clippings        列表（支持 q、tag、sort、limit、offset）
 *   GET    /api/clippings/:id    详情
 *   PUT    /api/clippings/:id    编辑（tags / author / title / summary / oneliner / contentHtml / contentText / outline）
 *   DELETE /api/clippings/:id    删除
 */
const express = require('express');
const {
  insertClipping,
  listClippings,
  getClipping,
  updateClipping,
  deleteClipping
} = require('../db');
const { sanitizeHtml } = require('../extract');
const { t, pickLang } = require('../i18n');

const router = express.Router();

// 创建
router.post('/', (req, res) => {
  const lang = pickLang(req);
  try {
    const b = req.body || {};
    if (!b.url || !b.title || !b.summary || !b.model) {
      return res.status(400).json({ error: t(lang, 'err.missingFields') });
    }
    // 摘要语言：优先用 body.lang（前端随保存请求显式带上），否则按请求头
    const clipLang = b.lang === 'en' ? 'en' : (lang === 'en' ? 'en' : 'zh');
    const id = insertClipping({
      url: b.url,
      title: b.title,
      author: b.author,
      platform: b.platform,
      publishedAt: b.publishedAt,
      outline: b.outline,
      summary: b.summary,
      oneliner: b.oneliner,
      tags: b.tags,
      model: b.model,
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
      totalTokens: b.totalTokens,
      cost: b.cost,
      contentText: b.contentText,
      contentHtml: b.contentHtml,
      lang: clipLang
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.saveFailed', { msg: err.message }) });
  }
});

// 列表
router.get('/', (req, res) => {
  const lang = pickLang(req);
  try {
    const result = listClippings({
      q: req.query.q,
      tag: req.query.tag,
      sort: req.query.sort,
      order: req.query.order,
      limit: parseInt(req.query.limit, 10) || 50,
      offset: parseInt(req.query.offset, 10) || 0,
      from: req.query.from,
      to: req.query.to,
      lang // 仅返回当前界面语言对应的剪藏
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.queryFailed', { msg: err.message }) });
  }
});

// 详情
router.get('/:id', (req, res) => {
  const lang = pickLang(req);
  const item = getClipping(Number(req.params.id));
  if (!item) return res.status(404).json({ error: t(lang, 'err.clippingNotFound') });
  res.json(item);
});

// 编辑
router.put('/:id', (req, res) => {
  const lang = pickLang(req);
  const id = Number(req.params.id);
  const existing = getClipping(id);
  if (!existing) return res.status(404).json({ error: t(lang, 'err.clippingNotFound') });
  try {
    const body = req.body || {};

    // 显式白名单字段构建 payload，避免未知字段注入
    const payload = {};
    if (body.title !== undefined) payload.title = body.title;
    if (body.summary !== undefined) payload.summary = body.summary;
    if (body.oneliner !== undefined) payload.oneliner = body.oneliner;
    if (body.tags !== undefined) payload.tags = body.tags;
    if (body.contentText !== undefined) payload.contentText = body.contentText;
    if (body.outline !== undefined) payload.outline = body.outline;
    if (body.author !== undefined) payload.author = body.author;

    // contentHtml：必须重新 sanitizeHtml 清洗（安全防线）
    if (body.contentHtml !== undefined) {
      payload.contentHtml = sanitizeHtml(body.contentHtml, existing.url);
    }

    const updated = updateClipping(id, payload);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.updateFailed', { msg: err.message }) });
  }
});

// 删除
router.delete('/:id', (req, res) => {
  const lang = pickLang(req);
  const id = Number(req.params.id);
  if (!getClipping(id)) return res.status(404).json({ error: t(lang, 'err.clippingNotFound') });
  deleteClipping(id);
  res.json({ ok: true });
});

module.exports = router;
