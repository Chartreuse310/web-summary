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

  // ============ 全局状态 ============
  const state = {
    providers: [],
    currentResult: null, // 当前 summarize 结果，待保存
    trendMetric: 'tokens',
    trendData: [],
    currentReaderClipping: null // 当前阅读视图打开的剪藏对象
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
    if (name === 'library') loadLibrary();
    if (name === 'stats') loadStats();
    if (name === 'settings') renderProviderList();
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
      showError('尚未配置可用的服务商。请到「⚙️ 设置」中添加服务商并填写 API Key。');
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
    if (d.author) metaParts.push(`作者：${d.author}`);
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
      saveBtn.textContent = '✓ 已保存';
      setTimeout(() => { saveBtn.textContent = '💾 保存到剪藏库'; saveBtn.disabled = false; }, 1500);
    } catch (err) {
      alert(err.message);
      saveBtn.textContent = '💾 保存到剪藏库';
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
    const { ok, d } = await api('/api/clippings?' + params.toString());
    if (!ok) { libraryList.innerHTML = '<p class="empty-hint">加载失败</p>'; return; }
    renderLibrary(d.items);
    refreshTagFilter();
  }

  function renderLibrary(items) {
    if (!items.length) {
      libraryList.innerHTML = '<p class="empty-hint">暂无剪藏，去「生成摘要」保存第一篇吧</p>';
      return;
    }
    libraryList.innerHTML = items
      .map((it) => {
        const meta = [
          it.platform && escapeHtml(it.platform),
          it.author && escapeHtml(it.author),
          it.publishedAt && fmtDate(it.publishedAt),
          fmtDate(it.savedAt) && `收藏于 ${fmtDate(it.savedAt)}`
        ].filter(Boolean).join(' · ');
        const tagsHtml = (it.tags || [])
          .slice(0, 5)
          .map((t) => `<span class="clip-tag">${escapeHtml(t)}</span>`)
          .join('');
        return `
          <div class="clip-item" data-id="${it.id}">
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
    const metaParts = [
      d.platform && escapeHtml(d.platform),
      d.author && escapeHtml('作者：' + d.author),
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
        '<div class="reader-fallback-notice">⚠️ 该剪藏为旧版本保存，未保留全文格式，以下为纯文本内容。</div>' +
        '<div class="reader-plaintext">' + escapeHtml(d.contentText) + '</div>';
    } else {
      article.innerHTML =
        '<div class="reader-fallback-notice">⚠️ 该剪藏未保留全文内容。</div>';
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

  /**
   * 关闭阅读页，返回剪藏库
   */
  function closeReader() {
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
    // 标签云
    $('topTags').innerHTML = (stats.topTags || [])
      .map(({ tag, count }) => `<span class="cloud-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)} · ${count}</span>`)
      .join('') || '<p class="empty-hint">暂无标签</p>';
    $('topTags').querySelectorAll('.cloud-tag').forEach((el) => {
      el.addEventListener('click', () => {
        tagFilter.value = el.dataset.tag;
        switchTab('library');
        loadLibrary();
      });
    });
  }

  function renderDist(rows, valKey, _countKey) {
    if (!rows?.length) return '<p class="empty-hint">暂无数据</p>';
    const max = Math.max(...rows.map((r) => r[valKey] || 0), 1);
    return rows
      .map((r) => {
        const name = escapeHtml(r.model || r.platform || '未知');
        const val = r[valKey] || 0;
        const pct = (val / max) * 100;
        const valText = valKey === 'totalTokens' ? fmtNum(val) + ' tok' : val + ' 篇';
        return `<div class="dist-row"><span class="dist-name">${name}</span><div class="dist-bar"><div class="dist-bar-fill" style="width:${pct}%"></div></div><span class="dist-val">${valText}</span></div>`;
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
    const colors = { tokens: '#4f6ef7', cost: '#22a06b', count: '#e5902b' };
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
      result.textContent = '✓ ' + d.message;
      result.className = 'pf-test-result ok';
    } else {
      result.textContent = '✗ ' + (d?.message || d?.error || '测试失败');
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

    // ESC 键关闭阅读页
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('readerView').hidden) {
        closeReader();
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
})();
