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
    trendData: []
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

  async function loadConfig() {
    const { ok, d } = await api('/api/config');
    if (!ok || !d.providers?.length) {
      showError('尚未配置任何服务商的 API Key，请在后端 .env 中设置后重启服务。');
      summarizeBtn.disabled = true;
      return;
    }
    state.providers = d.providers;
    d.providers.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      providerSelect.appendChild(opt);
    });
    renderModels(d.providers[0].models);
    providerSelect.addEventListener('change', () => {
      const sel = d.providers.find((p) => p.id === providerSelect.value);
      if (sel) renderModels(sel.models);
    });
  }

  function renderModels(modelsConfig) {
    modelSelect.innerHTML = '';
    modelsConfig.forEach((entry) => {
      if (typeof entry === 'string') {
        modelSelect.appendChild(new Option(entry, entry));
      } else if (entry?.items) {
        const g = document.createElement('optgroup');
        g.label = entry.group;
        entry.items.forEach((m) => g.appendChild(new Option(m, m)));
        modelSelect.appendChild(g);
      }
    });
  }

  async function handleSummarize() {
    const url = urlInput.value.trim();
    const providerId = providerSelect.value;
    const model = modelSelect.value;
    if (!url) { showError('请输入要总结的网址'); urlInput.focus(); return; }
    if (!providerId || !model) { showError('请选择服务商和模型'); return; }

    summarizeBtn.disabled = true;
    saveBtn.disabled = true;
    setLoading('正在抓取网页…');
    try {
      const { ok, d } = await api('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, providerId, model })
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
          cost: u.priced ? u.totalCost : 0
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
            <div class="clip-summary">${escapeHtml(it.summary.slice(0, 200))}</div>
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

  // 详情弹窗
  async function openDetail(id) {
    const { ok, d } = await api('/api/clippings/' + id);
    if (!ok) { alert(d.error || '加载失败'); return; }
    const modal = $('detailModal');
    const content = $('modalContent');

    const outlineHtml = d.outline?.length
      ? `<div class="modal-section"><div class="section-label">📑 目录</div><div class="outline-tree">${d.outline.map((h) => `<div class="${h.level}">${escapeHtml(h.text)}</div>`).join('')}</div></div>`
      : '';

    content.innerHTML = `
      <div class="modal-title">${escapeHtml(d.title)}</div>
      <div class="modal-meta">
        ${[d.platform, d.author, d.publishedAt && fmtDate(d.publishedAt), `收藏 ${fmtDate(d.savedAt)}`].filter(Boolean).map(escapeHtml).join(' · ')}
      </div>
      ${outlineHtml}
      ${d.oneliner ? `<div class="modal-section"><div class="section-label">💡 一句话总结</div><div class="oneliner-box">${escapeHtml(d.oneliner)}</div></div>` : ''}
      <div class="modal-section">
        <div class="section-label">📝 摘要</div>
        <div class="modal-summary">${escapeHtml(d.summary)}</div>
      </div>
      <div class="modal-section">
        <div class="section-label">🏷️ 标签</div>
        <div class="tag-editor" id="modalTags"></div>
      </div>
      <div class="usage-bar">
        模型 <b>${escapeHtml(d.model)}</b> · 输入 <b>${fmtNum(d.promptTokens)}</b> · 输出 <b>${fmtNum(d.completionTokens)}</b> · 总 <b>${fmtNum(d.totalTokens)}</b> · 费用 <b>${fmtCost(d.cost)}</b>
      </div>
      <div class="modal-actions">
        <a class="result-link" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">查看原文 →</a>
        <span style="flex:1"></span>
        <button class="btn-danger" id="modalDelete">删除</button>
      </div>`;

    // 详情内 tags 编辑
    renderModalTags(d);

    $('modalDelete').addEventListener('click', async () => {
      if (!confirm('确定删除这条剪藏？此操作不可撤销。')) return;
      const { ok, d: resp } = await api('/api/clippings/' + id, { method: 'DELETE' });
      if (!ok) { alert(resp.error || '删除失败'); return; }
      closeModal();
      loadLibrary();
    });

    setHidden(modal, false);
  }

  function renderModalTags(clipping) {
    const container = $('modalTags');
    if (!container) return;
    container.innerHTML = '';
    (clipping.tags || []).forEach((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${escapeHtml(t)} <span class="tag-remove" data-i="${i}">×</span>`;
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
          const { ok, d } = await api('/api/clippings/' + clipping.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags })
          });
          if (ok) {
            clipping.tags = tags;
            renderModalTags(clipping);
          }
        } else {
          input.value = '';
        }
      }
    });
    container.appendChild(input);

    container.querySelectorAll('.tag-remove').forEach(async (el) => {
      el.addEventListener('click', async () => {
        const i = Number(el.dataset.i);
        const tags = clipping.tags.filter((_, idx) => idx !== i);
        const { ok } = await api('/api/clippings/' + clipping.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags })
        });
        if (ok) { clipping.tags = tags; renderModalTags(clipping); }
      });
    });
  }

  function closeModal() {
    setHidden($('detailModal'), true);
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

    document.querySelectorAll('.metric-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.metric-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.trendMetric = btn.dataset.metric;
        drawTrend();
      });
    });

    $('modalClose').addEventListener('click', closeModal);
    document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  }

  // ============ 启动 ============
  initTabs();
  initEvents();
  loadConfig();
})();
