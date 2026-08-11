/**
 * 统计路由
 *   GET /api/stats        汇总数字 + 模型/平台/tag 分布
 *   GET /api/stats/trend  时间趋势（默认 30 天）
 */
const express = require('express');
const { getStats, getTokenTrend, getTimeClusters } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    res.json(getStats());
  } catch (err) {
    res.status(500).json({ error: `统计失败：${err.message}` });
  }
});

router.get('/trend', (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    res.json(getTokenTrend(days));
  } catch (err) {
    res.status(500).json({ error: `趋势查询失败：${err.message}` });
  }
});

router.get('/clusters', (req, res) => {
  try {
    res.json(getTimeClusters());
  } catch (err) {
    res.status(500).json({ error: `聚类查询失败：${err.message}` });
  }
});

module.exports = router;
