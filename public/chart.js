/**
 * 轻量折线图（原生 Canvas，零依赖）
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
    // 适配高分屏
    this._setupDpr();
  }

  _setupDpr() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    // 用属性上的 width/height 作为逻辑尺寸的依据
    const cssW = this.canvas.width || rect.width || 700;
    const cssH = this.canvas.height || rect.height || 280;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
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
    const color = opts.color || '#4f6ef7';

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
    ctx.strokeStyle = '#eef1f6';
    ctx.fillStyle = '#9aa3b5';
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

    // ---- 折线 ----
    if (series.length === 1) {
      // 单点画成圆点
      const x = pad.l + plotW / 2;
      const y = pad.t + plotH - (values[0] / maxV) * plotH;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const xy = series.map((p, i) => {
      const x = pad.l + (plotW * i) / (series.length - 1);
      const y = pad.t + plotH - (p.value / maxV) * plotH;
      return [x, y];
    });

    // 填充渐变
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, this._hexA(color, 0.25));
    grad.addColorStop(1, this._hexA(color, 0));
    ctx.beginPath();
    ctx.moveTo(xy[0][0], pad.t + plotH);
    xy.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(xy[xy.length - 1][0], pad.t + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 线
    ctx.beginPath();
    xy.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 点
    ctx.fillStyle = color;
    xy.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
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
    // #4f6ef7 -> rgba(...)
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}

window.TrendChart = TrendChart;
