/**
 * 前端 i18n：中英文界面切换。
 *
 * 用法：
 *   - HTML 静态文案加 data-i18n="key"（textContent）/ data-i18n-ph（placeholder）/ data-i18n-title（title）
 *   - JS 动态文案用 I18n.t('key', { name: value })
 *   - 切换语言：I18n.setLang('en')，会派发 'langchange' 事件，app.js 监听后重渲染
 *
 * 首次访问：localStorage 无记录时按 navigator.language 自动判断（zh* → 中文，其余 → 英文）。
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'web-summary:lang';
  const SUPPORTED = ['zh', 'en'];

  const MESSAGES = {
    zh: {
      'header.title': "CTZ's Web Summary Index",
      'header.subtitle': '抓取网页 → AI 中文摘要 → 永久收藏与统计',
      'btn.addClipping': '+ 添加剪藏',

      'tab.home': '首页',
      'tab.library': '剪藏库',
      'tab.settings': '设置',

      'stat.count': '条目数',
      'stat.tags': '标签量',
      'stat.tokens': 'Token 消耗',
      'section.heatmap': '贡献热力图',
      'section.tagCloud': '标签云',
      'section.recent': '最近剪藏',
      'section.timeClusters': '时间聚类',
      'section.tagRank': '标签排行',
      'section.authorRank': '作者排行',
      'heat.less': '少',
      'heat.more': '多',
      'empty.recent': '暂无剪藏',
      'oneliner.loading': '加载中…',

      'search.placeholder': '搜索标题/摘要/作者…',
      'filter.allTags': '全部标签',
      'sort.recent': '最近保存',
      'sort.tokens': 'Token 用量',
      'sort.cost': '费用',
      'btn.refresh': '刷新',
      'empty.library': '暂无剪藏，点「+ 添加剪藏」保存第一篇吧',
      'empty.libraryAlt': '暂无剪藏，去「生成摘要」保存第一篇吧',
      'empty.tags': '暂无标签',
      'empty.authors': '暂无作者',
      'empty.data': '暂无数据',
      'time.byYear': '按年',
      'time.byMonth': '按月',
      'time.byWeek': '按周',
      'time.byDay': '按日',
      'time.yearSuffix': ' 年',
      'badge.timeFilter': '时间筛选：',
      'clearFilter': '清除筛选',
      'rank.filterByTag': '点击按此标签筛选',
      'rank.searchByAuthor': '点击搜索该作者',
      'meta.savedAtPrefix': '收藏于 ',
      'meta.savedAt': '收藏：',

      'reader.back': '← 返回剪藏库',
      'btn.edit': '编辑',
      'btn.save': '保存',
      'btn.cancel': '取消',
      'btn.delete': '删除',
      'toolbar.hint': '将光标置于段落中，点击按钮转换标题级别',
      'fmt.h1': '一级标题',
      'fmt.h2': '二级标题',
      'fmt.h3': '三级标题',
      'fmt.h4': '四级标题',
      'fmt.p': '正文',
      'reader.toc': '目录',
      'reader.articleInfo': '文章信息',
      'reader.oneliner': '一句话总结',
      'reader.summary': '摘要',
      'reader.tags': '标签',
      'reader.usage': '模型与用量',
      'reader.viewOriginal': '查看原文 →',
      'reader.fallbackOld': '该剪藏为旧版本保存，未保留全文格式，以下为纯文本内容。',
      'reader.fallbackNone': '该剪藏未保留全文内容。',
      'reader.emptyContent': '（空内容）',
      'reader.placeholderBody': '正文内容为空，点击此处开始编辑',
      'reader.placeholderOneliner': '点击编辑一句话总结…',
      'reader.placeholderSummary': '点击编辑摘要…',
      'reader.confirmDelete': '确定删除这条剪藏？此操作不可撤销。',
      'reader.editing': '编辑中…',

      'reader.outline': '目录',
      'reader.highlights': '高亮',
      'hl.colorYellow': '黄色高亮',
      'hl.colorBlue': '蓝色高亮',
      'hl.colorRed': '红色高亮',
      'hl.commentPlaceholder': '写下你的评论…',
      'hl.save': '保存评论',
      'hl.delete': '删除高亮',
      'hl.deleteConfirm': '删除这条高亮？',
      'hl.empty': '暂无高亮。阅读时选中文字即可添加高亮与评论。',
      'hl.countSuffix': ' 条',

      'modal.addClipping': '添加剪藏',
      'field.url': '网页地址',
      'field.provider': '服务商',
      'field.model': '模型',
      'btn.summarize': '生成摘要',
      'btn.saveToLibrary': '保存到剪藏库',
      'btn.saving': '保存中…',
      'btn.saved': '已保存',
      'loading.fetching': '正在抓取网页…',
      'result.outline': '目录',
      'result.oneliner': '一句话总结',
      'result.summary': '摘要',
      'result.tags': '标签',
      'result.viewOriginal': '查看原文 →',
      'tag.placeholder': '+ 添加标签（回车）',
      'tag.placeholderShort': '+ 添加（回车）',
      'reader.authors': '作者',
      'author.placeholderShort': '+ 添加作者（回车）',
      'usage.input': '输入',
      'usage.output': '输出',
      'usage.total': '总',
      'usage.cost': '费用',
      'usage.priceUnknown': '价格未知',

      'settings.provider': '服务商配置',
      'btn.addProvider': '+ 添加服务商',
      'settings.hint': 'API Key 仅保存在你当前浏览器（localStorage），不进服务器、不落盘。换浏览器需重新填写。',
      'settings.parseMode': '解析模式',
      'settings.parseModeJs': 'js 解析全文',
      'settings.parseModeAi': 'AI 解析全文',
      'settings.parseModeHint': 'js：规则解析（快、免费）；AI：在 js 基础上用 AI 增强大纲（更全但消耗 token）。',
      'stat.totalClippings': '剪藏总数',
      'stat.totalTokens': '累计 Token',
      'stat.totalCost': '累计费用',
      'chart.trend': '用量趋势',
      'metric.tokens': 'Token',
      'metric.cost': '费用',
      'metric.count': '剪藏数',
      'chart.empty': '暂无数据',
      'dist.byModel': '按模型分布',
      'dist.byPlatform': '按平台分布',
      'dist.byAuthor': '按作者分布',
      'empty.providers': '还没有服务商。点「+ 添加服务商」开始配置。',
      'provider.preset': '预设',
      'provider.keyEmpty': '未填',
      'provider.modelsSuffix': ' 个模型',
      'provider.toggleTitle': '启用/禁用',
      'provider.confirmDelete': '确定删除该服务商配置？',

      'modal.editProvider': '编辑服务商',
      'modal.addProvider': '添加服务商',
      'field.name': '名称',
      'field.baseUrl': '接口地址 (Base URL)',
      'field.apiKey': 'API Key',
      'field.models': '模型列表',
      'field.testModel': '测试用模型',
      'form.tip': '下拉选择用。也可在调用时直接填模型名（不强校验）。',
      'ph.name': '如：智谱 GLM',
      'ph.baseUrl': '如：https://open.bigmodel.cn/api/paas/v4',
      'ph.models': '逗号分隔，如：glm-4-flash, glm-4, GLM-5.2',
      'ph.testModel': '用于测试连接的模型名，如 glm-4-flash',
      'btn.testConnection': '测试连接',
      'test.fillRequired': '请先填 Base URL、API Key 和测试模型',
      'test.testing': '测试中…',
      'test.failed': '测试失败',
      'validate.name': '请填写名称',
      'validate.baseUrl': '请填写接口地址',
      'validate.apiKey': '请填写 API Key',
      'validate.models': '请至少填一个模型名（逗号分隔）',

      'footer.note': 'Token 与费用为估算值，仅供参考。数据保存在本地 data/clippings.db。',

      'meta.author': '作者：',
      'meta.platform': '平台：',
      'meta.published': '发布：',
      'meta.model': '模型：',
      'meta.cost': '费用：',
      'meta.costShort': '费用',
      'fmtCost.unknown': '未知',
      'dist.unknown': '未知',
      'dist.tokUnit': ' tok',
      'dist.articlesSuffix': ' 篇',
      'heat.none': '：无收藏',
      'heat.some': '：',
      'heat.someSuffix': ' 篇',
      'authors.sep': '、',
      'model.freeInput': '（请在下方输入模型名）',

      'oneliner.noRecent7': '最近一周还没有新的收藏。去「生成摘要」捕捉下一篇值得留存的内容吧。',
      'oneliner.hasTags': '近 7 天收藏了 {n} 篇，主要围绕 {tags} 等主题。',
      'oneliner.hasTagsTok': '累计消耗约 {tok} tokens。',
      'oneliner.noTags': '近 7 天收藏了 {n} 篇，尚未添加标签。',
      'oneliner.loadFailed': '数据加载失败，请稍后重试。',

      'err.urlRequired': '请输入要总结的网址',
      'err.providerRequired': '请先到「设置」配置服务商',
      'err.modelRequired': '请选择或输入模型',
      'err.noProvider': '尚未配置可用的服务商。请到「设置」中添加服务商并填写 API Key。',
      'err.requestFailed': '请求失败',
      'err.saveFailed': '保存失败',
      'err.loadFailed': '加载失败',
      'err.deleteFailed': '删除失败'
    },
    en: {
      'header.title': "CTZ's Web Summary Index",
      'header.subtitle': 'Web → AI Summary → Save & Stats',
      'btn.addClipping': '+ Add Clipping',

      'tab.home': 'Home',
      'tab.library': 'Library',
      'tab.settings': 'Settings',

      'stat.count': 'Items',
      'stat.tags': 'Tags',
      'stat.tokens': 'Token Usage',
      'section.heatmap': 'Contribution Heatmap',
      'section.tagCloud': 'Tag Cloud',
      'section.recent': 'Recent Clippings',
      'section.timeClusters': 'Time Clusters',
      'section.tagRank': 'Tag Ranking',
      'section.authorRank': 'Author Ranking',
      'heat.less': 'Less',
      'heat.more': 'More',
      'empty.recent': 'No clippings yet',
      'oneliner.loading': 'Loading…',

      'search.placeholder': 'Search title/summary/author…',
      'filter.allTags': 'All tags',
      'sort.recent': 'Recent',
      'sort.tokens': 'Token usage',
      'sort.cost': 'Cost',
      'btn.refresh': 'Refresh',
      'empty.library': 'No clippings yet. Click "+ Add Clipping" to save your first.',
      'empty.libraryAlt': 'No clippings yet. Generate a summary to save your first.',
      'empty.tags': 'No tags',
      'empty.authors': 'No authors',
      'empty.data': 'No data',
      'time.byYear': 'By Year',
      'time.byMonth': 'By Month',
      'time.byWeek': 'By Week',
      'time.byDay': 'By Day',
      'time.yearSuffix': '',
      'badge.timeFilter': 'Time filter: ',
      'clearFilter': 'Clear filter',
      'rank.filterByTag': 'Click to filter by this tag',
      'rank.searchByAuthor': 'Click to search this author',
      'meta.savedAtPrefix': 'Saved ',
      'meta.savedAt': 'Saved: ',

      'reader.back': '← Back to Library',
      'btn.edit': 'Edit',
      'btn.save': 'Save',
      'btn.cancel': 'Cancel',
      'btn.delete': 'Delete',
      'toolbar.hint': 'Place cursor in a paragraph, click to convert heading level',
      'fmt.h1': 'Heading 1',
      'fmt.h2': 'Heading 2',
      'fmt.h3': 'Heading 3',
      'fmt.h4': 'Heading 4',
      'fmt.p': 'Paragraph',
      'reader.toc': 'Contents',
      'reader.articleInfo': 'Article Info',
      'reader.oneliner': 'One-liner',
      'reader.summary': 'Summary',
      'reader.tags': 'Tags',
      'reader.usage': 'Model & Usage',
      'reader.viewOriginal': 'View Original →',
      'reader.fallbackOld': 'Saved by an older version without formatting; showing plain text below.',
      'reader.fallbackNone': 'No full-text content saved for this clipping.',
      'reader.emptyContent': '(empty)',
      'reader.placeholderBody': 'Body is empty, click here to edit',
      'reader.placeholderOneliner': 'Click to edit one-liner…',
      'reader.placeholderSummary': 'Click to edit summary…',
      'reader.confirmDelete': 'Delete this clipping? This cannot be undone.',
      'reader.editing': 'Editing…',

      'reader.outline': 'Outline',
      'reader.highlights': 'Highlights',
      'hl.colorYellow': 'Yellow highlight',
      'hl.colorBlue': 'Blue highlight',
      'hl.colorRed': 'Red highlight',
      'hl.commentPlaceholder': 'Write your note…',
      'hl.save': 'Save Note',
      'hl.delete': 'Delete Highlight',
      'hl.deleteConfirm': 'Delete this highlight?',
      'hl.empty': 'No highlights yet. Select text while reading to add one.',
      'hl.countSuffix': '',

      'modal.addClipping': 'Add Clipping',
      'field.url': 'Web URL',
      'field.provider': 'Provider',
      'field.model': 'Model',
      'btn.summarize': 'Summarize',
      'btn.saveToLibrary': 'Save to Library',
      'btn.saving': 'Saving…',
      'btn.saved': 'Saved',
      'loading.fetching': 'Fetching page…',
      'result.outline': 'Outline',
      'result.oneliner': 'One-liner',
      'result.summary': 'Summary',
      'result.tags': 'Tags',
      'result.viewOriginal': 'View Original →',
      'tag.placeholder': '+ Add tag (Enter)',
      'tag.placeholderShort': '+ Add (Enter)',
      'reader.authors': 'Authors',
      'author.placeholderShort': '+ Add author (Enter)',
      'usage.input': 'In',
      'usage.output': 'Out',
      'usage.total': 'Total',
      'usage.cost': 'Cost',
      'usage.priceUnknown': 'Price unknown',

      'settings.provider': 'Provider Settings',
      'btn.addProvider': '+ Add Provider',
      'settings.hint': 'API Keys are stored only in your browser (localStorage), never sent to the server or persisted. Re-enter when switching browsers.',
      'settings.parseMode': 'Parse Mode',
      'settings.parseModeJs': 'JS parse (rules)',
      'settings.parseModeAi': 'AI parse (assisted)',
      'settings.parseModeHint': 'JS: rule-based (fast, free); AI: enhances the outline with AI on top of JS (more complete, costs tokens).',
      'stat.totalClippings': 'Total Clippings',
      'stat.totalTokens': 'Total Tokens',
      'stat.totalCost': 'Total Cost',
      'chart.trend': 'Usage Trend',
      'metric.tokens': 'Token',
      'metric.cost': 'Cost',
      'metric.count': 'Count',
      'chart.empty': 'No data',
      'dist.byModel': 'By Model',
      'dist.byPlatform': 'By Platform',
      'dist.byAuthor': 'By Author',
      'empty.providers': 'No providers yet. Click "+ Add Provider" to configure.',
      'provider.preset': 'Preset',
      'provider.keyEmpty': '(empty)',
      'provider.modelsSuffix': ' models',
      'provider.toggleTitle': 'Enable/Disable',
      'provider.confirmDelete': 'Delete this provider?',

      'modal.editProvider': 'Edit Provider',
      'modal.addProvider': 'Add Provider',
      'field.name': 'Name',
      'field.baseUrl': 'Base URL',
      'field.apiKey': 'API Key',
      'field.models': 'Model List',
      'field.testModel': 'Test Model',
      'form.tip': 'For dropdown selection. You can also type a model name directly.',
      'ph.name': 'e.g. Zhipu GLM',
      'ph.baseUrl': 'e.g. https://open.bigmodel.cn/api/paas/v4',
      'ph.models': 'Comma-separated, e.g. glm-4-flash, glm-4, GLM-5.2',
      'ph.testModel': 'Model for connection test, e.g. glm-4-flash',
      'btn.testConnection': 'Test Connection',
      'test.fillRequired': 'Please fill Base URL, API Key and test model',
      'test.testing': 'Testing…',
      'test.failed': 'Test failed',
      'validate.name': 'Please enter a name',
      'validate.baseUrl': 'Please enter Base URL',
      'validate.apiKey': 'Please enter API Key',
      'validate.models': 'Please enter at least one model (comma-separated)',

      'footer.note': 'Token and cost are estimates only. Data is stored locally in data/clippings.db.',

      'meta.author': 'Author: ',
      'meta.platform': 'Platform: ',
      'meta.published': 'Published: ',
      'meta.model': 'Model: ',
      'meta.cost': 'Cost: ',
      'meta.costShort': 'Cost',
      'fmtCost.unknown': 'Unknown',
      'dist.unknown': 'Unknown',
      'dist.tokUnit': ' tok',
      'dist.articlesSuffix': '',
      'heat.none': ': none',
      'heat.some': ': ',
      'heat.someSuffix': '',
      'authors.sep': ', ',
      'model.freeInput': '(enter model name below)',

      'oneliner.noRecent7': 'No new clippings this week. Capture your next read worth keeping.',
      'oneliner.hasTags': 'Saved {n} in the last 7 days, mainly around {tags}.',
      'oneliner.hasTagsTok': 'About {tok} tokens consumed.',
      'oneliner.noTags': 'Saved {n} in the last 7 days, no tags yet.',
      'oneliner.loadFailed': 'Failed to load data. Please retry.',

      'err.urlRequired': 'Please enter a URL to summarize',
      'err.providerRequired': 'Configure a provider in Settings first',
      'err.modelRequired': 'Please select or enter a model',
      'err.noProvider': 'No provider configured. Add one with an API Key in Settings.',
      'err.requestFailed': 'Request failed',
      'err.saveFailed': 'Save failed',
      'err.loadFailed': 'Load failed',
      'err.deleteFailed': 'Delete failed'
    }
  };

  function detectLang() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(stored)) return stored;
    const nav = (navigator.language || 'zh').toLowerCase();
    return nav.startsWith('zh') ? 'zh' : 'en';
  }

  let current = detectLang();

  function t(key, params) {
    const table = MESSAGES[current] || MESSAGES.zh;
    let s = table[key] != null ? table[key] : (MESSAGES.zh[key] != null ? MESSAGES.zh[key] : key);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v == null ? '' : String(v));
      }
    }
    return s;
  }

  function applyTo(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      // 仅当元素没有子元素（纯文本节点）时直接写 textContent，避免覆盖子结构
      if (!el.children.length) el.textContent = t(key);
      else {
        // 有子元素时：仅替换第一个文本子节点
        const first = el.firstChild;
        if (first && first.nodeType === 3) first.nodeValue = t(key);
      }
    });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    (root || document).querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang) || lang === current) return;
    current = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    applyTo(document);
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function getLang() { return current; }

  global.I18n = { t, applyTo, setLang, getLang, detectLang, MESSAGES };
})(window);
