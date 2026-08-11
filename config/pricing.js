/**
 * 模型定价表
 *
 * 单位：元（人民币）/ 1,000,000 tokens
 *
 * 价格类型（部分平台区分命中缓存）：
 *   input   标准输入价格
 *   output  标准输出价格
 *   cachedInput   命中缓存时的输入价（可选，用于展示更细）
 *
 * 数据来源：各模型官方公开价格（截至 2026-08），仅供估算参考。
 *   - paratera 实际计费以其账户后台为准
 *   - 想改价格直接编辑这里的数值即可
 *   - 未知价格填 null，UI 会显示「价格未知，仅显示 Token」
 *
 * 特殊活动：
 *   - GLM-5.2 在 paratera 平台有夜间活动：21:00 ~ 次日 09:00 免费
 *     （费用计算仍按标准价估算；实际是否免费以平台为准）
 */
module.exports = {
  // ===== paratera 平台 —— 用户提供的准确价格 =====
  // 注：账号权限内可用的是 DeepSeek-V4-Flash（无日期后缀），价格同 V4-Flash 系列
  'DeepSeek-V4-Flash':     { input: 1, output: 2, cachedInput: 0.02 },
  'GLM-5.2':               { input: 8, output: 28, cachedInput: 2 },  // 21:00-09:00 夜间免费

  // ===== DeepSeek（官方公开价参考）=====
  'DeepSeek-V4-Pro':           { input: 2, output: 8 },
  'DeepSeek-V4-Flash':         { input: 1, output: 2 },
  'DeepSeek-V3.2':             { input: 2, output: 8 },
  'DeepSeek-V3.2-Thinking':    { input: 2, output: 8 },
  'DeepSeek-V3.2-Instruct':    { input: 1, output: 2 },
  'DeepSeek-V3.2-Exp':         { input: 2, output: 8 },
  'DeepSeek-V3.1':             { input: 2, output: 8 },
  'DeepSeek-V3.1-Terminus':    { input: 2, output: 8 },
  'DeepSeek-V3-250324':        { input: 1, output: 2 },
  'DeepSeek-R1':               { input: 4, output: 16 },
  'DeepSeek-R1-0528':          { input: 4, output: 16 },

  // ===== 智谱 GLM（官方公开价参考）=====
  'GLM-5.1':            { input: 8, output: 28 },
  'GLM-5':              { input: 8, output: 28 },
  'GLM-5-Turbo':        { input: 2, output: 6 },
  'GLM-4.7':            { input: 5, output: 5 },
  'GLM-4.6':            { input: 5, output: 5 },
  'GLM-4.6V':           { input: 5, output: 5 },
  'GLM-4.5':            { input: 5, output: 5 },
  'GLM-4.5-X':          { input: 5, output: 5 },
  'GLM-4.5-Air':        { input: 1, output: 1 },
  'GLM-4.5-AirX':       { input: 0.5, output: 0.5 },
  'GLM-4.5-Flash':      { input: 0, output: 0 },
  'GLM-4.5V':           { input: 5, output: 5 },
  'GLM-4-Plus':         { input: 50, output: 50 },
  'glm-4-flash':        { input: 0, output: 0 },
  'GLM-4-FlashX':       { input: 0, output: 0 },
  'GLM-4-Air':          { input: 0.5, output: 0.5 },
  'GLM-4-AirX':         { input: 0.5, output: 0.5 },
  'GLM-4-Long':         { input: 1, output: 1 },
  'GLM-4-9B':           { input: 0, output: 0 },
  'GLM-4V':             { input: 50, output: 50 },
  'GLM-4V-Plus-0111':   { input: 10, output: 10 },
  'GLM-4V-Flash':       { input: 0, output: 0 },
  'glm-4':              { input: 50, output: 50 },
  'glm-4-long':         { input: 1, output: 1 },

  // ===== 通义千问 Qwen（官方公开价参考）=====
  'Qwen3.7-Max':          { input: 24, output: 96 },
  'Qwen3.7-Plus':         { input: 4, output: 12 },
  'Qwen3.6-Plus':         { input: 4, output: 12 },
  'Qwen3.6-27B':          { input: 2, output: 6 },
  'Qwen3.5-Plus':         { input: 4, output: 12 },
  'Qwen3.5-397B-A17B':    { input: 4, output: 12 },
  'Qwen3.5-122B-A10B':    { input: 4, output: 12 },
  'Qwen3.5-35B-A3B':      { input: 2, output: 6 },
  'Qwen3.5-27B':          { input: 2, output: 6 },
  'Qwen-Long':            { input: 0.5, output: 2 },
  'qwen-plus':            { input: 4, output: 12 },
  'qwen-turbo':           { input: 2, output: 6 },

  // ===== Kimi / ERNIE / MiniMax / Baichuan：官方未公开细价，暂置 null =====
  // （UI 会显示「价格未知，仅显示 Token」；拿到准确价格后在此补充即可）
  'Kimi-K3':                  null,
  'Kimi-K2.6':                null,
  'Kimi-K2.5':                null,
  'ERNIE-5.0-Thinking-Preview': null,
  'ERNIE-4.5-Turbo-128K':     null,
  'ERNIE-4.5-Turbo-32K':      null,
  'ERNIE-4.5-Turbo-VL-32K':   null,
  'MiniMax-M3':               null,
  'MiniMax-M2.7':             null,
  'MiniMax-M2.5':             null,
  'MiniMax-M2':               null,
  'MiniMax-M1-80k':           null,
  'MiniMax-Text-01':          null,
  'Baichuan-M3':              null,
  'Baichuan-M2-128K':         null,
  'Baichuan-M2':              null,
  'Intern-S2-Preview':        null,

  // ===== 其他特殊/实验性（未知价）=====
  'GLM-X-F':      null,
  'GLM-Z1-AirX':  null,
  'GLM-Z1-Air':   null,
  'GLM-Z1-Flash': null
};
