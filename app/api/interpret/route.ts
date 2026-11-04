/**
 * POST /api/interpret
 *
 * 请求：{ chart: ZiweiChart, messages: { role: 'user'|'assistant', content: string }[] }
 * 响应：SSE 流
 *   data: {"delta":{"text":"..."}}
 *   data: [DONE]
 *
 * 开源版原本没有这个路由，这里是自行实现的版本：
 * 命盘由前端引擎算好后传上来，服务端只负责组装提示词并转发给 OpenAI 兼容模型。
 */
import 'server-only';

import { buildChartBrief } from '@/lib/ai/chart-brief';
import { guard } from '@/lib/ai/guard';
import { buildInterpretSystemPrompt } from '@/lib/ai/prompts';
import { getAIProvider } from '@/lib/ai/provider';
import { createSSEResponse, streamChatCompletion, type ChatMessage } from '@/lib/ai/stream';
import type { ZiweiChart } from '@/lib/ziwei/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 4000;
const TIMEOUT_MS = 180_000;

interface InterpretBody {
  chart?: ZiweiChart;
  messages?: Array<{ role?: string; content?: string }>;
}

function isChart(value: unknown): value is ZiweiChart {
  if (!value || typeof value !== 'object') return false;
  const chart = value as Partial<ZiweiChart>;
  return (
    Array.isArray(chart.palaces) &&
    chart.palaces.length === 12 &&
    typeof chart.mingGongBranch === 'number'
  );
}

function sanitizeMessages(input: InterpretBody['messages']): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content!.slice(0, MAX_CONTENT_CHARS),
    }))
    .filter(m => m.content.trim().length > 0);
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const provider = getAIProvider();
  if (!provider) {
    return Response.json(
      { error: '未配置 AI 模型：请在 .env.local 填写 DEEPSEEK_API_KEY（或 AI_PROVIDER / AI_MODEL）后重启 dev server' },
      { status: 503 },
    );
  }

  let body: InterpretBody;
  try {
    body = (await req.json()) as InterpretBody;
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!isChart(body.chart)) {
    return Response.json({ error: '缺少或非法的命盘数据（chart）' }, { status: 400 });
  }

  const history = sanitizeMessages(body.messages);
  if (history.length === 0) {
    return Response.json({ error: '缺少提问内容（messages）' }, { status: 400 });
  }

  const systemPrompt = buildInterpretSystemPrompt(buildChartBrief(body.chart));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  req.signal.addEventListener('abort', () => controller.abort());

  async function* withCleanup() {
    try {
      yield* streamChatCompletion({
        apiKey: provider!.apiKey,
        baseUrl: provider!.baseUrl,
        model: provider!.model,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        temperature: 0.7,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return createSSEResponse(withCleanup());
}
