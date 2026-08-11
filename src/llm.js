/**
 * 统一 LLM 调用（OpenAI 兼容接口）
 *
 * 所有服务商（智谱 GLM / paratera / …）都走 POST {baseUrl}/chat/completions，
 * 用 Authorization: Bearer 鉴权。响应里的 usage 字段是计费基础。
 */
require('dotenv').config();
const { providers } = require('../config/providers');

/**
 * 把服务商的 models 配置（可能含分组）扁平化为模型 id 数组
 * @param {Array} modelsConfig providers[i].models
 * @returns {string[]} 模型 id 列表
 */
function flattenModels(modelsConfig) {
  const out = [];
  for (const entry of modelsConfig) {
    if (typeof entry === 'string') {
      out.push(entry);
    } else if (entry && Array.isArray(entry.items)) {
      out.push(...entry.items);
    }
  }
  return out;
}

const SYSTEM_PROMPT =
  '你是一个专业的网页内容总结助手。请根据用户提供的网页正文，' +
  '同时生成【摘要】和【标签】两部分，严格按以下 JSON 格式输出（不要输出任何其他内容）：\n\n' +
  '{\n' +
  '  "summary": "摘要文本",\n' +
  '  "tags": ["标签1", "标签2", "标签3"]\n' +
  '}\n\n' +
  '要求：\n' +
  '1. summary 先用一句话概括核心主题，再用 3-5 个要点（以「• 」开头，换行分隔）列出关键信息；' +
  '总字数控制在 300 字以内，语言精炼、信息密度高；\n' +
  '2. tags 给出 3-5 个最能代表本文主题的中文标签，简洁（每个 2-6 字）；' +
  '应覆盖领域/主题而非具体细节，如「人工智能」「产品设计」「宏观经济」；\n' +
  '3. 即使原文是英文或其他语言，摘要和标签都必须用中文呈现；\n' +
  '4. 只输出 JSON，不要包裹 markdown 代码块，不要任何解释。';

/**
 * 根据服务商 id 取其配置（含 apiKey）
 */
function getProvider(providerId) {
  const p = providers.find((x) => x.id === providerId);
  if (!p) {
    throw new Error(`未找到服务商：${providerId}`);
  }
  const apiKey = process.env[p.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`服务商「${p.name}」未配置 API Key（请在 .env 中设置 ${p.apiKeyEnv}）`);
  }
  return { ...p, apiKey };
}

/**
 * 调用 LLM 生成摘要
 * @param {{providerId: string, model: string, text: string, title: string}} opts
 * @returns {Promise<{content: string, usage: object, model: string}>}
 */
async function summarize({ providerId, model, text, title }) {
  const provider = getProvider(providerId);

  const allModels = flattenModels(provider.models);
  if (!allModels.includes(model)) {
    throw new Error(`服务商「${provider.name}」不支持模型：${model}`);
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `网页标题：${title}\n\n网页正文：\n${text}`
    }
  ];

  let resp;
  try {
    resp = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000), // 模型生成留足时间
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3 // 摘要任务偏低温度，保证稳定
      })
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('AI 接口响应超时（60 秒），请稍后重试');
    }
    throw new Error(`AI 接口请求失败：${err.message}`);
  }

  if (!resp.ok) {
    let detail = '';
    try {
      const errBody = await resp.json();
      detail = errBody?.error?.message || errBody?.msg || JSON.stringify(errBody);
    } catch {
      detail = await resp.text().catch(() => '');
    }
    if (resp.status === 401) {
      throw new Error(`API Key 无效或已过期，请检查 ${provider.apiKeyEnv}`);
    }
    if (resp.status === 429) {
      throw new Error('请求过于频繁或额度已用完，请稍后再试');
    }
    if (resp.status === 403) {
      // 常见情况：账号无权访问该模型（team not allowed to access model）
      if (/not allowed|access model|team/i.test(detail)) {
        throw new Error(
          `当前账号无权访问模型「${model}」。请换一个该账号有权限的模型（下拉列表中的均为白名单内模型）。`
        );
      }
      throw new Error(`访问被拒绝（403）：${detail}`);
    }
    throw new Error(`AI 接口返回错误（HTTP ${resp.status}）：${detail}`);
  }

  const data = await resp.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('AI 返回了空内容，请稍后重试');
  }

  // usage 字段：{ prompt_tokens, completion_tokens, total_tokens }
  const usage = data.usage || null;

  // 解析 AI 返回的 JSON {summary, tags}
  const parsed = parseSummaryJson(rawContent);

  return { ...parsed, usage, model };
}

/**
 * 解析 AI 返回的内容为 { summary, tags }
 * 容错：剥离 markdown 代码块包裹；解析失败时把原文当作摘要，tags 置空。
 */
function parseSummaryJson(raw) {
  let text = raw.trim();
  // 剥离 ```json ... ``` 包裹
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  try {
    const obj = JSON.parse(text);
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
    const tags = Array.isArray(obj.tags)
      ? obj.tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : [];
    return { summary: summary || raw.trim(), tags };
  } catch {
    // 兜底：当纯文本摘要处理
    return { summary: raw.trim(), tags: [] };
  }
}

module.exports = { summarize, getProvider };
