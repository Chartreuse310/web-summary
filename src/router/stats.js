/**
 * 统计路由
 *   GET /api/stats        汇总数字 + 模型/平台/tag 分布
 *   GET /api/stats/trend  时间趋势（默认 30 天）
 */
const express = require('express');
const { getStats, getTokenTrend, getTimeClusters } = require('../db');
const { t, pickLang } = require('../i18n');

const router = express.Router();

router.get('/', (req, res) => {
  const lang = pickLang(req);
  try {
    res.json(getStats({ lang }));
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.statsFailed', { msg: err.message }) });
  }
});

router.get('/trend', (req, res) => {
  const lang = pickLang(req);
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    res.json(getTokenTrend(days, { lang }));
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.trendFailed', { msg: err.message }) });
  }
});

router.get('/clusters', (req, res) => {
  const lang = pickLang(req);
  try {
    res.json(getTimeClusters({ lang }));
  } catch (err) {
    res.status(500).json({ error: t(lang, 'err.clustersFailed', { msg: err.message }) });
  }
});

module.exports = router;
