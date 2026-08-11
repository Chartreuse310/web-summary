/**
 * Token 用量统计 + 费用估算
 *
 * 费用 = prompt_tokens × input 单价 / 1e6 + completion_tokens × output 单价 / 1e6
 * 单位：元（人民币）。定价缺失时返回 null，UI 显示「价格未知」。
 */
const pricing = require('../config/pricing');

/**
 * @param {string} model 模型名
 * @param {{prompt_tokens:number, completion_tokens:number, total_tokens:number}|null} usage
 * @returns {{promptTokens, completionTokens, totalTokens, promptCost, completionCost, totalCost, priced:boolean}|null}
 */
function calcUsage(model, usage) {
  if (!usage) return null;

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

  const price = pricing[model];

  // 价格缺失或为 null → 只返回 token，费用置 null
  if (!price || price.input == null || price.output == null) {
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      promptCost: null,
      completionCost: null,
      totalCost: null,
      priced: false
    };
  }

  const promptCost = (promptTokens * price.input) / 1e6;
  const completionCost = (completionTokens * price.output) / 1e6;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    priced: true
  };
}

module.exports = { calcUsage };
