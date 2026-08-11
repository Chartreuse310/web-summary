/**
 * 轻量柱状图（原生 Canvas，零依赖）
 *
 * 用法：
 *   const chart = new TrendChart(canvasEl);
 *   chart.render(points, { metric, color });
 *   points: [{ date: 'YYYY-MM-DD', tokens, cost, count }, ...]
 */
class TrendChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // 适配高分屏（只做一次，避免重复 new 时反复放大 canvas）
    if (!canvas.dataset.dprReady) {
      this._setupDpr();
      canvas.dataset.dprReady = '1';
    } else {
      // 后续重建：复用首次记录的逻辑尺寸
      this.cssW = Number(canvas.dataset.cssW);
      this.cssH = Number(canvas.dataset.cssH);
    }
  }

  _setupDpr() {
    const dpr = window.devicePixelRatio || 1;
    // 用 getBoundingClientRect 取实际显示尺寸（CSS 像素），
    // 而非 canvas.width 属性（后者会被反复放大，导致每次重渲染都翻倍）
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || 700;
    const cssH = rect.height || 280;
    this.cssW = cssW;
    this.cssH = cssH;
    // 记下来供后续 new TrendChart 复用
    this.canvas.dataset.cssW = String(cssW);
    this.canvas.dataset.cssH = String(cssH);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.scale(dpr, dpr);
  }

  /**
   * 渲染折线图
   * @param {Array} points 数据点
   * @param {object} opts { metric: 'tokens'|'cost'|'count', color }
   */
  render(points, opts = {}) {
    const { ctx, cssW: W, cssH: H } = this;
    const metric = opts.metric || 'tokens';
    const color = opts.color || '#2d5a3d';

    ctx.clearRect(0, 0, W, H);

    if (!points || points.length === 0) {
      return;
    }

    // 填充缺失日期为连续序列（按天）
    const series = this._fillDates(points, metric);
    const values = series.map((p) => p.value);
    const maxV = Math.max(1, ...values);

    // 边距
    const pad = { l: 48, r: 16, t: 16, b: 32 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    // ---- 网格 + Y 轴刻度 ----
    ctx.strokeStyle = '#e0ddd6';
    ctx.fillStyle = '#8a8880';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const y = pad.t + (plotH * i) / ySteps;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      const val = maxV * (1 - i / ySteps);
      ctx.fillText(this._formatVal(val, metric), pad.l - 8, y);
    }

    // ---- X 轴日期标签（最多 6 个）----
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelCount = Math.min(6, series.length);
    const step = Math.max(1, Math.floor(series.length / labelCount));
    for (let i = 0; i < series.length; i += step) {
      const x = pad.l + (plotW * i) / Math.max(1, series.length - 1);
      const label = series[i].date.slice(5); // MM-DD
      ctx.fillText(label, x, H - pad.b + 8);
    }

    // ---- 柱状图 ----
    const barW = series.length > 1 ? Math.max(1, plotW / series.length - 1) : Math.min(plotW * 0.4, 24);
    series.forEach((p, i) => {
      const x = pad.l + (series.length === 1 ? plotW / 2 - barW / 2 : (plotW * i) / series.length + (plotW / series.length - barW) / 2);
      const h = (p.value / maxV) * plotH;
      const y = pad.t + plotH - h;
      // 柱体
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, h);
    });

    // 柱顶数值（仅当柱足够宽时显示，避免拥挤）
    if (barW >= 14) {
      ctx.fillStyle = this._hexA(color, 0.9);
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const labelStep = Math.ceil(series.length / Math.min(12, series.length));
      series.forEach((p, i) => {
        if (i % labelStep !== 0 && i !== series.length - 1) return;
        if (p.value === 0) return;
        const x = pad.l + (plotW * i) / series.length + plotW / series.length / 2;
        const y = pad.t + plotH - (p.value / maxV) * plotH - 2;
        ctx.fillText(this._formatVal(p.value, metric), x, y);
      });
    }
  }

  /**
   * 把数据按天补全（缺失日期填 0），返回 [{date, value}]
   */
  _fillDates(points, metric) {
    if (points.length === 0) return [];
    const map = new Map();
    for (const p of points) {
      map.set(p.date, p[metric] || 0);
    }
    // 日期范围：最早 ~ 今天
    const dates = points.map((p) => p.date).sort();
    const start = dates[0];
    const end = dates[dates.length - 1];
    const out = [];
    const cur = new Date(start + 'T00:00:00');
    const endD = new Date(end + 'T00:00:00');
    while (cur <= endD) {
      const ds = cur.toISOString().slice(0, 10);
      out.push({ date: ds, value: map.has(ds) ? map.get(ds) : 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  _formatVal(v, metric) {
    if (metric === 'cost') return '¥' + (v < 0.01 ? v.toFixed(4) : v.toFixed(2));
    if (metric === 'count') return Math.round(v).toString();
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Math.round(v).toString();
  }

  _hexA(hex, a) {
    // #2d5a3d -> rgba(...)
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}

window.TrendChart = TrendChart;
