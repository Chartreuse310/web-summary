/**
 * 服务商 & 模型配置
 *
 * 所有服务商均使用 OpenAI 兼容接口（POST {baseUrl}/chat/completions），
 * 因此底层调用逻辑只有一套，新增服务商只需在此追加一条配置。
 *
 * 字段说明：
 *   id        唯一标识，前端选择时传回
 *   name      展示名
 *   baseUrl   OpenAI 兼容接口的 base URL（不含 /chat/completions）
 *   apiKeyEnv 对应 .env 中的环境变量名；启动时若该变量为空，服务商会被隐藏
 *   models    该服务商支持的模型列表。支持两种写法：
 *             ① 字符串（平铺）：'glm-4-flash'
 *             ② 分组对象：{ group: 'DeepSeek', items: ['DeepSeek-V3.2', ...] }
 *             前端会渲染成 <optgroup>，方便长列表分类浏览。
 *
 * 注意：本工具只做「文本总结」，因此只保留文本对话类模型；
 *       Embedding / 重排序 / ASR / OCR / 文生图 / 文生视频等模型已剔除
 *       （它们无法产出文本摘要，调用必失败）。
 */
module.exports = {
  providers: [
    {
      id: 'zhipu',
      name: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKeyEnv: 'ZHIPU_API_KEY',
      models: ['glm-4-flash', 'glm-4', 'glm-4-long']
    },
    {
      id: 'paratera',
      name: '并行科技 paratera',
      baseUrl: 'https://llmapi.paratera.com/v1',
      apiKeyEnv: 'PARATERA_API_KEY',
      // 模型清单基于账号实际可访问权限（来自 403 响应白名单），
      // 已剔除 Embedding/OCR/文生图/文生视频/语音 等非文本对话模型。
      models: [
        // —— 常用（置顶）——
        {
          group: '常用',
          items: ['DeepSeek-V4-Flash', 'GLM-5.2']
        },
        // —— DeepSeek ——
        {
          group: 'DeepSeek',
          items: [
            'DeepSeek-V4-Pro',
            'DeepSeek-V4-Flash',
            'DeepSeek-V3.2',
            'DeepSeek-V3.2-Thinking',
            'DeepSeek-V3.2-Instruct',
            'DeepSeek-V3.2-Exp',
            'DeepSeek-V3.1',
            'DeepSeek-V3.1-Terminus',
            'DeepSeek-V3-250324',
            'DeepSeek-R1',
            'DeepSeek-R1-0528'
          ]
        },
        // —— 智谱 GLM（含 V 视觉语言模型，均支持纯文本）——
        {
          group: '智谱 GLM',
          items: [
            'GLM-5.1',
            'GLM-5',
            'GLM-5-Turbo',
            'GLM-4.7',
            'GLM-4.6',
            'GLM-4.6V',
            'GLM-4.5',
            'GLM-4.5-X',
            'GLM-4.5-Air',
            'GLM-4.5-AirX',
            'GLM-4.5-Flash',
            'GLM-4.5V',
            'GLM-4-Plus',
            'GLM-4-Flash',
            'GLM-4-FlashX',
            'GLM-4-Air',
            'GLM-4-AirX',
            'GLM-4-Long',
            'GLM-4-9B',
            'GLM-4V',
            'GLM-4V-Plus-0111',
            'GLM-4V-Flash',
            'GLM-X-F',
            'GLM-Z1-AirX',
            'GLM-Z1-Air',
            'GLM-Z1-Flash'
          ]
        },
        // —— 通义千问 Qwen ——
        {
          group: 'Qwen',
          items: [
            'Qwen3.7-Max',
            'Qwen3.7-Plus',
            'Qwen3.6-Plus',
            'Qwen3.6-27B',
            'Qwen3.5-Plus',
            'Qwen3.5-397B-A17B',
            'Qwen3.5-122B-A10B',
            'Qwen3.5-35B-A3B',
            'Qwen3.5-27B',
            'Qwen-Long'
          ]
        },
        // —— Kimi ——
        {
          group: 'Kimi',
          items: ['Kimi-K3', 'Kimi-K2.6', 'Kimi-K2.5']
        },
        // —— ERNIE 文心 ——
        {
          group: 'ERNIE',
          items: [
            'ERNIE-5.0-Thinking-Preview',
            'ERNIE-4.5-Turbo-128K',
            'ERNIE-4.5-Turbo-32K',
            'ERNIE-4.5-Turbo-VL-32K'
          ]
        },
        // —— MiniMax（仅文本）——
        {
          group: 'MiniMax',
          items: [
            'MiniMax-M3',
            'MiniMax-M2.7',
            'MiniMax-M2.5',
            'MiniMax-M2',
            'MiniMax-M1-80k',
            'MiniMax-Text-01'
          ]
        },
        // —— Baichuan 百川 ——
        {
          group: 'Baichuan',
          items: ['Baichuan-M3', 'Baichuan-M2-128K', 'Baichuan-M2']
        },
        // —— 其他 ——
        {
          group: '其他',
          items: ['Intern-S2-Preview']
        }
      ]
    }
    // 未来要加 OpenAI / DeepSeek 官方等，照此格式新增即可

  ]
};
