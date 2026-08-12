/**
 * 高亮评论路由
 *   POST   /api/clippings/:id/highlights   新增高亮（body: exactText, prefix, suffix, comment?）
 *   GET    /api/clippings/:id/highlights   列出该篇全部高亮
 *   PUT    /api/highlights/:hid            更新评论（body: comment）
 *   DELETE /api/highlights/:hid            删除单条高亮
 *
 * 定位策略：前端在选中时基于 article.textContent 计算 exactText + prefix + suffix，
 * 后端只原样存储；还原时前端用三段拼接做子串匹配重新包裹 <mark>，不依赖 DOM 偏移。
 */
const express = require('express');
const {
  insertHighlight,
  listHighlights,
  updateHighlight,
  deleteHighlight,
  getHighlight,
  getClipping
} = require('../db');
const { t, pickLang } = require('../i18n');

const router = express.Router();

// 列出某篇剪藏的全部高亮
router.get('/clippings/:id/highlights', (req, res) => {
  const lang = pickLang(req);
  const id = Number(req.params.id);
  if (!getClipping(id)) return res.status(404).json({ error: t(lang, 'err.clippingNotFound') });
  try {
    res.json(listHighlights(id));
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.queryFailed', { msg: err.message }) });
  }
});

// 新增高亮
router.post('/clippings/:id/highlights', (req, res) => {
  const lang = pickLang(req);
  const id = Number(req.params.id);
  if (!getClipping(id)) return res.status(404).json({ error: t(lang, 'err.clippingNotFound') });
  try {
    const b = req.body || {};
    if (!b.exactText || typeof b.exactText !== 'string') {
      return res.status(400).json({ error: t(lang, 'err.highlightMissingFields') });
    }
    const created = insertHighlight({
      clippingId: id,
      exactText: b.exactText,
      prefix: typeof b.prefix === 'string' ? b.prefix : '',
      suffix: typeof b.suffix === 'string' ? b.suffix : '',
      comment: typeof b.comment === 'string' && b.comment.trim() ? b.comment.trim() : null
    });
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.saveFailed', { msg: err.message }) });
  }
});

// 更新高亮评论
router.put('/highlights/:hid', (req, res) => {
  const lang = pickLang(req);
  const hid = Number(req.params.hid);
  if (!getHighlight(hid)) return res.status(404).json({ error: t(lang, 'err.highlightNotFound') });
  try {
    const body = req.body || {};
    const updated = updateHighlight(hid, {
      comment: typeof body.comment === 'string' ? body.comment.trim() || null : null
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.updateFailed', { msg: err.message }) });
  }
});

// 删除单条高亮
router.delete('/highlights/:hid', (req, res) => {
  const lang = pickLang(req);
  const hid = Number(req.params.hid);
  if (!getHighlight(hid)) return res.status(404).json({ error: t(lang, 'err.highlightNotFound') });
  try {
    deleteHighlight(hid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.deleteFailed', { msg: err.message }) });
  }
});

module.exports = router;
