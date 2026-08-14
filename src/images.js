// 正文图片本地化：微信等站点图片有防盗链（Referer 校验），浏览器直接加载会 403。
// 解析阶段把 <img src> 下载到 data/images/，src 改写为 /images/<file> 本地路径。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE_DIR = path.join(__dirname, '..', 'data', 'images');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif'
};

// 从 URL 路径推测扩展名，推测不出返回 null
function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (!m) return null;
    const ext = m[1].toLowerCase();
    return Object.values(EXT_BY_TYPE).includes(ext) ? ext : null;
  } catch {
    return null;
  }
}

// 单图下载：成功返回本地相对路径 /images/<file>，失败返回 null
async function downloadOne(url, timeoutMs) {
  let res;
  try {
    // 不带 Referer（微信允许空 Referer 访问图片）
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type] || extFromUrl(url) || 'jpg';
  const name = crypto.createHash('sha1').update(url).digest('hex') + '.' + ext;
  const file = path.join(IMAGE_DIR, name);
  try {
    if (!fs.existsSync(file)) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) return null;
      fs.mkdirSync(IMAGE_DIR, { recursive: true });
      fs.writeFileSync(file, buf);
    }
    return '/images/' + name;
  } catch (e) {
    console.warn('[images] 写入失败：', url, e.message);
    return null;
  }
}

/**
 * 把 html 中所有远程 <img src> 下载到本地并改写路径。
 * 失败的图保留原远程 src，不影响主流程。
 */
async function downloadImages(contentHtml, { concurrency = 4, timeoutMs = 8000 } = {}) {
  if (!contentHtml) return contentHtml;
  // 提取所有远程 img src（含 &amp; 转义的，jsdom innerHTML 序列化产物）
  const urls = [...new Set(
    [...contentHtml.matchAll(/<img\s[^>]*?src=("(?:[^"]*)"|'[^']*')/gi)]
      .map((m) => m[1].slice(1, -1).replace(/&amp;/g, '&'))
      .filter((u) => /^https?:\/\//i.test(u))
  )];
  if (!urls.length) return contentHtml;

  // 并发受控下载
  const localBy = {};
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      const local = await downloadOne(url, timeoutMs);
      if (local) localBy[url] = local;
      else console.warn('[images] 下载失败，保留远程 src：', url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  if (!Object.keys(localBy).length) return contentHtml;
  // 逐个替换（HTML 里的 src 可能带 &amp; 转义，两种形态都替换）
  let html = contentHtml;
  for (const [url, local] of Object.entries(localBy)) {
    const escaped = url.replace(/&/g, '&amp;');
    html = html.split(`"${escaped}"`).join(`"${local}"`)
      .split(`'${escaped}'`).join(`'${local}'`);
  }
  return html;
}

module.exports = { downloadImages };
