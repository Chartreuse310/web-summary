/**
 * 剪藏 CRUD 路由
 *   POST   /api/clippings        创建
 *   GET    /api/clippings        列表（支持 q、tag、sort、limit、offset）
 *   GET    /api/clippings/:id    详情
 *   PUT    /api/clippings/:id    编辑（tags / title / summary）
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

const router = express.Router();

// 创建
router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.url || !b.title || !b.summary || !b.model) {
      return res.status(400).json({ error: '缺少必填字段（url/title/summary/model）' });
    }
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
      contentText: b.contentText
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: `保存失败：${err.message}` });
  }
});

// 列表
router.get('/', (req, res) => {
  try {
    const result = listClippings({
      q: req.query.q,
      tag: req.query.tag,
      sort: req.query.sort,
      limit: parseInt(req.query.limit, 10) || 50,
      offset: parseInt(req.query.offset, 10) || 0
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `查询失败：${err.message}` });
  }
});

// 详情
router.get('/:id', (req, res) => {
  const item = getClipping(Number(req.params.id));
  if (!item) return res.status(404).json({ error: '剪藏不存在' });
  res.json(item);
});

// 编辑
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getClipping(id)) return res.status(404).json({ error: '剪藏不存在' });
  try {
    const updated = updateClipping(id, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `更新失败：${err.message}` });
  }
});

// 删除
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getClipping(id)) return res.status(404).json({ error: '剪藏不存在' });
  deleteClipping(id);
  res.json({ ok: true });
});

module.exports = router;
