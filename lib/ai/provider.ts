/**
 * AI 服务商配置（服务端专用）
 *
 * 通过环境变量选择 OpenAI 兼容协议的服务商：
 *   AI_PROVIDER=deepseek | mimo | openai
 *   DEEPSEEK_API_KEY / MIMO_API_KEY / OPENAI_API_KEY
 *   AI_MODEL / AI_BASE_URL 可覆盖预设
 *
 * 未配置或仍是占位值时返回 null，路由会给出明确提示。
 */
import 'server-only';

export interface AIProvider {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ProviderPreset {
  keyEnv: string;
  baseUrl: string;
  model: string;
}

const PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    keyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  // 其他 OpenAI 兼容服务：必须自行提供 baseUrl 与 model
  mimo: { keyEnv: 'MIMO_API_KEY', baseUrl: '', model: '' },
};

/** 占位值（.env.example 里的 your-xxx）视为未配置 */
function isPlaceholder(value: string): boolean {
  return /^your[-_]?/i.test(value) || value === 'sk-xxx' || value === '';
}

export function getAIProvider(): AIProvider | null {
  const name = (process.env.AI_PROVIDER || 'deepseek').trim().toLowerCase();
  const preset = PRESETS[name] ?? PRESETS.deepseek;
  const upper = name.toUpperCase();

  const apiKey = (process.env[preset.keyEnv] || process.env.AI_API_KEY || '').trim();
  if (isPlaceholder(apiKey)) return null;

  const baseUrl = (
    process.env.AI_BASE_URL ||
    process.env[`${upper}_BASE_URL`] ||
    preset.baseUrl ||
    ''
  ).trim();
  const model = (
    process.env.AI_MODEL ||
    process.env[`${upper}_MODEL`] ||
    preset.model ||
    ''
  ).trim();

  if (!baseUrl || !model) return null;

  return {
    name,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
  };
}
