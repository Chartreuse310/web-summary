/**
 * 网页正文 + 元数据 + 大纲提取
 *
 * 流程：fetch 抓取 HTML → jsdom 解析
 *   → Readability 提取正文（Firefox 阅读模式同款算法）
 *   → meta 标签提取 作者 / 平台 / 发布时间
 *   → DOM H1-H3 提取文章大纲
 *
 * 返回：{ title, text, url, author, platform, publishedAt, outline }
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { makeError } = require('./i18n');

// 静默 jsdom 的 CSS 解析噪音：jsdom 对现代 CSS（@layer / 嵌套等）会打
// "Could not parse CSS stylesheet" 警告，但只影响样式、不破坏 DOM 提取。
const silentConsole = new VirtualConsole();
silentConsole.on('jsdomError', () => { /* 吞掉 CSS/资源加载错误 */ });

const MAX_CONTENT_CHARS = 8000;

function validateUrl(raw, lang) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw makeError(lang, 'err.urlInvalid', null, 'bad_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw makeError(lang, 'err.urlScheme', null, 'bad_url');
  }
  return u.href;
}

/**
 * 按常见分隔符拆分作者名并加入 set（去重）
 */
function splitAuthors(raw, set) {
  const parts = raw.split(/[,，、;；&]|\s+and\s+|\s+和\s+|\s+与\s+/i);
  for (const p of parts) {
    // 含中文：空格视为多作者分隔符（中文人名内部不含空格）；否则保留空格（名 姓）
    const names = /[\u4e00-\u9fff]/.test(p) ? p.trim().split(/\s+/) : [p.trim()];
    for (const name of names) {
      const n = name.trim();
      if (n) set.add(n);
    }
  }
}

/**
 * 递归收集 JSON-LD 中的 author 字段（支持 @graph 嵌套）
 */
function collectJsonLdAuthors(data, set) {
  if (!data) return;
  const arr = Array.isArray(data) ? data : [data];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    if (item.author) {
      const authors = Array.isArray(item.author) ? item.author : [item.author];
      for (const a of authors) {
        const name = typeof a === 'string' ? a : a?.name;
        if (name) splitAuthors(String(name), set);
      }
    }
    if (item['@graph']) collectJsonLdAuthors(item['@graph'], set);
  }
}

/**
 * 从 document 提取元数据：作者 / 平台 / 发布时间
 * 优先级：Open Graph / article:* → 常见 meta → 域名/时间标签回退
 */
function extractMetadata(document, docUrl) {
  const meta = (sel) => {
    const el = document.querySelector(sel);
    return el?.getAttribute('content')?.trim() || null;
  };

  // 作者（多源合并 + 分隔符拆分，返回去重数组）
  const authorSet = new Set();
  // 1. 收集所有 author 相关 meta 标签（article:author 可能有多个）
  document.querySelectorAll(
    'meta[property="article:author"], meta[name="article:author"], ' +
    'meta[property="og:article:author"], meta[name="author"], meta[name="twitter:creator"]'
  ).forEach((el) => {
    const v = el.getAttribute('content')?.trim();
    if (v) splitAuthors(v, authorSet);
  });
  // 2. JSON-LD 结构化数据（最可靠的多作者来源）
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      collectJsonLdAuthors(JSON.parse(s.textContent || ''), authorSet);
    } catch { /* 忽略非法 JSON-LD */ }
  });
  const author = [...authorSet];

  // 平台（站点名）
  let platform =
    meta('meta[property="og:site_name"]') ||
    meta('meta[name="application-name"]') ||
    null;
  if (!platform) {
    try {
      platform = new URL(docUrl).hostname.replace(/^www\./, '');
    } catch {
      platform = null;
    }
  }

  // 发布时间
  const publishedAt =
    meta('meta[property="article:published_time"]') ||
    meta('meta[name="article:published_time"]') ||
    meta('meta[property="og:updated_time"]') ||
    meta('meta[name="date"]') ||
    meta('meta[itemprop="datePublished"]') ||
    document.querySelector('article time[datetime]')?.getAttribute('datetime') ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    null;

  return { author, platform, publishedAt };
}

/**
 * 提取文章大纲：[{level, text}]
 *
 * 策略（分层 fallback，均在正文容器内查找，避免误抓文章标题）：
 *   1. 优先找语义化 H1-H6（普通博客、新闻、文档站）
 *      —— 但只有 ≥2 个时才采用；单个 H1 通常是文章标题，不是目录
 *   2. 若没有，找「带编号的段落」（微信、知乎等用样式的站点）
 *      —— 编号形如 1 / 1.1 / 1.1.1，是章节标题的强信号
 *
 * 注意：微信文章几乎不用 H 标签，而是用 <p> + 加粗 + 编号来做标题。
 *
 * @param {Document|Element} root 正文容器或 document
 */
function extractOutline(root) {
  root = root || (typeof document !== 'undefined' ? document : null);
  if (!root) return [];

  // ---- 策略 1：H1-H6 语义标签（需 ≥2 个才算有目录）----
  const headings = root.querySelectorAll('h1, h2, h3, h4');
  if (headings.length >= 2) {
    const out = [];
    const seen = new Set();
    for (const h of headings) {
      const text = (h.textContent || '').trim();
      if (!text || text.length > 80) continue;
      const level = h.tagName.toLowerCase();
      const key = level + '|' + text;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ level, text });
    }
    if (out.length >= 2) return out;
  }

  // ---- 策略 2：带编号的段落（微信等样式标题站点）----
  return extractOutlineFromNumberedParagraphs(root);
}

/**
 * 从带编号的 <p>/<section> 提取大纲
 * 匹配形如「1 标题」「2.1 标题」「1.1.1 标题」的段落
 */
function extractOutlineFromNumberedParagraphs(root) {
  const raw = [];
  // root 已限定在正文容器内，直接找 p（微信用 p，也有站点用 section）
  const blocks = root.querySelectorAll('p, section');
  const numRe = /^(\d+(?:\.\d+)*)[\s.、．:：)]?\s*(.+)$/;

  for (const p of blocks) {
    const text = (p.textContent || '').trim();
    if (!text || text.length > 80) continue;
    const m = text.match(numRe);
    if (!m) continue;
    const num = m[1];
    const title = m[2].trim();
    if (!title || title.length > 50) continue; // 标题部分过长 → 是正文不是标题
    // 跳过看起来像正文句子（含句号/逗号过多的）
    if ((title.match(/[，。；,;]/g) || []).length > 1) continue;

    const depth = num.split('.').length;
    const level = depth === 1 ? 'h2' : depth === 2 ? 'h3' : 'h4';
    raw.push({ num, title, level, text: num + ' ' + title });
  }

  if (raw.length === 0) return [];

  // 去重：同一编号只保留第一条（文章可能在目录区和正文区都带编号）
  const byNum = new Map();
  for (const h of raw) {
    if (!byNum.has(h.num)) byNum.set(h.num, h);
  }

  // 按编号数值排序：0 < 1 < 1.1 < 1.2 < 2 < 2.1 ...
  return [...byNum.values()].sort((a, b) => {
    const pa = a.num.split('.').map(Number);
    const pb = b.num.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = pa[i] ?? 0;
      const vb = pb[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  });
}

async function extractContent(rawUrl, lang) {
  const url = validateUrl(rawUrl, lang);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw makeError(lang, 'err.fetchTimeout', null, 'timeout');
    }
    throw makeError(lang, 'err.fetchFailed', { msg: err.message }, 'fetch_failed');
  }

  if (!resp.ok) {
    throw makeError(lang, 'err.httpError', { status: resp.status }, 'http_error');
  }

  const html = await resp.text();
  // 用静默 VirtualConsole 创建 jsdom，避免 CSS 解析警告污染日志
  const dom = new JSDOM(html, { url, virtualConsole: silentConsole });
  const document = dom.window.document;

  // 元数据（用完整 document）
  const meta = extractMetadata(document, url);

  // ---- 正文提取 ----
  // Readability 对部分站点（尤其微信公众号）效果很差：微信正文嵌套大量 section，
  // 会被误判为非正文而整段删除（实测 10873 字被砍到 39 字）。
  // 因此对「已知有明确正文容器」的站点，直接用容器文本，不走 Readability。
  const knownContainer = document.querySelector('#js_content, .rich_media_content');
  let text = '';
  let title = '';
  let rawHtml = ''; // 原始正文 HTML，后续清洗为 contentHtml
  let outlineRoot = document; // 大纲查找的根节点

  if (knownContainer) {
    // 微信等：直接用正文容器
    text = cleanText(knownContainer.textContent);
    rawHtml = knownContainer.innerHTML;
    title = (
      document.querySelector('#activity-name')?.textContent?.trim() ||
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      document.title ||
      url
    ).trim();
    outlineRoot = knownContainer; // 大纲限定在正文容器内，避免误抓文章标题
  }

  // 其他站点 / 容器文本为空时，回退到 Readability
  if (!text) {
    let article;
    try {
      article = new Readability(document).parse();
    } catch (err) {
      throw makeError(lang, 'err.parseFailed', { msg: err.message }, 'parse_failed');
    }
    if (article && article.textContent && article.textContent.trim()) {
      text = cleanText(article.textContent);
      title = (article.title || document.title || url).trim();
      rawHtml = article.content || knownContainer?.innerHTML || '';
      // Readability 输出的 HTML 作为大纲根
      if (article.content) {
        const rDom = new JSDOM(article.content);
        outlineRoot = rDom.window.document.body || document;
      }
    }
  }

  if (!text) {
    throw makeError(lang, 'err.noContent', null, 'no_content');
  }

  text = text.slice(0, MAX_CONTENT_CHARS);

  // 大纲：在正文容器内查找
  const outline = extractOutline(outlineRoot);

  // 清洗为可安全渲染的结构化 HTML（白名单标签/属性 + 图片自适应）
  const contentHtml = sanitizeHtml(rawHtml, url);

  return {
    title,
    text,
    contentHtml,
    url,
    author: meta.author,
    platform: meta.platform,
    publishedAt: meta.publishedAt,
    outline
  };
}

/** 压缩空白：连续空格/换行归并，保留段落换行 */
function cleanText(s) {
  return (s || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 允许保留的标签白名单（结构化富文本）
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'strong', 'b', 'em', 'i', 'u', 'del', 's', 'mark', 'sub', 'sup',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'div', 'section'
]);

/**
 * 清洗 HTML：白名单过滤标签和属性，避免 XSS + 去掉无关脚本/样式。
 * 把相对图片地址解析为绝对地址；给 H 标签加 id 便于目录锚点。
 * @param {string} raw 原始 innerHTML
 * @param {string} baseUrl 用于解析相对 URL
 * @returns {string} 安全的结构化 HTML
 */
function sanitizeHtml(raw, baseUrl) {
  if (!raw) return '';
  let dom;
  try {
    dom = new JSDOM(`<div id="root">${raw}</div>`);
  } catch {
    return '';
  }
  const root = dom.window.document.querySelector('#root');

  // 递归清洗
  const clean = (node) => {
    // 子节点快照（遍历中会修改 children）
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === 8 /* COMMENT */) {
        node.removeChild(child);
        continue;
      }
      if (child.nodeType === 3 /* TEXT */) continue;
      if (child.nodeType !== 1 /* ELEMENT */) {
        node.removeChild(child);
        continue;
      }
      const tag = child.tagName.toLowerCase();

      // 非白名单标签：若内部可能有内容则 unwrap（用子节点替换自身），否则删除
      if (!ALLOWED_TAGS.has(tag)) {
        const parent = child.parentNode;
        if (parent) {
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          parent.removeChild(child);
        }
        continue;
      }

      // 清属性：只保留白名单属性。inline style 一律清除——字体/颜色/排版统一交给
      // 项目 CSS 渲染，避免原文样式覆盖（微信等会把 font-family/font-size/letter-spacing
      // 混进 color: 开头的 style 里，导致字体不一致、代码块字体被改成非等宽）。
      // 加粗/斜体等强调靠 <strong>/<em> 语义标签 + 项目 CSS，不依赖 inline style。
      const attrs = Array.from(child.attributes);
      const keepAttrs = [];
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();
        if (['src', 'href', 'alt', 'title', 'colspan', 'rowspan'].includes(name)) {
          keepAttrs.push([name, attr.value]);
        }
      }
      while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
      for (const [n, v] of keepAttrs) child.setAttribute(n, v);

      // 危险脚本属性
      child.removeAttribute('onclick');
      child.removeAttribute('onload');
      child.removeAttribute('onerror');

      // 图片：src 解析为绝对地址
      if (tag === 'img') {
        const src = child.getAttribute('src');
        if (src) {
          try {
            child.setAttribute('src', new URL(src, baseUrl).href);
          } catch { /* 忽略非法 src */ }
        }
        child.setAttribute('loading', 'lazy');
      }
      // 链接：href 解析 + 安全跳转
      if (tag === 'a') {
        const href = child.getAttribute('href');
        if (href) {
          try {
            child.setAttribute('href', new URL(href, baseUrl).href);
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          } catch { /* 忽略 */ }
        }
      }
      // H 标签：加 id 便于目录锚点跳转
      if (/^h[1-6]$/.test(tag) && !child.id) {
        const text = (child.textContent || '').trim().slice(0, 40);
        if (text) {
          child.id = 'h-' + text.replace(/[^\w\u4e00-\u9fa5]+/g, '-').toLowerCase().replace(/^-|-$/g, '');
        }
      }

      clean(child);
      // 清理微信等残留的空块（<ul><li></li></ul> 占位会渲染成空的项目符号；
      // 子节点被移除后变空的 section/div/p 也一并清理，避免留空隙）
      if (['p', 'div', 'section', 'ul', 'ol', 'li'].includes(tag) &&
          !child.textContent.trim() && !child.querySelector('img')) {
        child.remove();
      }
    }
  };
  clean(root);

  return root.innerHTML;
}

module.exports = { extractContent, validateUrl, sanitizeHtml };
