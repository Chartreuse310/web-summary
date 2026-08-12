/**
 * 后端 i18n：用于本地化用户可见的错误信息。
 *
 * 前端通过 X-Lang 请求头告知当前语言（zh / en），路由层用 pickLang(req) 读取后
 * 透传给 extract/llm 等模块，或在 catch 里直接 t(lang, key, params) 渲染。
 *
 * 抛错约定：面向用户的 Error 同时携带 err.code，供 server.js 判定 HTTP 状态码
 * （超时/无法访问/HTTP 错误/未配置/鉴权失效/被拒 → 502，其余 → 400）。
 */
const DICT = {
  zh: {
    'err.urlInvalid': '网址格式不正确，请输入完整的 URL（以 http:// 或 https:// 开头）',
    'err.urlScheme': '仅支持 http:// 或 https:// 开头的网址',
    'err.fetchTimeout': '抓取网页超时（10 秒），请稍后重试或换一个网址',
    'err.fetchFailed': '无法访问该网址：{msg}',
    'err.httpError': '目标网页返回错误（HTTP {status}），无法抓取',
    'err.parseFailed': '网页正文解析失败：{msg}',
    'err.noContent': '未能从该网页提取到有效正文，可能是纯图片/视频页或需要登录',

    'err.providerNotFound': '未找到服务商：{id}',
    'err.providerNotConfigured': '服务商「{name}」未配置 API Key。请在「设置」中填写，或在后端 .env 设置 {env}',
    'err.noProvider': '缺少服务商配置（provider 或 providerId）',
    'err.modelNotSupported': '服务商「{name}」不支持模型：{model}',
    'err.aiTimeout': 'AI 接口响应超时（60 秒），请稍后重试',
    'err.aiRequestFailed': 'AI 接口请求失败：{msg}',
    'err.aiAuthInvalid': 'API Key 无效或已过期，请检查 {env}',
    'err.aiRateLimit': '请求过于频繁或额度已用完，请稍后再试',
    'err.aiModelAccess': '当前账号无权访问模型「{model}」。请换一个该账号有权限的模型（下拉列表中的均为白名单内模型）。',
    'err.aiAccessDenied': '访问被拒绝（403）：{detail}',
    'err.aiHttpError': 'AI 接口返回错误（HTTP {status}）：{detail}',
    'err.aiEmpty': 'AI 返回了空内容，请稍后重试',

    'err.urlRequired': '请输入要总结的网址',
    'err.modelRequired': '请选择模型',
    'err.providerRequiredSrv': '请选择服务商（或到「设置」中配置）',
    'err.unknown': '未知错误',
    'err.notFound': '接口不存在',

    'test.fillRequired': '请填写 baseUrl、API Key、模型',
    'test.ok': '连接成功',
    'test.authInvalid': 'API Key 无效或已过期',
    'test.urlError': '接口地址错误或模型不存在',
    'test.rateLimit': '请求过于频繁或额度用完',
    'test.httpError': '服务商返回 HTTP {status}{detail}',
    'test.timeout': '连接超时（15 秒）',
    'test.failed': '连接失败：{msg}',

    'err.missingFields': '缺少必填字段（url/title/summary/model）',
    'err.saveFailed': '保存失败：{msg}',
    'err.queryFailed': '查询失败：{msg}',
    'err.clippingNotFound': '剪藏不存在',
    'err.updateFailed': '更新失败：{msg}',
    'err.highlightMissingFields': '缺少高亮文本',
    'err.highlightNotFound': '高亮不存在',
    'stats.unknown': '未知',
    'err.statsFailed': '统计失败：{msg}',
    'err.trendFailed': '趋势查询失败：{msg}',
    'err.clustersFailed': '聚类查询失败：{msg}'
  },
  en: {
    'err.urlInvalid': 'Invalid URL. Please enter a full URL starting with http:// or https://',
    'err.urlScheme': 'Only http:// or https:// URLs are supported',
    'err.fetchTimeout': 'Fetch timeout (10s). Please retry or try another URL.',
    'err.fetchFailed': 'Cannot access URL: {msg}',
    'err.httpError': 'Target page returned an error (HTTP {status}), cannot fetch',
    'err.parseFailed': 'Failed to parse page content: {msg}',
    'err.noContent': 'No valid content extracted; the page may be image/video-only or require login.',

    'err.providerNotFound': 'Provider not found: {id}',
    'err.providerNotConfigured': 'Provider "{name}" has no API Key. Set it in Settings, or set {env} in backend .env',
    'err.noProvider': 'Missing provider config (provider or providerId)',
    'err.modelNotSupported': 'Provider "{name}" does not support model: {model}',
    'err.aiTimeout': 'AI response timeout (60s). Please retry.',
    'err.aiRequestFailed': 'AI request failed: {msg}',
    'err.aiAuthInvalid': 'API Key invalid or expired. Check {env}',
    'err.aiRateLimit': 'Rate limited or quota exhausted. Please retry.',
    'err.aiModelAccess': 'Your account cannot access model "{model}". Try another whitelisted model.',
    'err.aiAccessDenied': 'Access denied (403): {detail}',
    'err.aiHttpError': 'AI returned error (HTTP {status}): {detail}',
    'err.aiEmpty': 'AI returned empty content. Please retry.',

    'err.urlRequired': 'Please enter a URL to summarize',
    'err.modelRequired': 'Please select a model',
    'err.providerRequiredSrv': 'Please select a provider (or configure one in Settings)',
    'err.unknown': 'Unknown error',
    'err.notFound': 'Endpoint not found',

    'test.fillRequired': 'Please fill Base URL, API Key and model',
    'test.ok': 'Connected',
    'test.authInvalid': 'API Key invalid or expired',
    'test.urlError': 'Base URL invalid or model not found',
    'test.rateLimit': 'Rate limited or quota exhausted',
    'test.httpError': 'Provider returned HTTP {status}{detail}',
    'test.timeout': 'Connection timeout (15s)',
    'test.failed': 'Connection failed: {msg}',

    'err.missingFields': 'Missing required fields (url/title/summary/model)',
    'err.saveFailed': 'Save failed: {msg}',
    'err.queryFailed': 'Query failed: {msg}',
    'err.clippingNotFound': 'Clipping not found',
    'err.updateFailed': 'Update failed: {msg}',
    'err.highlightMissingFields': 'Highlight text is missing',
    'err.highlightNotFound': 'Highlight not found',
    'stats.unknown': 'Unknown',
    'err.statsFailed': 'Stats failed: {msg}',
    'err.trendFailed': 'Trend query failed: {msg}',
    'err.clustersFailed': 'Clusters query failed: {msg}'
  }
};

function t(lang, key, params) {
  const table = DICT[lang] || DICT.zh;
  let s = table[key] || DICT.zh[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v == null ? '' : String(v));
    }
  }
  return s;
}

function pickLang(req) {
  const h = req && req.headers && (req.headers['x-lang'] || req.headers['X-Lang']);
  return h === 'en' ? 'en' : 'zh';
}

/** 创建一个面向用户的错误（带 code 供状态码判定） */
function makeError(lang, key, params, code) {
  const e = new Error(t(lang, key, params));
  if (code) e.code = code;
  return e;
}

module.exports = { t, pickLang, makeError, DICT };
