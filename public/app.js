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
  const t = (k, p) => I18n.t(k, p);
  // 所有后端请求附带 X-Lang，让错误信息按当前界面语言返回
  const api = (p, opt) => {
    opt = opt || {};
    opt.headers = Object.assign({}, opt.headers, { 'X-Lang': I18n.getLang() });
    return fetch(p, opt).then((r) => r.json().then((d) => ({ ok: r.ok, d })));
  };

  // 把任意形态的 author 归一化成「按当前语言分隔符串联的字符串」用于展示。
  // 后端按约定返回数组，但若遇到旧数据/异常写入返回裸字符串，这里兜底防止 .join 抛错崩整页。
  const fmtAuthors = (a) => {
    const sep = t('authors.sep');
    if (Array.isArray(a)) {
      return a.map((x) => (x == null ? '' : String(x))).filter(Boolean).join(sep);
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
  // 费用在 DB 里统一存人民币元（pricing.js 全按元计价，OpenAI 已按汇率折成元）。
  // 英文界面按 7.2 汇率折回美元显示，与 pricing.js 的折算口径一致。
  const USD_RATE = 7.2;
  function fmtCost(yuan) {
    if (yuan == null) return t('fmtCost.unknown');
    if (yuan === 0) return I18n.getLang() === 'en' ? '$0' : '¥0';
    if (I18n.getLang() === 'en') {
      const usd = yuan / USD_RATE;
      return '$' + (usd < 0.01 ? usd.toFixed(6) : usd.toFixed(4));
    }
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

  // ===== 解析模式（localStorage：js 规则 / ai 辅助大纲）=====
  const PARSE_MODE_KEY = 'web-summary:parseMode';
  function getParseMode() {
    return localStorage.getItem(PARSE_MODE_KEY) === 'ai' ? 'ai' : 'js';
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
      showError(t('err.noProvider'));
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
      modelSelect.appendChild(new Option(t('model.freeInput'), ''));
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
    if (!url) { showError(t('err.urlRequired')); urlInput.focus(); return; }
    if (!provider) { showError(t('err.providerRequired')); return; }
    if (!model) { showError(t('err.modelRequired')); return; }

    summarizeBtn.disabled = true;
    saveBtn.disabled = true;
    setLoading(t('loading.fetching'));
    try {
      // 传完整 provider 给后端（含 baseUrl + apiKey），后端无状态转发
      // lang 让后端按当前语言生成 AI 摘要
      const { ok, d } = await api('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, name: provider.name, models: provider.models },
          model,
          parseMode: getParseMode(),
          lang: I18n.getLang()
        })
      });
      if (!ok) throw new Error(d.error || t('err.requestFailed'));
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
    if (authorText) metaParts.push(t('meta.author') + authorText);
    if (d.platform) metaParts.push(t('meta.platform') + d.platform);
    if (d.publishedAt) metaParts.push(t('meta.published') + fmtDate(d.publishedAt));
    metaParts.push(t('meta.model') + d.model);
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
    const costText = u?.priced ? fmtCost(u.totalCost) : t('usage.priceUnknown');
    $('usageBar').innerHTML = u
      ? `${t('usage.input')} <b>${fmtNum(u.promptTokens)}</b> · ${t('usage.output')} <b>${fmtNum(u.completionTokens)}</b> · ${t('usage.total')} <b>${fmtNum(u.totalTokens)}</b> · ${t('usage.cost')} <b>${costText}</b>`
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
    input.placeholder = t('tag.placeholder');
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
    saveBtn.textContent = t('btn.saving');
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
          contentHtml: d.contentHtml,
          lang: I18n.getLang()
        })
      });
      if (!ok) throw new Error(resp.error || t('err.saveFailed'));
      saveBtn.textContent = t('btn.saved');
      setTimeout(() => {
        saveBtn.textContent = t('btn.saveToLibrary');
        saveBtn.disabled = false;
        closeSummarizeModal();
        // 刷新首页计数 / 剪藏库（若当前停留）
        loadHome();
        if ($('panel-library').classList.contains('active')) loadLibrary();
      }, 1000);
    } catch (err) {
      alert(err.message);
      saveBtn.textContent = t('btn.saveToLibrary');
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
    saveBtn.textContent = t('btn.saveToLibrary');
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
    if (!listRes.ok) { libraryList.innerHTML = '<p class="empty-hint">' + escapeHtml(t('err.loadFailed')) + '</p>'; return; }
    renderLibrary(listRes.d.items);
    refreshTagFilter();
    if (statsRes.ok) renderLibraryRails(statsRes.d);
    if (clustersRes.ok) renderTimeClusters(clustersRes.d);
  }

  /** 列表项三色高亮数 badge：色点+数字，只显示 count>0 的颜色 */
  function hlCountBadgeHTML(counts) {
    if (!counts) return '';
    const parts = [];
    ['yellow', 'blue', 'red'].forEach((c) => {
      const n = counts[c] || 0;
      if (n > 0) parts.push('<span class="clip-hl-chip"><span class="clip-hl-dot hl-' + c + '"></span>' + n + '</span>');
    });
    if (!parts.length) return '';
    return '<span class="clip-hl-count" title="' + escapeHtml(t('reader.highlights') + t('hl.countSuffix')) + '">' + parts.join('') + '</span>';
  }

  function renderLibrary(items) {
    if (!items.length) {
      libraryList.innerHTML = '<p class="empty-hint">' + escapeHtml(t('empty.libraryAlt')) + '</p>';
      return;
    }
    const maxTokens = Math.max(...items.map((it) => it.totalTokens || 0), 1);
    libraryList.innerHTML = items
      .map((it, i) => {
        const meta = [
          it.platform && escapeHtml(it.platform),
          escapeHtml(fmtAuthors(it.author)),
          it.publishedAt && fmtDate(it.publishedAt),
          fmtDate(it.savedAt) && (t('meta.savedAtPrefix') + fmtDate(it.savedAt))
        ].filter(Boolean).join(' · ');
        const tagsHtml = (it.tags || [])
          .slice(0, 5)
          .map((tag) => `<span class="clip-tag">${escapeHtml(tag)}</span>`)
          .join('');
        const pct = ((it.totalTokens || 0) / maxTokens) * 100;
        const num = String(i + 1).padStart(2, '0');
        const hlBadge = hlCountBadgeHTML(it.highlightCounts);
        return `
          <div class="clip-item" data-id="${it.id}">
            <span class="clip-rank">${num}</span>
            <div class="clip-main">
              <div class="clip-title"><span class="clip-title-text">${escapeHtml(it.title)}</span>${hlBadge}</div>
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
    tagFilter.innerHTML = '<option value="">' + escapeHtml(t('filter.allTags')) + '</option>';
    (d.topTags || []).forEach(({ tag, count }) => {
      tagFilter.appendChild(new Option(`${tag} (${count})`, tag));
    });
    if (cur) tagFilter.value = cur;
  }

  // ===== 时间聚类渲染 + 筛选（剪藏库左栏）=====

  function renderTimeClusters(clusters) {
    const wrap = $('timeClusters');
    const groups = [
      { grp: 'byYear', title: t('time.byYear'), items: clusters.byYear, fmt: (k) => k + t('time.yearSuffix') },
      { grp: 'byMonth', title: t('time.byMonth'), items: clusters.byMonth, fmt: (k) => k },
      { grp: 'byWeek', title: t('time.byWeek'), items: clusters.byWeek, fmt: (k) => fmtWeekLabel(k) },
      { grp: 'byDay', title: t('time.byDay'), items: clusters.byDay, fmt: (k) => k.slice(5) }
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
    if (grp === 'byYear') {
      from = key + '-01-01';
      to = (Number(key) + 1) + '-01-01';
      label = key + t('time.yearSuffix');
    } else if (grp === 'byMonth') {
      const [y, m] = key.split('-');
      const ny = Number(y), nm = Number(m);
      from = key + '-01';
      const nextM = nm === 12 ? (ny + 1) + '-01' : ny + '-' + pad2(nm + 1);
      to = nextM + '-01';
      label = key;
    } else if (grp === 'byWeek') {
      from = key;
      const end = new Date(new Date(key + 'T00:00:00').getTime() + 7 * 86400000);
      to = end.toISOString().slice(0, 10);
      label = fmtWeekLabel(key);
    } else {
      // byDay
      from = key;
      const end = new Date(new Date(key + 'T00:00:00').getTime() + 86400000);
      to = end.toISOString().slice(0, 10);
      label = key;
    }

    state.timeFilter = { from, to, label, grp, key };

    const badge = $('timeFilterBadge');
    badge.innerHTML = t('badge.timeFilter') + escapeHtml(label) + ' <span class="clear-time" title="' + escapeHtml(t('clearFilter')) + '">×</span>';
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
      ? tags.map((tag) => '<div class="rank-row-mini" data-tag="' + escapeHtml(tag.tag) + '" title="' + escapeHtml(t('rank.filterByTag')) + '"><span class="rname">' + escapeHtml(tag.tag) + '</span><span class="rcount">' + tag.count + '</span></div>').join('')
      : '<p class="empty-hint">' + escapeHtml(t('empty.tags')) + '</p>';

    const authors = (stats.byAuthor || []).slice(0, 12);
    $('libAuthorRank').innerHTML = authors.length
      ? authors.map((a) => '<div class="rank-row-mini" data-author="' + escapeHtml(a.author) + '" title="' + escapeHtml(t('rank.searchByAuthor')) + '"><span class="rname">' + escapeHtml(a.author) + '</span><span class="rcount">' + a.count + '</span></div>').join('')
      : '<p class="empty-hint">' + escapeHtml(t('empty.authors')) + '</p>';

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
    if (!ok) { alert(d.error || t('err.loadFailed')); return; }

    state.currentReaderClipping = d;

    // 隐藏主容器，显示阅读页
    setHidden(document.querySelector('.container'), true);
    setHidden($('readerView'), false);

    // ---- 头部 ----
    $('readerTitle').textContent = d.title;

    // ---- 右栏：文章信息（平台/发布/收藏；作者单独走可编辑块）----
    const metaParts = [
      d.platform && escapeHtml(d.platform),
      d.publishedAt && escapeHtml(t('meta.published') + fmtDate(d.publishedAt)),
      escapeHtml(t('meta.savedAt') + fmtDate(d.savedAt))
    ].filter(Boolean);
    $('readerMeta').innerHTML = metaParts.map((s) => '<span>' + s + '</span>').join('');

    // 删除按钮
    setHidden($('readerDelete'), false);

    // ---- 中栏：全文（先渲染，TOC 依赖中栏 DOM）----
    renderReaderArticle(d);

    // ---- 左栏：目录 ----
    buildReaderToc(d);

    // ---- 左栏默认显示「目录」分页，高亮列表稍后随加载填充 ----
    setAsideTab('outline');
    $('readerHighlights').innerHTML = '';
    // ---- 中栏高亮 + 左栏高亮列表（依赖正文已渲染）----
    loadReaderHighlights(d);

    // ---- 右栏：一句话总结 ----
    if (d.oneliner) {
      $('readerOneliner').textContent = d.oneliner;
      setHidden($('readerOnelinerBlock'), false);
    } else {
      setHidden($('readerOnelinerBlock'), true);
    }

    // ---- 右栏：摘要 ----
    $('readerSummary').textContent = d.summary;

    // ---- 右栏：作者（可编辑）----
    renderReaderAuthors(d);

    // ---- 右栏：标签（可编辑）----
    renderReaderTags(d);

    // ---- 右栏：模型与用量 ----
    const costText = d.cost ? fmtCost(d.cost) : fmtCost(0);
    $('readerUsage').innerHTML =
      '<div>' + escapeHtml(t('meta.model')) + '<b>' + escapeHtml(d.model) + '</b></div>' +
      '<div>' + escapeHtml(t('usage.input')) + ' <b>' + fmtNum(d.promptTokens) + '</b> · ' + escapeHtml(t('usage.output')) + ' <b>' + fmtNum(d.completionTokens) + '</b> · ' + escapeHtml(t('usage.total')) + ' <b>' + fmtNum(d.totalTokens) + '</b></div>' +
      '<div>' + escapeHtml(t('meta.cost')) + '<b>' + costText + '</b></div>';

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
        '<div class="reader-fallback-notice">' + escapeHtml(t('reader.fallbackOld')) + '</div>' +
        '<div class="reader-plaintext">' + escapeHtml(d.contentText) + '</div>';
    } else {
      article.innerHTML =
        '<div class="reader-fallback-notice">' + escapeHtml(t('reader.fallbackNone')) + '</div>';
    }
  }

  /**
   * 构建左栏目录（TOC）
   * 1. 优先从中栏 DOM 的 H1-H4 标签构建可点击 TOC → scrollIntoView 平滑滚动
   * 2. DOM 无足够标题但 outline 字段有数据 → 降级为静态目录
   * 3. 两者都无 → 隐藏左栏
   */
  /**
   * 从中栏 DOM 收集大纲候选：H1-H4 标签 + 编号段落，按文档顺序合并、文本去重。
   * 与后端 extractOutline 逻辑一致（微信等会混用 H 标签和编号段落做标题）。
   * 返回 [{ el, level, text }]，el 为对应 DOM 元素（用于点击锚点）。
   */
  function collectOutlineFromDom(root) {
    const candidates = [];
    const numRe = /^(\d+(?:\.\d+)*)[\s.、．:：)]?\s*(.+)$/;
    root.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
      const text = (h.textContent || '').trim();
      if (!text || text.length > 80) return;
      candidates.push({ el: h, level: h.tagName.toLowerCase(), text });
    });
    root.querySelectorAll('p, section').forEach((b) => {
      const text = (b.textContent || '').trim();
      if (!text || text.length > 80) return;
      const m = text.match(numRe);
      if (!m) return;
      const title = m[2].trim();
      if (!title || title.length > 50) return;
      if ((title.match(/[，。；,;]/g) || []).length > 1) return;
      const depth = m[1].split('.').length;
      const level = depth === 1 ? 'h2' : depth === 2 ? 'h3' : 'h4';
      candidates.push({ el: b, level, text: m[1] + ' ' + title });
    });
    candidates.sort((a, b) => {
      if (a.el === b.el) return 0;
      const rel = a.el.compareDocumentPosition(b.el);
      if (rel & 4) return -1; // b 在 a 之后 → a 排前
      if (rel & 2) return 1;  // b 在 a 之前 → a 排后
      return 0;
    });
    const seen = new Set();
    const out = [];
    for (const c of candidates) {
      if (seen.has(c.text)) continue;
      seen.add(c.text);
      out.push(c);
    }
    return out;
  }

  function buildReaderToc(d) {
    const article = $('readerArticle');
    const toc = $('readerToc');
    const tocWrap = $('readerTocWrap');
    const items = collectOutlineFromDom(article);

    if (items.length >= 1) {
      setHidden(tocWrap, false);
      toc.innerHTML = '';
      const usedIds = new Set();
      items.forEach((it, i) => {
        // 确保每个标题元素有唯一 id（用于锚点）
        let id = it.el.id;
        if (!id) {
          const text = (it.el.textContent || '').trim().slice(0, 40);
          id = 'h-' + text.replace(/[^\w\u4e00-\u9fa5]+/g, '-').toLowerCase().replace(/^-|-$/g, '') || 'heading-' + i;
          it.el.id = id;
        }
        if (usedIds.has(id)) {
          id = id + '-' + i;
          it.el.id = id;
        }
        usedIds.add(id);

        const link = document.createElement('a');
        link.href = '#' + id;
        link.className = 'toc-link ' + it.level;
        link.textContent = it.text.slice(0, 50);
        link.addEventListener('click', (e) => {
          e.preventDefault();
          it.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        toc.appendChild(link);
      });
    } else if (d.outline && d.outline.length >= 1) {
      // 降级：静态目录（不可点击，仅参考）
      setHidden(tocWrap, false);
      toc.innerHTML = d.outline
        .map((h) => '<div class="toc-static ' + h.level + '">' + escapeHtml(h.text) + '</div>')
        .join('');
    } else {
      // 左栏始终保留：无目录时目录区为空，但保留「目录/高亮」切换入口；
      // 绝不能 hidden 整个左栏——display:none 会让它不占 grid 网格，
      // 导致中栏(正文)/右栏(信息)前移、三栏错位
      setHidden(tocWrap, false);
      toc.innerHTML = '';
    }
  }

  // ============ 高亮评论 ============
  //
  // 定位策略：每条高亮存 exactText + prefix + suffix（基于文章 textContent 计算的上下文）。
  // 还原时不依赖 DOM 偏移（文章被编辑后偏移会失效），而是遍历正文文本节点，
  // 用 prefix+exactText+suffix 拼接做子串匹配，命中即在该段 Range 上包裹 <mark>。
  // 匹配不到的高亮跳过渲染（容忍文章被改动），但仍在左栏列表里展示原文 + 评论。

  const HL_PREFIX_LEN = 80;   // 上下文取前 80 字符，足够定位且省存储
  const HL_SUFFIX_LEN = 80;

  /** 取文章元素的全部文本（与保存时一致：textContent）*/
  function hlArticleText() {
    return $('readerArticle').textContent;
  }

  /**
   * 在文章文本节点中按 prefix+exact+suffix 定位并应用一次高亮包裹。
   * @returns {boolean} 是否成功包裹
   */
  function hlApplyOne(hl) {
    const article = $('readerArticle');
    const needle = (hl.prefix || '') + hl.exactText + (hl.suffix || '');

    // 遍历所有文本节点，累积偏移，找到命中区间并跨越节点建 Range
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.nodeValue && node.nodeValue.length) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
    // 预拼接全文做一次 indexof，确定整体起始；再用节点逐一定位区间两端
    const full = textNodes.map((tn) => tn.nodeValue).join('');
    const needleStart = full.indexOf(needle);
    if (needleStart === -1) return [];
    // needle = prefix + exactText + suffix；只包裹 exactText 段（跳过 prefix 上下文）
    const start = needleStart + (hl.prefix ? hl.prefix.length : 0);
    const end = start + hl.exactText.length;

    const range = document.createRange();
    let consumed = 0;
    let startSet = false;
    let endSet = false;
    for (const tn of textNodes) {
      const len = tn.nodeValue.length;
      const nodeStart = consumed;
      const nodeEnd = consumed + len;
      if (!startSet && start >= nodeStart && start < nodeEnd) {
        range.setStart(tn, start - nodeStart);
        startSet = true;
      }
      if (startSet && end > nodeStart && end <= nodeEnd) {
        range.setEnd(tn, end - nodeStart);
        endSet = true;
        break;
      }
      consumed = nodeEnd;
    }
    if (!startSet || !endSet) return [];

    // 逐文本节点包裹：命中区间常跨越 <a>/<strong> 等内联标签边界，
    // range.surroundContents 会因此抛错；改为每个相交文本节点各自切出子区间再包 <mark>。
    return hlWrapRange(range, hl);
  }

  /**
   * 在 Range 覆盖的每个文本节点上各自切出相交子区间并用 <mark> 包裹。
   * 从后往前处理，避免 splitText 改动节点后续内容时影响尚未处理的节点引用。
   * @returns {HTMLElement[]} 创建的 mark 元素（按文档顺序，同一条高亮可能多个）
   */
  function hlWrapRange(range, hl) {
    const article = $('readerArticle');
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const targets = []; // { node, start, end } 与 Range 相交的子区间
    let tn;
    while ((tn = walker.nextNode())) {
      let s = 0;
      let e = tn.nodeValue.length;
      if (tn === range.startContainer) s = range.startOffset;
      if (tn === range.endContainer) e = range.endOffset;
      if (s < e) targets.push({ node: tn, start: s, end: e });
    }
    const created = [];
    for (let i = targets.length - 1; i >= 0; i--) {
      const { node, start, end } = targets[i];
      // 先切尾部 [end,len)，再切头部 [0,start)，剩下的就是纯净的 [start,end) 节点
      if (end < node.nodeValue.length) node.splitText(end);
      if (start > 0) node.splitText(start);
      const target = start > 0 ? node.nextSibling : node;
      const mark = document.createElement('mark');
      mark.className = 'hl hl-' + (hl.color || 'yellow') + (hl.comment ? ' has-comment' : '');
      mark.dataset.hid = String(hl.id);
      mark.dataset.exact = hl.exactText;
      if (hl.comment) mark.title = hl.comment;
      mark.addEventListener('click', (e) => { e.stopPropagation(); hlOpenPopover(hl, mark); });
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      created.unshift(mark); // 逆序处理，unshift 还原为文档顺序
    }
    return created;
  }

  /** 重新渲染文章中的所有高亮（先移除现有 mark 再逐一应用）*/
  function hlApplyAll(highlights) {
    const article = $('readerArticle');
    article.querySelectorAll('mark.hl').forEach((m) => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    // 逐条应用；已存在 exactText 相同的避免重复包裹（同一文本多次高亮）
    (highlights || []).forEach(hlApplyOne);
  }

  /** 渲染左栏高亮列表 */
  function renderReaderHighlights(highlights) {
    const wrap = $('readerHighlights');
    const countEl = $('asideHighlightCount');
    const n = (highlights || []).length;
    if (n) {
      countEl.textContent = String(n);
      setHidden(countEl, false);
    } else {
      setHidden(countEl, true);
    }
    if (!n) {
      wrap.innerHTML = '<div class="hl-list-empty">' + escapeHtml(t('hl.empty')) + '</div>';
      return;
    }
    wrap.innerHTML = highlights.map((hl) => {
      const text = escapeHtml(hl.exactText.length > 120 ? hl.exactText.slice(0, 120) + '…' : hl.exactText);
      const comment = hl.comment
        ? '<div class="hl-list-item-comment">' + escapeHtml(hl.comment) + '</div>'
        : '';
      const colorClass = 'hl-' + (hl.color || 'yellow');
      return '<div class="hl-list-item ' + colorClass + '" data-hid="' + hl.id + '">' +
        '<div class="hl-list-item-text">' + text + '</div>' +
        comment + '</div>';
    }).join('');
    wrap.querySelectorAll('.hl-list-item').forEach((el) => {
      el.addEventListener('click', () => {
        const hid = el.dataset.hid;
        const mark = $('readerArticle').querySelector('mark.hl[data-hid="' + CSS.escape(hid) + '"]');
        if (mark) {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
          mark.classList.add('flash');
          setTimeout(() => mark.classList.remove('flash'), 800);
        }
      });
    });
  }

  /** 左栏切换：目录 / 高亮 */
  function setAsideTab(tab) {
    const outline = tab === 'outline';
    $('asideTabOutline').classList.toggle('active', outline);
    $('asideTabHighlights').classList.toggle('active', !outline);
    setHidden($('readerToc'), !outline);
    setHidden($('readerHighlights'), outline);
  }

  /** 加载某篇剪藏的高亮并渲染（正文 + 左栏列表）*/
  async function loadReaderHighlights(clipping) {
    const { ok, d } = await api('/api/clippings/' + clipping.id + '/highlights');
    if (!ok) { clipping.highlights = []; renderReaderHighlights([]); return; }
    clipping.highlights = d;
    hlApplyAll(d);
    renderReaderHighlights(d);
  }

  /** 隐藏选中工具条 */
  function hlHideToolbar() {
    setHidden($('hlToolbar'), true);
  }

  /** 选中文本时浮现高亮按钮 */
  function hlShowToolbarForSelection() {
    if (state.isEditing) return hlHideToolbar();
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (!text || text.length < 1) return hlHideToolbar();
    const article = $('readerArticle');
    // 选区必须在正文内
    if (!article.contains(sel.anchorNode) || !article.contains(sel.focusNode)) return hlHideToolbar();
    // 不在已有 mark 内创建（避免嵌套）
    let p = sel.anchorNode;
    while (p && p !== article) {
      if (p.nodeType === 1 && p.tagName === 'MARK' && p.classList.contains('hl')) return hlHideToolbar();
      p = p.parentNode;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return hlHideToolbar();
    const tb = $('hlToolbar');
    tb.style.left = (rect.left + window.scrollX + rect.width / 2) + 'px';
    tb.style.top = (rect.top + window.scrollY - 6) + 'px';
    setHidden(tb, false);
  }

  /** 计算选区的 prefix/suffix（基于文章 textContent 偏移）*/
  function hlComputeContext(range) {
    const article = $('readerArticle');
    const articleText = article.textContent;
    // range 在文章内的相对偏移：用前置 Range 测量
    const preRange = document.createRange();
    preRange.selectNodeContents(article);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const exactText = range.toString();
    return {
      exactText,
      prefix: articleText.slice(Math.max(0, start - HL_PREFIX_LEN), start),
      suffix: articleText.slice(start + exactText.length, start + exactText.length + HL_SUFFIX_LEN)
    };
  }

  /** 点击某色块：用该颜色创建高亮 */
  async function hlCreateFromSelection(color) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const ctx = hlComputeContext(range);
    if (!ctx.exactText) return;
    const d = state.currentReaderClipping;
    if (!d) return;

    const buttons = $('hlToolbar').querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const { ok, d: resp } = await api('/api/clippings/' + d.id + '/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, ctx, { color: color || 'yellow' }))
      });
      if (!ok) throw new Error(resp.error || t('err.saveFailed'));
      // 应用包裹 + 刷新左栏
      sel.removeAllRanges();
      const marks = hlApplyOne(resp);
      d.highlights = (d.highlights || []).concat([resp]);
      renderReaderHighlights(d.highlights);
      // 立即弹出评论框（可选填写），定位到首个 mark
      if (marks[0]) hlOpenPopover(resp, marks[0]);
    } catch (err) {
      alert(err.message);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
      hlHideToolbar();
    }
  }

  /** 打开评论浮窗（mark 点击或新建后调用）*/
  function hlOpenPopover(hl, mark) {
    const pop = $('hlPopover');
    const input = $('hlPopoverInput');
    input.value = hl.comment || '';
    // 定位到 mark 下方
    const rect = mark.getBoundingClientRect();
    pop.style.left = (rect.left + window.scrollX + rect.width / 2) + 'px';
    pop.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    setHidden(pop, false);
    pop.dataset.hid = String(hl.id);
    setPopoverColor(hl.color || 'yellow');
    setTimeout(() => input.focus(), 0);
  }

  function hlClosePopover() {
    setHidden($('hlPopover'), true);
    $('hlPopover').dataset.hid = '';
  }

  /** 设置浮窗色块选中态 */
  function setPopoverColor(color) {
    const c = color || 'yellow';
    $('hlPopover').dataset.color = c;
    $('hlPopoverColors').querySelectorAll('.hl-color-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.color === c);
    });
  }

  /** 即时修改高亮颜色（不影响评论）*/
  async function hlChangeColor(newColor) {
    const pop = $('hlPopover');
    const hid = Number(pop.dataset.hid);
    if (!hid) return;
    const d = state.currentReaderClipping;
    const hl = d && d.highlights && d.highlights.find((h) => h.id === hid);
    if (!hl || hl.color === newColor) return;
    const { ok, d: resp } = await api('/api/highlights/' + hid, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: newColor })
    });
    if (!ok) { alert(resp.error || t('err.updateFailed')); return; }
    hl.color = resp.color;
    // 更新正文该高亮所有 mark 的颜色 class（保留 has-comment）
    $('readerArticle').querySelectorAll('mark.hl[data-hid="' + CSS.escape(String(hid)) + '"]').forEach((m) => {
      m.classList.remove('hl-yellow', 'hl-blue', 'hl-red');
      m.classList.add('hl-' + resp.color);
    });
    setPopoverColor(resp.color);
    renderReaderHighlights(d.highlights);
  }

  /** 保存评论 */
  async function hlSaveComment() {
    const pop = $('hlPopover');
    const hid = Number(pop.dataset.hid);
    if (!hid) return;
    const comment = $('hlPopoverInput').value.trim();
    const { ok, d: resp } = await api('/api/highlights/' + hid, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment })
    });
    if (!ok) { alert(resp.error || t('err.saveFailed')); return; }
    // 更新本地 state + mark + 左栏
    const d = state.currentReaderClipping;
    if (d && d.highlights) {
      const idx = d.highlights.findIndex((h) => h.id === hid);
      if (idx >= 0) d.highlights[idx] = resp;
    }
    const marks = $('readerArticle').querySelectorAll('mark.hl[data-hid="' + CSS.escape(String(hid)) + '"]');
    marks.forEach((m) => {
      m.classList.toggle('has-comment', !!resp.comment);
      m.title = resp.comment || '';
    });
    hlClosePopover();
    if (d && d.highlights) renderReaderHighlights(d.highlights);
  }

  /** 删除高亮 */
  async function hlDeleteCurrent() {
    const pop = $('hlPopover');
    const hid = Number(pop.dataset.hid);
    if (!hid) return;
    if (!confirm(t('hl.deleteConfirm'))) return;
    const { ok, d: resp } = await api('/api/highlights/' + hid, { method: 'DELETE' });
    if (!ok) { alert(resp.error || t('err.deleteFailed')); return; }
    const d = state.currentReaderClipping;
    if (d && d.highlights) {
      d.highlights = d.highlights.filter((h) => h.id !== hid);
    }
    const marks = $('readerArticle').querySelectorAll('mark.hl[data-hid="' + CSS.escape(String(hid)) + '"]');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
    hlClosePopover();
    if (d && d.highlights) renderReaderHighlights(d.highlights);
  }

  // ============ 高亮评论 END ============

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
    input.placeholder = t('tag.placeholderShort');
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

  /**
   * 渲染右栏作者编辑器，增删作者即时 PUT 到后端。
   * 后端 normalizeAuthors 会按分隔符拆分/去重/过滤省略标记，
   * 故保存成功后用后端返回的 author 重渲染，保证 chip 与归一化结果一致。
   */
  function renderReaderAuthors(clipping) {
    const container = $('readerAuthors');
    container.innerHTML = '';

    (clipping.author || []).forEach((name, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = escapeHtml(name) + ' <span class="tag-remove" data-i="' + i + '">×</span>';
      container.appendChild(chip);
    });

    const input = document.createElement('input');
    input.className = 'tag-input';
    input.placeholder = t('author.placeholderShort');
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const name = input.value.trim();
        const authors = (clipping.author || []).slice();
        if (!authors.includes(name)) {
          authors.push(name);
          const { ok, d: resp } = await api('/api/clippings/' + clipping.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ author: authors })
          });
          if (ok) { clipping.author = resp.author; renderReaderAuthors(clipping); }
        } else {
          input.value = '';
        }
      }
    });
    container.appendChild(input);

    container.querySelectorAll('.tag-remove').forEach((el) => {
      el.addEventListener('click', async () => {
        const i = Number(el.dataset.i);
        const authors = (clipping.author || []).filter((_, idx) => idx !== i);
        const { ok, d: resp } = await api('/api/clippings/' + clipping.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ author: authors })
        });
        if (ok) { clipping.author = resp.author; renderReaderAuthors(clipping); }
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

    // 编辑前先收起高亮浮窗/工具条，并把正文中的 <mark> 拆回纯文本，
    // 避免编辑时手动改 HTML 与 mark 节点冲突（保存后会按新正文重新定位高亮）
    hlHideToolbar();
    hlClosePopover();
    hlApplyAll([]);

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
        : '<p>' + escapeHtml(t('reader.emptyContent')) + '</p>';
    }

    // 启用 contentEditable
    article.contentEditable = 'true';
    article.classList.add('editing');
    article.setAttribute('data-placeholder', t('reader.placeholderBody'));

    // 一句话总结：显示 block（即使为空）+ 可编辑
    setHidden($('readerOnelinerBlock'), false);
    const onelinerEl = $('readerOneliner');
    onelinerEl.contentEditable = 'true';
    onelinerEl.classList.add('editing');
    onelinerEl.setAttribute('data-placeholder', t('reader.placeholderOneliner'));

    // 摘要：可编辑
    const summaryEl = $('readerSummary');
    summaryEl.contentEditable = 'true';
    summaryEl.classList.add('editing');
    summaryEl.setAttribute('data-placeholder', t('reader.placeholderSummary'));

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
    return collectOutlineFromDom($('readerArticle')).map((c) => ({ level: c.level, text: c.text }));
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
    saveBtn.textContent = t('btn.saving');

    try {
      const { ok, d: resp } = await api('/api/clippings/' + d.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!ok) throw new Error(resp.error || t('err.saveFailed'));

      // 用后端返回值更新 state（含 re-sanitized contentHtml）
      state.currentReaderClipping = resp;

      exitEditMode();

      // 重新渲染正文（用后端 re-sanitize 后的 contentHtml）
      renderReaderArticle(resp);
      buildReaderToc(resp);

      // 编辑后正文已变：重新按现有高亮在新 DOM 上定位包裹
      hlApplyAll(resp.highlights || (d.highlights || []));
      // 同步 state 上的高亮引用（resp 来自 PUT /clippings，不含 highlights 字段）
      if (!resp.highlights) resp.highlights = d.highlights || [];
      renderReaderHighlights(resp.highlights);

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
      saveBtn.textContent = t('btn.save');
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

    // 恢复正文后重新定位包裹高亮
    hlApplyAll(d.highlights || []);
    renderReaderHighlights(d.highlights || []);
  }

  /**
   * 关闭阅读页，返回剪藏库
   */
  function closeReader() {
    if (state.isEditing) {
      exitEditMode();
    }
    hlHideToolbar();
    hlClosePopover();
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
    if (!confirm(t('reader.confirmDelete'))) return;
    const { ok, d } = await api('/api/clippings/' + id, { method: 'DELETE' });
    if (!ok) { alert(d.error || t('err.deleteFailed')); return; }
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
      $('homeOneliner').textContent = t('oneliner.loadFailed');
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
      wrap.innerHTML = '<p class="empty-hint">' + escapeHtml(t('empty.tags')) + '</p>';
      return;
    }
    const counts = tags.map((tag) => tag.count);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    wrap.innerHTML = tags
      .map((tag) => {
        const ratio = max === min ? 0.5 : (tag.count - min) / (max - min);
        const size = (12 + ratio * 14).toFixed(1);
        return '<span class="freq-tag" style="font-size:' + size + 'px" data-tag="' + escapeHtml(tag.tag) + '" title="' + tag.count + t('dist.articlesSuffix') + '">' + escapeHtml(tag.tag) + '</span>';
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
      text = t('oneliner.noRecent7');
    } else if (topTags.length) {
      const tagList = topTags.map((tag) => '「' + tag + '」').join(t('authors.sep'));
      text = t('oneliner.hasTags', { n: n7, tags: tagList });
      if (tok7 > 0) text += t('oneliner.hasTagsTok', { tok: fmtNum(tok7) });
    } else {
      text = t('oneliner.noTags', { n: n7 });
    }
    $('homeOneliner').textContent = text;
  }

  function renderHomeRecent(items) {
    const wrap = $('homeRecent');
    const top3 = items.slice(0, 3);
    if (!top3.length) {
      wrap.innerHTML = '<p class="empty-hint">' + escapeHtml(t('empty.libraryAlt')) + '</p>';
      return;
    }
    wrap.innerHTML = top3
      .map((it, i) => {
        const meta = [
          it.platform && escapeHtml(it.platform),
          escapeHtml(fmtAuthors(it.author)),
          fmtDate(it.savedAt) && (t('meta.savedAtPrefix') + fmtDate(it.savedAt))
        ].filter(Boolean).join(' · ');
        const num = String(i + 1).padStart(2, '0');
        const hlBadge = hlCountBadgeHTML(it.highlightCounts);
        return '<div class="clip-item" data-id="' + it.id + '">' +
          '<span class="clip-rank">' + num + '</span>' +
          '<div class="clip-main">' +
          '<div class="clip-title"><span class="clip-title-text">' + escapeHtml(it.title) + '</span>' + hlBadge + '</div>' +
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
      heatTooltip.textContent = count === 0 ? (date + t('heat.none')) : (date + t('heat.some') + count + t('heat.someSuffix'));
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
    if (!rows?.length) return '<p class="empty-hint">' + escapeHtml(t('empty.data')) + '</p>';
    const max = Math.max(...rows.map((r) => r[valKey] || 0), 1);
    return rows
      .map((r, i) => {
        const name = escapeHtml(r.model || r.platform || r.author || t('dist.unknown'));
        const val = r[valKey] || 0;
        const pct = (val / max) * 100;
        const valText = valKey === 'totalTokens' ? fmtNum(val) + t('dist.tokUnit') : (val + t('dist.articlesSuffix'));
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
      providerList.innerHTML = '<p class="empty-providers">' + escapeHtml(t('empty.providers')) + '</p>';
      return;
    }
    providerList.innerHTML = list
      .map((p) => {
        const modelCount = Array.isArray(p.models) ? p.models.length : 0;
        const keyMasked = p.apiKey ? p.apiKey.slice(0, 4) + '••••' + p.apiKey.slice(-4) : t('provider.keyEmpty');
        return `
          <div class="provider-item ${p.enabled === false ? 'disabled' : ''}" data-id="${p.id}">
            <button class="provider-toggle ${p.enabled !== false ? 'on' : ''}" data-act="toggle" title="${escapeHtml(t('provider.toggleTitle'))}"></button>
            <div class="provider-info">
              <div class="provider-name">${escapeHtml(p.name)} ${p.preset ? '<span class="model-badge">' + escapeHtml(t('provider.preset')) + '</span>' : ''}</div>
              <div class="provider-meta">${escapeHtml(p.baseUrl)} · Key: ${escapeHtml(keyMasked)} · ${modelCount}${escapeHtml(t('provider.modelsSuffix'))}</div>
            </div>
            <div class="provider-actions">
              <button data-act="edit">${escapeHtml(t('btn.edit'))}</button>
              <button data-act="delete" class="btn-del">${escapeHtml(t('btn.delete'))}</button>
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
    if (!confirm(t('provider.confirmDelete'))) return;
    saveProviders(loadProviders().filter((x) => x.id !== id));
    renderProviderList();
    refreshProviderSelect();
  }

  function openProviderModal(id) {
    editingProviderId = id || null;
    $('providerModalTitle').textContent = id ? t('modal.editProvider') : t('modal.addProvider');

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
      result.textContent = t('test.fillRequired');
      result.className = 'pf-test-result fail';
      return;
    }
    result.textContent = t('test.testing');
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
      result.textContent = (d?.message || d?.error || t('test.failed'));
      result.className = 'pf-test-result fail';
    }
  }

  function saveProviderFromForm() {
    const name = $('pfName').value.trim();
    const baseUrl = $('pfBaseUrl').value.trim();
    const apiKey = $('pfApiKey').value.trim();
    const modelsRaw = $('pfModels').value.trim();
    const testModel = $('pfTestModel').value.trim();

    if (!name) return alert(t('validate.name'));
    if (!baseUrl) return alert(t('validate.baseUrl'));
    if (!apiKey) return alert(t('validate.apiKey'));
    if (!modelsRaw) return alert(t('validate.models'));

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
    // 解析模式单选：读 localStorage 设选中，change 时写回
    const parseModeRadios = document.querySelectorAll('input[name="parseMode"]');
    const savedMode = localStorage.getItem(PARSE_MODE_KEY) || 'js';
    parseModeRadios.forEach((r) => { r.checked = (r.value === savedMode); });
    parseModeRadios.forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) localStorage.setItem(PARSE_MODE_KEY, r.value);
      });
    });

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

    // 高亮：左栏分页切换
    $('asideTabOutline').addEventListener('click', () => setAsideTab('outline'));
    $('asideTabHighlights').addEventListener('click', () => setAsideTab('highlights'));

    // 高亮：选中文字浮现工具条
    const articleEl = $('readerArticle');
    articleEl.addEventListener('mouseup', () => {
      // 延迟一帧让 selection 更新到位
      setTimeout(hlShowToolbarForSelection, 0);
    });
    articleEl.addEventListener('mousedown', (e) => {
      // 点击不是工具条自身时隐藏工具条（保留选区开始）
      if (!e.target.closest('#hlToolbar')) hlHideToolbar();
    });
    // 工具条内任意色块 mousedown 都保留选区；click 按所点色块的颜色创建高亮
    $('hlToolbar').addEventListener('mousedown', (e) => { e.preventDefault(); });
    $('hlToolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (!btn) return;
      hlCreateFromSelection(btn.dataset.color);
    });

    // 高亮：评论浮窗
    $('hlPopoverSave').addEventListener('click', hlSaveComment);
    $('hlPopoverDelete').addEventListener('click', hlDeleteCurrent);
    $('hlPopoverCancel').addEventListener('click', hlClosePopover);
    // 评论浮窗：点色块即时改色
    $('hlPopoverColors').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (!btn) return;
      hlChangeColor(btn.dataset.color);
    });
    // 点击正文空白处关闭评论浮窗
    document.addEventListener('mousedown', (e) => {
      const pop = $('hlPopover');
      if (pop.hidden) return;
      if (e.target.closest('#hlPopover') || e.target.closest('mark.hl')) return;
      hlClosePopover();
    });
    // 滚动正文时收起浮窗与工具条（位置会错位）
    $('readerArticle').addEventListener('scroll', () => {
      hlHideToolbar();
      hlClosePopover();
    });

    // ESC 键：编辑模式→取消编辑，非编辑→关闭阅读页；否则关闭浮窗
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('readerView').hidden) {
        if (state.isEditing) { handleReaderCancel(); return; }
        if (!$('hlPopover').hidden) { hlClosePopover(); return; }
        if (!$('hlToolbar').hidden) { hlHideToolbar(); window.getSelection().removeAllRanges(); return; }
        closeReader();
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

    // 语言切换
    syncLangToggle();
    document.querySelectorAll('#langToggle button').forEach((btn) => {
      btn.addEventListener('click', () => I18n.setLang(btn.dataset.lang));
    });

    // 语言变化：重渲染静态文案 + 当前视图的动态内容
    document.addEventListener('langchange', onLangChange);
  }

  /** 同步语言切换按钮的高亮状态 */
  function syncLangToggle() {
    const cur = I18n.getLang();
    document.querySelectorAll('#langToggle button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lang === cur);
    });
  }

  /** 切换语言后按当前所在视图重渲染动态内容 */
  function onLangChange() {
    syncLangToggle();
    // 重新渲染 <option> 等动态文案
    refreshTagFilter();
    // 按当前 Tab 刷新对应数据
    if ($('panel-home').classList.contains('active')) loadHome();
    if ($('panel-library').classList.contains('active')) loadLibrary();
    if ($('panel-settings').classList.contains('active')) { renderProviderList(); loadStats(); }
    // 阅读页若打开，重新渲染当前剪藏（用已有 state，无需重新拉取）
    if (!$('readerView').hidden && state.currentReaderClipping) {
      const d = state.currentReaderClipping;
      // 重建元信息 / 用量（标签编辑器内文案也依赖 lang，但当前编辑中不打断）
      const metaParts = [
        d.platform && escapeHtml(d.platform),
        d.publishedAt && escapeHtml(t('meta.published') + fmtDate(d.publishedAt)),
        escapeHtml(t('meta.savedAt') + fmtDate(d.savedAt))
      ].filter(Boolean);
      $('readerMeta').innerHTML = metaParts.map((s) => '<span>' + s + '</span>').join('');
      const costText = d.cost ? fmtCost(d.cost) : fmtCost(0);
      $('readerUsage').innerHTML =
        '<div>' + escapeHtml(t('meta.model')) + '<b>' + escapeHtml(d.model) + '</b></div>' +
        '<div>' + escapeHtml(t('usage.input')) + ' <b>' + fmtNum(d.promptTokens) + '</b> · ' + escapeHtml(t('usage.output')) + ' <b>' + fmtNum(d.completionTokens) + '</b> · ' + escapeHtml(t('usage.total')) + ' <b>' + fmtNum(d.totalTokens) + '</b></div>' +
        '<div>' + escapeHtml(t('meta.cost')) + '<b>' + costText + '</b></div>';
      if (!state.isEditing) {
        renderReaderAuthors(d);
        renderReaderTags(d);
        renderReaderHighlights(d.highlights || []);
      }
    }
  }

  // ============ 启动 ============
  // 先按检测到的语言应用静态文案 + 设置 <html lang>
  document.documentElement.lang = I18n.getLang() === 'en' ? 'en' : 'zh-CN';
  I18n.applyTo();
  initTabs();
  initEvents();
  loadConfig();
  loadHome();
})();
