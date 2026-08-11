/**
 * 前端交互逻辑
 *
 * 三个 Tab：
 *   1. 生成摘要：输入 URL → AI 生成（含元数据/大纲/tags）→ 一键保存到剪藏库
 *   2. 剪藏库：列表/搜索/筛选/详情/编辑/删除
 *   3. 统计：累计数字 + 30 天趋势图 + 分布
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = (p, opt) => fetch(p, opt).then((r) => r.json().then((d) => ({ ok: r.ok, d })));

  // 把任意形态的 author 归一化成「顿号分隔的字符串」用于展示。
  // 后端按约定返回数组，但若遇到旧数据/异常写入返回裸字符串，这里兜底防止 .join 抛错崩整页。
  const fmtAuthors = (a) => {
    if (Array.isArray(a)) {
      return a.map((x) => (x == null ? '' : String(x))).filter(Boolean).join('、');
    }
    if (typeof a === 'string') return a.trim();
    return '';
  };

  // ============ 全局状态 ============
  const state = {
    providers: [],
    currentResult: null, // 当前 summarize 结果，待保存
    trendMetric: 'tokens',
    trendData: [],
    currentReaderClipping: null, // 当前阅读视图打开的剪藏对象
    isEditing: false,             // 是否处于编辑模式
    editSnapshot: null,           // 编辑前的原始数据快照（用于取消恢复）
    timeFilter: null              // 剪藏库时间聚类筛选 { from, to, label, grp, key }
  };

  // ============ Tab 切换 ============
  function initTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'home') loadHome();
    if (name === 'library') loadLibrary();
    if (name === 'settings') { renderProviderList(); loadStats(); }
  }

  // ============ 工具函数 ============
  function fmtCost(yuan) {
    if (yuan == null) return '未知';
    if (yuan === 0) return '¥0';
    return '¥' + (yuan < 0.01 ? yuan.toFixed(6) : yuan.toFixed(4));
  }
  function fmtNum(n) {
    if (n == null) return '-';
    return Number(n).toLocaleString();
  }
  function fmtDate(iso) {
    if (!iso) return '';
    return iso.slice(0, 10);
  }
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setHidden(el, hidden) {
    if (hidden) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  }

  // ============ 总结 Tab ============
  const urlInput = $('urlInput');
  const providerSelect = $('providerSelect');
  const modelSelect = $('modelSelect');
  const summarizeBtn = $('summarizeBtn');
  const saveBtn = $('saveBtn');

  // ===== 服务商配置（localStorage）=====
  const PROVIDER_KEY = 'web-summary:providers';
  // 预设模板（从后端一次性拉取，做种子）
  let presetTemplates = [];

  function loadProviders() {
    try {
      return JSON.parse(localStorage.getItem(PROVIDER_KEY)) || [];
    } catch {
      return [];
    }
  }
  function saveProviders(list) {
    localStorage.setItem(PROVIDER_KEY, JSON.stringify(list));
  }

  /** 启用的服务商（enabled !== false） */
  function activeProviders() {
    return loadProviders().filter((p) => p.enabled !== false && p.apiKey);
  }

  async function loadConfig() {
    // 拉预设模板（用于设置页「添加」时的快捷选项）
    const { ok, d } = await api('/api/provider-presets');
    if (ok) presetTemplates = d.providers || [];

    refreshProviderSelect();
  }

  /** 刷新「生成摘要」页的服务商/模型下拉 */
  function refreshProviderSelect() {
    const list = activeProviders();
    providerSelect.innerHTML = '';
    modelSelect.innerHTML = '';

    if (list.length === 0) {
      summarizeBtn.disabled = true;
      showError('尚未配置可用的服务商。请到「设置」中添加服务商并填写 API Key。');
      return;
    }
    summarizeBtn.disabled = false;
    setHidden($('errorCard'), true);

    list.forEach((p) => {
      providerSelect.appendChild(new Option(p.name, p.id));
    });
    renderModelsForProvider(list[0]);
    providerSelect.onchange = () => {
      const sel = list.find((p) => p.id === providerSelect.value);
      if (sel) renderModelsForProvider(sel);
    };
  }

  function renderModelsForProvider(p) {
    modelSelect.innerHTML = '';
    const models = p.models || [];
    if (models.length === 0) {
      // 自定义服务商无预设模型 → 提供自由输入
      modelSelect.appendChild(new Option('（请在下方输入模型名）', ''));
      const free = document.createElement('input');
      // 不替换 select；改用一个简单的做法：模型列表为空时仍允许手填
      return;
    }
    models.forEach((m) => {
      if (typeof m === 'string') modelSelect.appendChild(new Option(m, m));
      else if (m?.items) {
        const g = document.createElement('optgroup');
        g.label = m.group;
        m.items.forEach((x) => g.appendChild(new Option(x, x)));
        modelSelect.appendChild(g);
      }
    });
  }

  async function handleSummarize() {
    const url = urlInput.value.trim();
    const list = activeProviders();
    const provider = list.find((p) => p.id === providerSelect.value);
    const model = modelSelect.value;
    if (!url) { showError('请输入要总结的网址'); urlInput.focus(); return; }
    if (!provider) { showError('请先到「设置」配置服务商'); return; }
    if (!model) { showError('请选择或输入模型'); return; }

    summarizeBtn.disabled = true;
    saveBtn.disabled = true;
    setLoading('正在抓取网页…');
    try {
      // 传完整 provider 给后端（含 baseUrl + apiKey），后端无状态转发
      const { ok, d } = await api('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, name: provider.name, models: provider.models },
          model
        })
      });
      if (!ok) throw new Error(d.error || '请求失败');
      renderResult(d);
    } catch (err) {
      showError(err.message);
    } finally {
      summarizeBtn.disabled = false;
      setHidden($('loadingCard'), true);
    }
  }

  function renderResult(d) {
    state.currentResult = d;
    $('resultTitle').textContent = d.title;

    // 元数据
    const metaParts = [];
    const authorText = fmtAuthors(d.author);
    if (authorText) metaParts.push(`作者：${authorText}`);
    if (d.platform) metaParts.push(`平台：${d.platform}`);
    if (d.publishedAt) metaParts.push(`发布：${fmtDate(d.publishedAt)}`);
    metaParts.push(`模型：${d.model}`);
    $('resultMeta').innerHTML = metaParts.map((s) => `<span>${escapeHtml(s)}</span>`).join('');

    // 大纲
    const outlineEl = $('resultOutline');
    if (d.outline?.length) {
      outlineEl.innerHTML = d.outline
        .map((h) => `<div class="${h.level}">${escapeHtml(h.text)}</div>`)
        .join('');
      setHidden($('outlineSection'), false);
    } else {
      setHidden($('outlineSection'), true);
    }

    // 一句话总结
    if (d.oneliner) {
      $('resultOneliner').textContent = d.oneliner;
      setHidden($('onelinerSection'), false);
    } else {
      setHidden($('onelinerSection'), true);
    }

    // 摘要
    $('resultSummary').textContent = d.summary;

    // tags 编辑器
    renderTagEditor(d.tags || []);

    // 用量条
    const u = d.usage;
    const costText = u?.priced ? fmtCost(u.totalCost) : '价格未知';
    $('usageBar').innerHTML = u
      ? `输入 <b>${fmtNum(u.promptTokens)}</b> · 输出 <b>${fmtNum(u.completionTokens)}</b> · 总 <b>${fmtNum(u.totalTokens)}</b> · 费用 <b>${costText}</b>`
      : '';

    $('resultLink').href = d.url;
    saveBtn.disabled = false;
    setHidden($('errorCard'), true);
    setHidden($('loadingCard'), true);
    setHidden($('resultCard'), false);
  }

  function renderTagEditor(tags) {
    const container = $('tagEditor');
    container.innerHTML = '';
    const chips = tags.map((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${escapeHtml(t)} <span class="tag-remove" data-i="${i}">×</span>`;
      return chip;
    });
    chips.forEach((c) => container.appendChild(c));

    const input = document.createElement('input');
    input.className = 'tag-input';
    input.placeholder = '+ 添加标签（回车）';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        const cur = state.currentResult.tags || [];
        if (!cur.includes(input.value.trim())) {
          state.currentResult.tags = [...cur, input.value.trim()];
          renderTagEditor(state.currentResult.tags);
        } else {
          input.value = '';
        }
      }
    });
    container.appendChild(input);

    // 删除
    container.querySelectorAll('.tag-remove').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.i);
        state.currentResult.tags = state.currentResult.tags.filter((_, idx) => idx !== i);
        renderTagEditor(state.currentResult.tags);
      });
    });
  }

  async function handleSave() {
    if (!state.currentResult) return;
    const d = state.currentResult;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const u = d.usage || {};
      const { ok, d: resp } = await api('/api/clippings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: d.url,
          title: d.title,
          author: d.author,
          platform: d.platform,
          publishedAt: d.publishedAt,
          outline: d.outline,
          summary: d.summary,
          oneliner: d.oneliner,
          tags: d.tags,
          model: d.model,
          promptTokens: u.promptTokens,
          completionTokens: u.completionTokens,
          totalTokens: u.totalTokens,
          cost: u.priced ? u.totalCost : 0,
          contentText: d.contentText,
          contentHtml: d.contentHtml
        })
      });
      if (!ok) throw new Error(resp.error || '保存失败');
      saveBtn.textContent = '已保存';
      setTimeout(() => {
        saveBtn.textContent = '保存到剪藏库';
        saveBtn.disabled = false;
        closeSummarizeModal();
        // 刷新首页计数 / 剪藏库（若当前停留）
        loadHome();
        if ($('panel-library').classList.contains('active')) loadLibrary();
      }, 1000);
    } catch (err) {
      alert(err.message);
      saveBtn.textContent = '保存到剪藏库';
      saveBtn.disabled = false;
    }
  }

  function setLoading(text) {
    $('loadingText').textContent = text;
    setHidden($('loadingCard'), false);
    setHidden($('errorCard'), true);
    setHidden($('resultCard'), true);
  }
  function showError(msg) {
    $('errorText').textContent = msg;
    setHidden($('errorCard'), false);
    setHidden($('loadingCard'), true);
    setHidden($('resultCard'), true);
  }

  // ===== 添加剪藏浮窗开关 =====
  function openSummarizeModal() {
    // 重置为初始状态
    setHidden($('resultCard'), true);
    setHidden($('loadingCard'), true);
    setHidden($('errorCard'), true);
    urlInput.value = '';
    saveBtn.textContent = '保存到剪藏库';
    saveBtn.disabled = true;
    refreshProviderSelect();
    setHidden($('summarizeModal'), false);
    setTimeout(() => urlInput.focus(), 50);
  }
  function closeSummarizeModal() {
    setHidden($('summarizeModal'), true);
  }

  // ============ 剪藏库 Tab ============
  const libraryList = $('libraryList');
  const searchInput = $('searchInput');
  const tagFilter = $('tagFilter');
  const sortBy = $('sortBy');

  async function loadLibrary() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (tagFilter.value) params.set('tag', tagFilter.value);
    if (sortBy.value) params.set('sort', sortBy.value);
    if (state.timeFilter) {
      params.set('from', state.timeFilter.from);
      params.set('to', state.timeFilter.to);
    }
    const [listRes, statsRes, clustersRes] = await Promise.all([
      api('/api/clippings?' + params.toString()),
      api('/api/stats'),
      api('/api/stats/clusters')
    ]);
    if (!listRes.ok) { libraryList.innerHTML = '<p class="empty-hint">加载失败</p>'; return; }
    renderLibrary(listRes.d.items);
    refreshTagFilter();
    if (statsRes.ok) renderLibraryRails(statsRes.d);
    if (clustersRes.ok) renderTimeClusters(clustersRes.d);
  }

  function renderLibrary(items) {
    if (!items.length) {
      libraryList.innerHTML = '<p class="empty-hint">暂无剪藏，去「生成摘要」保存第一篇吧</p>';
      return;
    }
    const maxTokens = Math.max(...items.map((it) => it.totalTokens || 0), 1);
    libraryList.innerHTML = items
      .map((it, i) => {
        const meta = [
          it.platform && escapeHtml(it.platform),
          escapeHtml(fmtAuthors(it.author)),
          it.publishedAt && fmtDate(it.publishedAt),
          fmtDate(it.savedAt) && `收藏于 ${fmtDate(it.savedAt)}`
        ].filter(Boolean).join(' · ');
        const tagsHtml = (it.tags || [])
          .slice(0, 5)
          .map((t) => `<span class="clip-tag">${escapeHtml(t)}</span>`)
          .join('');
        const pct = ((it.totalTokens || 0) / maxTokens) * 100;
        const num = String(i + 1).padStart(2, '0');
        return `
          <div class="clip-item" data-id="${it.id}">
            <span class="clip-rank">${num}</span>
            <div class="clip-main">
              <div class="clip-title">${escapeHtml(it.title)}</div>
              <div class="clip-meta">${meta}</div>
              ${it.oneliner ? `<div class="clip-oneliner">${escapeHtml(it.oneliner)}</div>` : ''}
              <div class="clip-footer">
                <div class="clip-tags">${tagsHtml}</div>
                <div class="clip-stats">
                  <span class="model-badge">${escapeHtml(it.model)}</span>
                  · ${fmtNum(it.totalTokens)} tok · ${fmtCost(it.cost)}
                </div>
              </div>
              <div class="clip-usage-bar"><div class="clip-usage-fill" style="width:${pct}%"></div></div>
            </div>
          </div>`;
      })
      .join('');

    libraryList.querySelectorAll('.clip-item').forEach((el) => {
      el.addEventListener('click', () => openDetail(Number(el.dataset.id)));
    });
  }

  async function refreshTagFilter() {
    const { ok, d } = await api('/api/stats');
    if (!ok) return;
    const cur = tagFilter.value;
    tagFilter.innerHTML = '<option value="">全部标签</option>';
    (d.topTags || []).forEach(({ tag, count }) => {
      tagFilter.appendChild(new Option(`${tag} (${count})`, tag));
    });
    if (cur) tagFilter.value = cur;
  }

  // ===== 时间聚类渲染 + 筛选（剪藏库左栏）=====

  function renderTimeClusters(clusters) {
    const wrap = $('timeClusters');
    const groups = [
      { grp: '按年', title: '按年', items: clusters.byYear, fmt: (k) => k + ' 年' },
      { grp: '按月', title: '按月', items: clusters.byMonth, fmt: (k) => k },
      { grp: '按周', title: '按周', items: clusters.byWeek, fmt: (k) => fmtWeekLabel(k) },
      { grp: '按日', title: '按日', items: clusters.byDay, fmt: (k) => k.slice(5) }
    ];
    wrap.innerHTML = groups
      .map((g) => {
        if (!g.items || !g.items.length) return '';
        const itemsHtml = g.items
          .slice(0, 12)
          .map((it) => {
            const active = state.timeFilter && state.timeFilter.grp === g.grp && state.timeFilter.key === it.key ? ' active' : '';
            return '<div class="cluster-item' + active + '" data-grp="' + g.grp + '" data-key="' + escapeHtml(it.key) + '">' +
              '<span>' + escapeHtml(g.fmt(it.key)) + '</span>' +
              '<span class="cluster-count">' + it.count + '</span></div>';
          })
          .join('');
        return '<div><div class="cluster-group-title">' + g.title + '</div><div class="cluster-items">' + itemsHtml + '</div></div>';
      })
      .join('');

    wrap.querySelectorAll('.cluster-item').forEach((el) => {
      el.addEventListener('click', () => applyTimeFilter(el.dataset.grp, el.dataset.key));
    });
  }

  /** 周 key（周一日期 YYYY-MM-DD）→ "MM-DD ~ MM-DD" 友好标签 */
  function fmtWeekLabel(key) {
    const start = new Date(key + 'T00:00:00');
    const end = new Date(start.getTime() + 6 * 86400000);
    return pad2(start.getMonth() + 1) + '-' + pad2(start.getDate()) + ' ~ ' + pad2(end.getMonth() + 1) + '-' + pad2(end.getDate());
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function applyTimeFilter(grp, key) {
    let from, to, label;
    if (grp === '按年') {
      from = key + '-01-01';
      to = (Number(key) + 1) + '-01-01';
      label = key + ' 年';
    } else if (grp === '按月') {
      const [y, m] = key.split('-');
      const ny = Number(y), nm = Number(m);
      from = key + '-01';
      const nextM = nm === 12 ? (ny + 1) + '-01' : ny + '-' + pad2(nm + 1);
      to = nextM + '-01';
      label = key;
    } else if (grp === '按周') {
      from = key;
      const end = new Date(new Date(key + 'T00:00:00').getTime() + 7 * 86400000);
      to = end.toISOString().slice(0, 10);
      label = fmtWeekLabel(key);
    } else {
      // 按日
      from = key;
      const end = new Date(new Date(key + 'T00:00:00').getTime() + 86400000);
      to = end.toISOString().slice(0, 10);
      label = key;
    }

    state.timeFilter = { from, to, label, grp, key };

    const badge = $('timeFilterBadge');
    badge.innerHTML = '时间筛选：' + escapeHtml(label) + ' <span class="clear-time" title="清除筛选">×</span>';
    setHidden(badge, false);
    badge.querySelector('.clear-time').addEventListener('click', clearTimeFilter);

    document.querySelectorAll('.cluster-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.grp === grp && el.dataset.key === key);
    });
    loadLibrary();
  }

  function clearTimeFilter() {
    state.timeFilter = null;
    setHidden($('timeFilterBadge'), true);
    document.querySelectorAll('.cluster-item').forEach((el) => el.classList.remove('active'));
    loadLibrary();
  }

  // ===== 剪藏库右栏：标签 / 作者排行 =====

  function renderLibraryRails(stats) {
    const tags = (stats.topTags || []).slice(0, 12);
    $('libTagRank').innerHTML = tags.length
      ? tags.map((t) => '<div class="rank-row-mini" data-tag="' + escapeHtml(t.tag) + '" title="点击按此标签筛选"><span class="rname">' + escapeHtml(t.tag) + '</span><span class="rcount">' + t.count + '</span></div>').join('')
      : '<p class="empty-hint">暂无标签</p>';

    const authors = (stats.byAuthor || []).slice(0, 12);
    $('libAuthorRank').innerHTML = authors.length
      ? authors.map((a) => '<div class="rank-row-mini" data-author="' + escapeHtml(a.author) + '" title="点击搜索该作者"><span class="rname">' + escapeHtml(a.author) + '</span><span class="rcount">' + a.count + '</span></div>').join('')
      : '<p class="empty-hint">暂无作者</p>';

    $('libTagRank').querySelectorAll('.rank-row-mini').forEach((el) => {
      el.addEventListener('click', () => {
        tagFilter.value = el.dataset.tag;
        loadLibrary();
      });
    });
    $('libAuthorRank').querySelectorAll('.rank-row-mini').forEach((el) => {
      el.addEventListener('click', () => {
        searchInput.value = el.dataset.author;
        loadLibrary();
      });
    });
  }

  // ============ 阅读页（三栏视图）============

  async function openDetail(id) {
    const { ok, d } = await api('/api/clippings/' + id);
    if (!ok) { alert(d.error || '加载失败'); return; }

    state.currentReaderClipping = d;

    // 隐藏主容器，显示阅读页
    setHidden(document.querySelector('.container'), true);
    setHidden($('readerView'), false);

    // ---- 头部 ----
    $('readerTitle').textContent = d.title;

    // ---- 右栏：文章信息（平台/作者/发布/收藏）----
    const authorText = fmtAuthors(d.author);
    const metaParts = [
      d.platform && escapeHtml(d.platform),
      authorText && escapeHtml('作者：' + authorText),
      d.publishedAt && escapeHtml('发布：' + fmtDate(d.publishedAt)),
      escapeHtml('收藏：' + fmtDate(d.savedAt))
    ].filter(Boolean);
    $('readerMeta').innerHTML = metaParts.map((s) => '<span>' + s + '</span>').join('');

    // 删除按钮
    setHidden($('readerDelete'), false);

    // ---- 中栏：全文（先渲染，TOC 依赖中栏 DOM）----
    renderReaderArticle(d);

    // ---- 左栏：目录 ----
    buildReaderToc(d);

    // ---- 右栏：一句话总结 ----
    if (d.oneliner) {
      $('readerOneliner').textContent = d.oneliner;
      setHidden($('readerOnelinerBlock'), false);
    } else {
      setHidden($('readerOnelinerBlock'), true);
    }

    // ---- 右栏：摘要 ----
    $('readerSummary').textContent = d.summary;

    // ---- 右栏：标签（可编辑）----
    renderReaderTags(d);

    // ---- 右栏：模型与用量 ----
    const costText = d.cost ? fmtCost(d.cost) : '¥0';
    $('readerUsage').innerHTML =
      '<div>模型：<b>' + escapeHtml(d.model) + '</b></div>' +
      '<div>输入 <b>' + fmtNum(d.promptTokens) + '</b> · 输出 <b>' + fmtNum(d.completionTokens) + '</b> · 总 <b>' + fmtNum(d.totalTokens) + '</b></div>' +
      '<div>费用：<b>' + costText + '</b></div>';

    // ---- 右栏：原文链接 ----
    $('readerLink').href = d.url;

    // 存储 id 供删除使用
    $('readerView').dataset.clippingId = String(id);

    // 滚动到顶部
    $('readerArticle').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /**
   * 渲染中栏全文，含旧剪藏降级处理
   * - 有 contentHtml：直接渲染安全 HTML（后端已白名单清洗）
   * - 无 contentHtml 但有 contentText：显示纯文本 + 降级提示
   * - 两者都无：显示提示信息
   */
  function renderReaderArticle(d) {
    const article = $('readerArticle');

    if (d.contentHtml && d.contentHtml.trim()) {
      article.innerHTML = d.contentHtml;
    } else if (d.contentText && d.contentText.trim()) {
      article.innerHTML =
        '<div class="reader-fallback-notice">该剪藏为旧版本保存，未保留全文格式，以下为纯文本内容。</div>' +
        '<div class="reader-plaintext">' + escapeHtml(d.contentText) + '</div>';
    } else {
      article.innerHTML =
        '<div class="reader-fallback-notice">该剪藏未保留全文内容。</div>';
    }
  }

  /**
   * 构建左栏目录（TOC）
   * 1. 优先从中栏 DOM 的 H1-H4 标签构建可点击 TOC → scrollIntoView 平滑滚动
   * 2. DOM 无足够标题但 outline 字段有数据 → 降级为静态目录
   * 3. 两者都无 → 隐藏左栏
   */
  function buildReaderToc(d) {
    const article = $('readerArticle');
    const toc = $('readerToc');
    const tocWrap = $('readerTocWrap');
    const headings = article.querySelectorAll('h1, h2, h3, h4');

    if (headings.length >= 2) {
      setHidden(tocWrap, false);
      toc.innerHTML = '';
      const usedIds = new Set();

      headings.forEach((h, i) => {
        // 确保每个标题有唯一 id
        let id = h.id;
        if (!id) {
          const text = (h.textContent || '').trim().slice(0, 40);
          id = 'h-' + text.replace(/[^\w\u4e00-\u9fa5]+/g, '-').toLowerCase().replace(/^-|-$/g, '') || 'heading-' + i;
          h.id = id;
        }
        if (usedIds.has(id)) {
          id = id + '-' + i;
          h.id = id;
        }
        usedIds.add(id);

        const level = h.tagName.toLowerCase();
        const link = document.createElement('a');
        link.href = '#' + id;
        link.className = 'toc-link ' + level;
        link.textContent = (h.textContent || '').trim().slice(0, 50);
        link.addEventListener('click', (e) => {
          e.preventDefault();
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        toc.appendChild(link);
      });
    } else if (d.outline && d.outline.length >= 2) {
      // 降级：静态目录（不可点击，仅参考）
      setHidden(tocWrap, false);
      toc.innerHTML = d.outline
        .map((h) => '<div class="toc-static ' + h.level + '">' + escapeHtml(h.text) + '</div>')
        .join('');
    } else {
      setHidden(tocWrap, true);
      toc.innerHTML = '';
    }
  }

  /**
   * 渲染右栏标签编辑器，增删标签即时 PUT 到后端
   */
  function renderReaderTags(clipping) {
    const container = $('readerTags');
    container.innerHTML = '';

    (clipping.tags || []).forEach((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = escapeHtml(t) + ' <span class="tag-remove" data-i="' + i + '">×</span>';
      container.appendChild(chip);
    });

    const input = document.createElement('input');
    input.className = 'tag-input';
    input.placeholder = '+ 添加（回车）';
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const newTag = input.value.trim();
        const tags = clipping.tags || [];
        if (!tags.includes(newTag)) {
          tags.push(newTag);
          const { ok } = await api('/api/clippings/' + clipping.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags })
          });
          if (ok) {
            clipping.tags = tags;
            renderReaderTags(clipping);
          }
        } else {
          input.value = '';
        }
      }
    });
    container.appendChild(input);

    container.querySelectorAll('.tag-remove').forEach((el) => {
      el.addEventListener('click', async () => {
        const i = Number(el.dataset.i);
        const tags = clipping.tags.filter((_, idx) => idx !== i);
        const { ok } = await api('/api/clippings/' + clipping.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags })
        });
        if (ok) { clipping.tags = tags; renderReaderTags(clipping); }
      });
    });
  }

  // ============ 编辑模式 ============

  /**
   * 进入编辑模式
   * 1. 快照原始数据供取消恢复
   * 2. article / oneliner / summary 设为 contentEditable
   * 3. 旧剪藏降级处理：纯文本包装为 <p>
   * 4. 切换按钮 + 显示工具栏
   */
  function enterEditMode() {
    const d = state.currentReaderClipping;
    if (!d) return;

    state.isEditing = true;

    // 快照原始数据
    state.editSnapshot = {
      contentHtml: d.contentHtml,
      oneliner: d.oneliner,
      summary: d.summary,
      onelinerBlockHidden: $('readerOnelinerBlock').hasAttribute('hidden')
    };

    const article = $('readerArticle');

    // 旧剪藏降级处理：如果当前显示的是纯文本降级内容，转换为可编辑的 <p> 段落
    const fallbackNotice = article.querySelector('.reader-fallback-notice');
    if (fallbackNotice) {
      const plaintext = article.querySelector('.reader-plaintext');
      const text = plaintext ? plaintext.textContent : '';
      const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
      article.innerHTML = paragraphs.length
        ? paragraphs.map((p) => '<p>' + escapeHtml(p.trim()) + '</p>').join('')
        : '<p>（空内容）</p>';
    }

    // 启用 contentEditable
    article.contentEditable = 'true';
    article.classList.add('editing');
    article.setAttribute('data-placeholder', '正文内容为空，点击此处开始编辑');

    // 一句话总结：显示 block（即使为空）+ 可编辑
    setHidden($('readerOnelinerBlock'), false);
    const onelinerEl = $('readerOneliner');
    onelinerEl.contentEditable = 'true';
    onelinerEl.classList.add('editing');
    onelinerEl.setAttribute('data-placeholder', '点击编辑一句话总结…');

    // 摘要：可编辑
    const summaryEl = $('readerSummary');
    summaryEl.contentEditable = 'true';
    summaryEl.classList.add('editing');
    summaryEl.setAttribute('data-placeholder', '点击编辑摘要…');

    // 切换按钮
    setHidden($('readerEdit'), true);
    setHidden($('readerSave'), false);
    setHidden($('readerCancel'), false);
    setHidden($('readerDelete'), true);
    setHidden($('readerToolbar'), false);

    // 聚焦到正文
    article.focus();
  }

  /**
   * 退出编辑模式（仅切换 UI 状态，不恢复数据）
   */
  function exitEditMode() {
    state.isEditing = false;
    state.editSnapshot = null;

    const article = $('readerArticle');
    article.contentEditable = 'false';
    article.classList.remove('editing');
    article.removeAttribute('data-placeholder');

    const onelinerEl = $('readerOneliner');
    onelinerEl.contentEditable = 'false';
    onelinerEl.classList.remove('editing');
    onelinerEl.removeAttribute('data-placeholder');

    const summaryEl = $('readerSummary');
    summaryEl.contentEditable = 'false';
    summaryEl.classList.remove('editing');
    summaryEl.removeAttribute('data-placeholder');

    // 切换按钮
    setHidden($('readerEdit'), false);
    setHidden($('readerSave'), true);
    setHidden($('readerCancel'), true);
    setHidden($('readerDelete'), false);
    setHidden($('readerToolbar'), true);
  }

  /**
   * 将光标所在块级元素转换为指定标签（H1/H2/H3/H4/P）
   */
  function handleHeadingFormat(tag) {
    document.execCommand('formatBlock', false, tag);
    // 转换后重建 TOC
    buildReaderToc(state.currentReaderClipping);
  }

  /**
   * 从中栏 DOM 提取 outline 数组 [{level, text}]
   * 与后端 extractOutline 逻辑一致
   */
  function extractOutlineFromDom() {
    const article = $('readerArticle');
    const headings = article.querySelectorAll('h1, h2, h3, h4');
    const outline = [];
    const seen = new Set();

    headings.forEach((h) => {
      const text = (h.textContent || '').trim();
      if (!text || text.length > 80) return;
      const level = h.tagName.toLowerCase();
      const key = level + '|' + text;
      if (seen.has(key)) return;
      seen.add(key);
      outline.push({ level, text });
    });

    return outline;
  }

  /**
   * 保存编辑结果
   * 收集 contentHtml / contentText / oneliner / summary / outline → PUT
   */
  async function handleReaderSave() {
    const d = state.currentReaderClipping;
    if (!d) return;

    const article = $('readerArticle');
    const saveBtn = $('readerSave');

    const payload = {
      contentHtml: article.innerHTML,
      contentText: article.textContent.trim(),
      oneliner: $('readerOneliner').textContent.trim(),
      summary: $('readerSummary').textContent.trim(),
      outline: extractOutlineFromDom()
    };

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';

    try {
      const { ok, d: resp } = await api('/api/clippings/' + d.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!ok) throw new Error(resp.error || '保存失败');

      // 用后端返回值更新 state（含 re-sanitized contentHtml）
      state.currentReaderClipping = resp;

      exitEditMode();

      // 重新渲染正文（用后端 re-sanitize 后的 contentHtml）
      renderReaderArticle(resp);
      buildReaderToc(resp);

      // 更新一句话总结显示
      if (resp.oneliner) {
        $('readerOneliner').textContent = resp.oneliner;
        setHidden($('readerOnelinerBlock'), false);
      } else {
        setHidden($('readerOnelinerBlock'), true);
      }

      // 更新摘要显示
      $('readerSummary').textContent = resp.summary;

      // 刷新列表
      loadLibrary();
    } catch (err) {
      alert(err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  }

  /**
   * 取消编辑，恢复原始数据
   */
  function handleReaderCancel() {
    const snap = state.editSnapshot;
    const d = state.currentReaderClipping;
    if (!snap || !d) {
      exitEditMode();
      return;
    }

    // 恢复正文
    d.contentHtml = snap.contentHtml;
    renderReaderArticle(d);

    // 恢复一句话总结
    d.oneliner = snap.oneliner;
    $('readerOneliner').textContent = snap.oneliner || '';
    setHidden($('readerOnelinerBlock'), snap.onelinerBlockHidden);

    // 恢复摘要
    d.summary = snap.summary;
    $('readerSummary').textContent = snap.summary || '';

    // 重建目录
    buildReaderToc(d);

    exitEditMode();
  }

  /**
   * 关闭阅读页，返回剪藏库
   */
  function closeReader() {
    if (state.isEditing) {
      exitEditMode();
    }
    setHidden($('readerView'), true);
    setHidden(document.querySelector('.container'), false);
    $('readerArticle').innerHTML = '';
    state.currentReaderClipping = null;
  }

  /**
   * 删除当前阅读页的剪藏
   */
  async function handleReaderDelete() {
    const id = Number($('readerView').dataset.clippingId);
    if (!id) return;
    if (!confirm('确定删除这条剪藏？此操作不可撤销。')) return;
    const { ok, d } = await api('/api/clippings/' + id, { method: 'DELETE' });
    if (!ok) { alert(d.error || '删除失败'); return; }
    closeReader();
    loadLibrary();
  }

  // ============ 首页 Tab ============
  async function loadHome() {
    const [{ ok: okStats, d: stats }, { ok: okTrend, d: trend }, { ok: okRecent, d: recent }] =
      await Promise.all([
        api('/api/stats'),
        api('/api/stats/trend?days=365'),
        api('/api/clippings?sort=recent&limit=20')
      ]);
    if (!okStats || !okTrend || !okRecent) {
      $('homeOneliner').textContent = '数据加载失败，请稍后重试。';
      return;
    }
    renderHomeStats(stats);
    renderHomeTagCloud(stats.topTags || []);
    renderHomeOneliner(trend, recent.items || []);
    renderHomeRecent(recent.items || []);
    renderHeatmap(trend);
  }

  function renderHomeStats(stats) {
    $('homeCount').textContent = fmtNum(stats.count);
    $('homeTags').textContent = fmtNum(stats.distinctTags ?? 0);
    $('homeTokens').textContent = fmtNum(stats.totalTokens);
  }

  /** 标签云：频次越高字号越大（12px ~ 26px，5 级映射），点击跳转剪藏库筛选 */
  function renderHomeTagCloud(tags) {
    const wrap = $('homeTagCloud');
    if (!tags || !tags.length) {
      wrap.innerHTML = '<p class="empty-hint">暂无标签</p>';
      return;
    }
    const counts = tags.map((t) => t.count);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    wrap.innerHTML = tags
      .map((t) => {
        const ratio = max === min ? 0.5 : (t.count - min) / (max - min);
        const size = (12 + ratio * 14).toFixed(1);
        return '<span class="freq-tag" style="font-size:' + size + 'px" data-tag="' + escapeHtml(t.tag) + '" title="' + t.count + ' 篇">' + escapeHtml(t.tag) + '</span>';
      })
      .join('');
    wrap.querySelectorAll('.freq-tag').forEach((el) => {
      el.addEventListener('click', () => {
        switchTab('library');
        tagFilter.value = el.dataset.tag;
        loadLibrary();
      });
    });
  }

  // 智能聚合「一句话总结近期在看」（零 LLM，纯前端模板生成）
  function renderHomeOneliner(trend, recentItems) {
    const now = new Date();
    const sevenAgo = new Date(now.getTime() - 7 * 86400000);

    // 近 7 天篇数 / token（权威，来自逐日趋势）
    const inLast7 = trend.filter((d) => new Date(d.date + 'T00:00:00Z') >= sevenAgo);
    const n7 = inLast7.reduce((s, d) => s + (d.count || 0), 0);
    const tok7 = inLast7.reduce((s, d) => s + (d.tokens || 0), 0);

    // 近 7 天标签（来自近期剪藏样本）
    const tagFreq = {};
    recentItems
      .filter((it) => new Date(it.savedAt) >= sevenAgo)
      .forEach((it) => (it.tags || []).forEach((t) => { tagFreq[t] = (tagFreq[t] || 0) + 1; }));
    const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

    let text;
    if (n7 === 0) {
      text = '最近一周还没有新的收藏。去「生成摘要」捕捉下一篇值得留存的内容吧。';
    } else if (topTags.length) {
      const tagList = topTags.map((t) => '「' + t + '」').join('、');
      text = '近 7 天收藏了 ' + n7 + ' 篇，主要围绕 ' + tagList + ' 等主题。';
      if (tok7 > 0) text += '累计消耗约 ' + fmtNum(tok7) + ' tokens。';
    } else {
      text = '近 7 天收藏了 ' + n7 + ' 篇，尚未添加标签。';
    }
    $('homeOneliner').textContent = text;
  }

  function renderHomeRecent(items) {
    const wrap = $('homeRecent');
    const top3 = items.slice(0, 3);
    if (!top3.length) {
      wrap.innerHTML = '<p class="empty-hint">暂无剪藏，去「生成摘要」保存第一篇吧</p>';
      return;
    }
    wrap.innerHTML = top3
      .map((it, i) => {
        const meta = [
          it.platform && escapeHtml(it.platform),
          escapeHtml(fmtAuthors(it.author)),
          fmtDate(it.savedAt) && ('收藏于 ' + fmtDate(it.savedAt))
        ].filter(Boolean).join(' · ');
        const num = String(i + 1).padStart(2, '0');
        return '<div class="clip-item" data-id="' + it.id + '">' +
          '<span class="clip-rank">' + num + '</span>' +
          '<div class="clip-main">' +
          '<div class="clip-title">' + escapeHtml(it.title) + '</div>' +
          '<div class="clip-meta">' + meta + '</div>' +
          (it.oneliner ? '<div class="clip-oneliner">' + escapeHtml(it.oneliner) + '</div>' : '') +
          '</div></div>';
      })
      .join('');
    wrap.querySelectorAll('.clip-item').forEach((el) => {
      el.addEventListener('click', () => openDetail(Number(el.dataset.id)));
    });
  }

  // GitHub 风格贡献热力图（近 365 天，CSS Grid 7×N，无库）
  function renderHeatmap(trend) {
    const map = {};
    trend.forEach((d) => { map[d.date] = d; });
    const maxCount = Math.max(1, ...trend.map((d) => d.count || 0));

    const today = new Date();
    const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    // 起点：today-364 天所在周的周日（GitHub 惯例 Sun-start）
    let start = new Date(todayUTC - 364 * 86400000);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());

    const todayKey = new Date(todayUTC).toISOString().slice(0, 10);
    const cells = [];
    const cursor = new Date(start);
    const band = Math.max(1, Math.ceil(maxCount / 4));
    while (cursor.getTime() <= todayUTC) {
      const key = cursor.toISOString().slice(0, 10);
      const c = (map[key] && map[key].count) || 0;
      const level = c === 0 ? 0 : Math.min(4, Math.ceil(c / band));
      cells.push('<span class="heat-cell heat-L' + level + (key === todayKey ? ' today' : '') + '" data-date="' + key + '" data-count="' + c + '"></span>');
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    $('homeHeatmap').innerHTML = cells.join('');
    bindHeatTooltip();
  }

  // 热力图自定义悬停提示（跟随鼠标，显示日期与篇数）
  let heatTooltip = null;
  let heatTooltipBound = false;
  function bindHeatTooltip() {
    const grid = $('homeHeatmap');
    if (heatTooltipBound) return;
    heatTooltipBound = true;
    if (!heatTooltip) {
      heatTooltip = document.createElement('div');
      heatTooltip.className = 'heat-tooltip';
      document.body.appendChild(heatTooltip);
    }
    grid.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.heat-cell');
      if (!cell) return;
      const date = cell.dataset.date;
      const count = Number(cell.dataset.count);
      heatTooltip.textContent = count === 0 ? (date + '：无收藏') : (date + '：' + count + ' 篇');
      heatTooltip.classList.add('show');
    });
    grid.addEventListener('mousemove', (e) => {
      if (!heatTooltip.classList.contains('show')) return;
      heatTooltip.style.left = (e.clientX + 14) + 'px';
      heatTooltip.style.top = (e.clientY + 14) + 'px';
    });
    grid.addEventListener('mouseleave', () => {
      heatTooltip.classList.remove('show');
    });
  }

  // ============ 统计 Tab ============
  async function loadStats() {
    const [{ ok: okStats, d: stats }, { ok: okTrend, d: trend }] = await Promise.all([
      api('/api/stats'),
      api('/api/stats/trend?days=30')
    ]);
    if (!okStats || !okTrend) return;

    $('bigCount').textContent = fmtNum(stats.count);
    $('bigTokens').textContent = fmtNum(stats.totalTokens);
    $('bigCost').textContent = fmtCost(stats.totalCost);

    // 趋势图
    state.trendData = trend;
    drawTrend();

    // 模型分布
    $('byModel').innerHTML = renderDist(stats.byModel, 'totalTokens', 'count');
    // 平台分布
    $('byPlatform').innerHTML = renderDist(stats.byPlatform, 'count', 'count');
    // 作者分布
    $('byAuthor').innerHTML = renderDist(stats.byAuthor, 'count', 'count');
  }

  function renderDist(rows, valKey, _countKey) {
    if (!rows?.length) return '<p class="empty-hint">暂无数据</p>';
    const max = Math.max(...rows.map((r) => r[valKey] || 0), 1);
    return rows
      .map((r, i) => {
        const name = escapeHtml(r.model || r.platform || r.author || '未知');
        const val = r[valKey] || 0;
        const pct = (val / max) * 100;
        const valText = valKey === 'totalTokens' ? fmtNum(val) + ' tok' : val + ' 篇';
        const num = String(i + 1).padStart(2, '0');
        return `<div class="rank-row"><div class="rank-bar" style="width:${pct}%"></div><span class="rank-num">${num}</span><span class="rank-name">${name}</span><span class="rank-count">${valText}</span></div>`;
      })
      .join('');
  }

  function drawTrend() {
    const canvas = $('trendChart');
    const empty = $('chartEmpty');
    if (!state.trendData.length) {
      setHidden(canvas, true);
      setHidden(empty, false);
      return;
    }
    setHidden(canvas, false);
    setHidden(empty, true);
    const colors = { tokens: '#2d5a3d', cost: '#8b7355', count: '#db3d43' };
    const chart = new TrendChart(canvas);
    chart.render(state.trendData, { metric: state.trendMetric, color: colors[state.trendMetric] });
  }

  // ============ 设置页：服务商 CRUD ============
  const providerList = $('providerList');
  const providerModal = $('providerModal');
  let editingProviderId = null; // null=新增，非null=编辑

  function renderProviderList() {
    const list = loadProviders();
    if (list.length === 0) {
      providerList.innerHTML = '<p class="empty-providers">还没有服务商。点「+ 添加服务商」开始配置。</p>';
      return;
    }
    providerList.innerHTML = list
      .map((p) => {
        const modelCount = Array.isArray(p.models) ? p.models.length : 0;
        const keyMasked = p.apiKey ? p.apiKey.slice(0, 4) + '••••' + p.apiKey.slice(-4) : '未填';
        return `
          <div class="provider-item ${p.enabled === false ? 'disabled' : ''}" data-id="${p.id}">
            <button class="provider-toggle ${p.enabled !== false ? 'on' : ''}" data-act="toggle"></button>
            <div class="provider-info">
              <div class="provider-name">${escapeHtml(p.name)} ${p.preset ? '<span class="model-badge">预设</span>' : ''}</div>
              <div class="provider-meta">${escapeHtml(p.baseUrl)} · Key: ${escapeHtml(keyMasked)} · ${modelCount} 个模型</div>
            </div>
            <div class="provider-actions">
              <button data-act="edit">编辑</button>
              <button data-act="delete" class="btn-del">删除</button>
            </div>
          </div>`;
      })
      .join('');

    providerList.querySelectorAll('.provider-item').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('[data-act="toggle"]').addEventListener('click', () => toggleProvider(id));
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openProviderModal(id));
      el.querySelector('[data-act="delete"]').addEventListener('click', () => deleteProvider(id));
    });
  }

  function toggleProvider(id) {
    const list = loadProviders();
    const p = list.find((x) => x.id === id);
    if (!p) return;
    p.enabled = p.enabled === false ? true : false;
    saveProviders(list);
    renderProviderList();
    refreshProviderSelect();
  }

  function deleteProvider(id) {
    if (!confirm('确定删除该服务商配置？')) return;
    saveProviders(loadProviders().filter((x) => x.id !== id));
    renderProviderList();
    refreshProviderSelect();
  }

  function openProviderModal(id) {
    editingProviderId = id || null;
    $('providerModalTitle').textContent = id ? '编辑服务商' : '添加服务商';

    // 默认值：新增时若有预设，预填第一个预设
    let p = { name: '', baseUrl: '', apiKey: '', models: [], testModel: '' };
    if (id) {
      p = { ...p, ...loadProviders().find((x) => x.id === id) };
    } else if (presetTemplates.length > 0) {
      const t = presetTemplates[0];
      const flat = (t.models || []).flatMap((m) => (typeof m === 'string' ? [m] : m.items || []));
      p = { name: t.name, baseUrl: t.baseUrl, apiKey: '', models: flat, testModel: flat[0] || '', preset: true, presetId: t.id };
    }

    $('pfName').value = p.name || '';
    $('pfBaseUrl').value = p.baseUrl || '';
    $('pfApiKey').value = p.apiKey || '';
    $('pfModels').value = (p.models || []).join(', ');
    $('pfTestModel').value = p.testModel || '';
    $('pfTestResult').textContent = '';
    $('pfTestResult').className = 'pf-test-result';

    // 预设快捷选择（仅新增时）
    renderPresetChips();
    setHidden(providerModal, false);
  }

  function renderPresetChips() {
    // 在名称输入框上方放预设快捷按钮（简化：若有多个预设，添加时让用户点选）
    // 这里用简单实现：新增时自动填第一个，用户可改
  }

  function closeProviderModal() {
    setHidden(providerModal, true);
    editingProviderId = null;
  }

  async function testProviderConnection() {
    const baseUrl = $('pfBaseUrl').value.trim();
    const apiKey = $('pfApiKey').value.trim();
    const model = $('pfTestModel').value.trim() || ($('pfModels').value.split(',')[0] || '').trim();
    const result = $('pfTestResult');
    if (!baseUrl || !apiKey || !model) {
      result.textContent = '请先填 Base URL、API Key 和测试模型';
      result.className = 'pf-test-result fail';
      return;
    }
    result.textContent = '测试中…';
    result.className = 'pf-test-result';
    const { ok, d } = await api('/api/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, model })
    });
    if (ok && d.ok) {
      result.textContent = d.message;
      result.className = 'pf-test-result ok';
    } else {
      result.textContent = (d?.message || d?.error || '测试失败');
      result.className = 'pf-test-result fail';
    }
  }

  function saveProviderFromForm() {
    const name = $('pfName').value.trim();
    const baseUrl = $('pfBaseUrl').value.trim();
    const apiKey = $('pfApiKey').value.trim();
    const modelsRaw = $('pfModels').value.trim();
    const testModel = $('pfTestModel').value.trim();

    if (!name) return alert('请填写名称');
    if (!baseUrl) return alert('请填写接口地址');
    if (!apiKey) return alert('请填写 API Key');
    if (!modelsRaw) return alert('请至少填一个模型名（逗号分隔）');

    const models = modelsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const list = loadProviders();

    if (editingProviderId) {
      const idx = list.findIndex((x) => x.id === editingProviderId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], name, baseUrl, apiKey, models, testModel };
      }
    } else {
      list.push({
        id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name, baseUrl, apiKey, models, testModel,
        enabled: true, preset: false
      });
    }
    saveProviders(list);
    closeProviderModal();
    renderProviderList();
    refreshProviderSelect();
  }

  // ============ 事件绑定 ============
  function initEvents() {
    summarizeBtn.addEventListener('click', handleSummarize);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSummarize(); });
    saveBtn.addEventListener('click', handleSave);

    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadLibrary, 300);
    });
    tagFilter.addEventListener('change', loadLibrary);
    sortBy.addEventListener('change', loadLibrary);
    $('refreshBtn').addEventListener('click', loadLibrary);

    // 阅读页：返回 + 删除
    $('readerBack').addEventListener('click', closeReader);
    $('readerDelete').addEventListener('click', handleReaderDelete);

    // 阅读页：编辑模式
    $('readerEdit').addEventListener('click', enterEditMode);
    $('readerSave').addEventListener('click', handleReaderSave);
    $('readerCancel').addEventListener('click', handleReaderCancel);

    // 工具栏：标题转换（mousedown 保持焦点）
    $('readerToolbar').querySelectorAll('.fmt-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handleHeadingFormat(btn.dataset.block);
      });
    });

    // ESC 键：编辑模式→取消编辑，非编辑→关闭阅读页；否则关闭浮窗
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('readerView').hidden) {
        if (state.isEditing) handleReaderCancel();
        else closeReader();
      } else if (!$('summarizeModal').hidden) {
        closeSummarizeModal();
      } else if (!$('providerModal').hidden) {
        closeProviderModal();
      }
    });

    document.querySelectorAll('.metric-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.metric-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.trendMetric = btn.dataset.metric;
        drawTrend();
      });
    });

    // 首页快捷入口按钮
    document.querySelectorAll('[data-go]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.go));
    });

    // 添加剪藏浮窗
    $('homeAddBtn').addEventListener('click', openSummarizeModal);
    $('summarizeModalClose').addEventListener('click', closeSummarizeModal);
    $('summarizeBackdrop').addEventListener('click', closeSummarizeModal);

    // 设置页：服务商编辑
    $('addProviderBtn').addEventListener('click', () => openProviderModal(null));
    $('providerModalClose').addEventListener('click', closeProviderModal);
    providerModal.querySelector('.modal-backdrop').addEventListener('click', closeProviderModal);
    $('pfTestBtn').addEventListener('click', testProviderConnection);
    $('pfSaveBtn').addEventListener('click', saveProviderFromForm);
  }

  // ============ 启动 ============
  initTabs();
  initEvents();
  loadConfig();
  loadHome();
})();
