/**
 * 统一 LLM 调用（OpenAI 兼容接口）
 *
 * 所有服务商（智谱 GLM / paratera / …）都走 POST {baseUrl}/chat/completions，
 * 用 Authorization: Bearer 鉴权。响应里的 usage 字段是计费基础。
 */
require('dotenv').config();
const { providers } = require('../config/providers');
const { makeError } = require('./i18n');

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

const SYSTEM_PROMPTS = {
  zh:
    '你是一个专业的网页内容总结助手。请根据用户提供的网页正文，' +
    '同时生成【一句话总结】【摘要】【标签】三部分，严格按以下 JSON 格式输出（不要输出任何其他内容）：\n\n' +
    '{\n' +
    '  "oneliner": "一句话核心概括",\n' +
    '  "summary": "完整摘要文本",\n' +
    '  "tags": ["标签1", "标签2", "标签3"]\n' +
    '}\n\n' +
    '要求：\n' +
    '1. oneliner 是一句话（≤30 字）的核心概括，高度凝练，让读者一眼抓住文章本质；' +
    '不要用「本文介绍了…」「这篇文章…」这类开头，直接陈述核心内容；\n' +
    '2. summary 先用一句话概括核心主题，再用 3-5 个要点（以「• 」开头，换行分隔）列出关键信息；' +
    '总字数控制在 300 字以内，语言精炼、信息密度高；\n' +
    '3. tags 给出 3-5 个最能代表本文主题的中文标签，简洁（每个 2-6 字）；' +
    '应覆盖领域/主题而非具体细节，如「人工智能」「产品设计」「宏观经济」；\n' +
    '4. 即使原文是英文或其他语言，所有输出都必须用中文呈现；\n' +
    '5. 只输出 JSON，不要包裹 markdown 代码块，不要任何解释。',
  en:
    'You are a professional web content summarizer. Based on the page text provided by the user, ' +
    'generate three parts — [one-liner] [summary] [tags] — and output strictly in this JSON format (nothing else):\n\n' +
    '{\n' +
    '  "oneliner": "one-sentence core gist",\n' +
    '  "summary": "full summary text",\n' +
    '  "tags": ["tag1", "tag2", "tag3"]\n' +
    '}\n\n' +
    'Requirements:\n' +
    '1. oneliner: a single sentence (≤20 words) capturing the essence; do not open with "This article…"; state the core directly;\n' +
    '2. summary: open with one sentence on the core theme, then 3-5 bullet points (each starting with "• ", newline-separated) ' +
    'covering key information; keep under 200 words, concise and information-dense;\n' +
    '3. tags: 3-5 tags best representing the topic, concise (1-3 words each); ' +
    'cover domain/theme rather than specific details, e.g. "AI", "Product Design", "Macroeconomics";\n' +
    '4. Regardless of the source language, all output must be in English;\n' +
    '5. Output JSON only — no markdown code fences, no explanation.'
};

function buildSystemPrompt(lang) {
  return SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.zh;
}

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

/**
 * 解析服务商来源：
 *   - 优先用前端传入的 provider 对象（{baseUrl, apiKey, model, name?, models?}）
 *   - 兜底用 providerId 查 .env（兼容老用法）
 * 返回标准化的 {baseUrl, apiKey, model, name, models}
 */
function resolveProvider({ provider, providerId, model, lang }) {
  // 优先：前端传入的完整 provider 配置（无状态转发模式）
  if (provider && provider.baseUrl && provider.apiKey) {
    return {
      baseUrl: provider.baseUrl.replace(/\/$/, ''),
      apiKey: provider.apiKey,
      model,
      name: provider.name || '自定义服务商',
      models: provider.models // 可能 undefined（自定义服务商不强校验模型列表）
    };
  }

  // 兜底：按 providerId 查 .env（老用法 / 服务端预配置）
  if (providerId) {
    const p = providers.find((x) => x.id === providerId);
    if (!p) {
      throw makeError(lang, 'err.providerNotFound', { id: providerId }, 'not_configured');
    }
    const apiKey = process.env[p.apiKeyEnv];
    if (!apiKey) {
      throw makeError(
        lang,
        'err.providerNotConfigured',
        { name: p.name, env: p.apiKeyEnv },
        'not_configured'
      );
    }
    return { ...p, apiKey, model };
  }

  throw makeError(lang, 'err.noProvider', null, 'not_configured');
}

/**
 * 调用 LLM 生成摘要
 * @param {object} opts
 *   - provider: {baseUrl, apiKey, name?, models?} 前端传入的无状态配置（优先）
 *   - providerId: string 兜底，查 .env 的服务商 id
 *   - model, text, title
 * @returns {Promise<{oneliner, summary, tags, usage, model}>}
 */
async function summarize(opts) {
  const { provider: providerArg, providerId, model, text, title, lang } = opts;
  const provider = resolveProvider({ provider: providerArg, providerId, model, lang });

  // 模型校验：仅当服务商有明确模型列表时才校验（自定义服务商放行，信任用户输入）
  if (provider.models) {
    const allModels = flattenModels(provider.models);
    if (allModels.length > 0 && !allModels.includes(model)) {
      throw makeError(lang, 'err.modelNotSupported', { name: provider.name, model }, 'bad_request');
    }
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(lang) },
    {
      role: 'user',
      content: lang === 'en'
        ? `Page title: ${title}\n\nPage body:\n${text}`
        : `网页标题：${title}\n\n网页正文：\n${text}`
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
      throw makeError(lang, 'err.aiTimeout', null, 'timeout');
    }
    throw makeError(lang, 'err.aiRequestFailed', { msg: err.message }, 'fetch_failed');
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
      throw makeError(lang, 'err.aiAuthInvalid', { env: provider.apiKeyEnv || '' }, 'auth_invalid');
    }
    if (resp.status === 429) {
      throw makeError(lang, 'err.aiRateLimit', null, 'rate_limit');
    }
    if (resp.status === 403) {
      // 常见情况：账号无权访问该模型（team not allowed to access model）
      if (/not allowed|access model|team/i.test(detail)) {
        throw makeError(lang, 'err.aiModelAccess', { model }, 'access_denied');
      }
      throw makeError(lang, 'err.aiAccessDenied', { detail }, 'access_denied');
    }
    throw makeError(lang, 'err.aiHttpError', { status: resp.status, detail }, 'http_error');
  }

  const data = await resp.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw makeError(lang, 'err.aiEmpty', null, 'bad_request');
  }

  // usage 字段：{ prompt_tokens, completion_tokens, total_tokens }
  const usage = data.usage || null;

  // 解析 AI 返回的 JSON {oneliner, summary, tags}
  const parsed = parseSummaryJson(rawContent);

  return { ...parsed, usage, model };
}

/**
 * 解析 AI 返回的内容为 { oneliner, summary, tags }
 * 容错：剥离 markdown 代码块包裹；解析失败时把原文当作摘要，其余置空。
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
    const oneliner = typeof obj.oneliner === 'string' ? obj.oneliner.trim() : '';
    const tags = Array.isArray(obj.tags)
      ? obj.tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : [];
    return {
      summary: summary || raw.trim(),
      oneliner: oneliner || '',
      tags
    };
  } catch {
    // 兜底：当纯文本摘要处理
    return { summary: raw.trim(), oneliner: '', tags: [] };
  }
}

module.exports = { summarize, resolveProvider, flattenModels };
