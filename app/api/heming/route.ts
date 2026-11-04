/**
 * POST /api/heming
 *
 * 请求：{ chartA: ZiweiChart, chartB: ZiweiChart, question?: string }
 * 响应：SSE 流（格式与 /api/interpret 一致）
 *
 * 合盘方法论来自 lib/ziwei/heming-knowledge.ts（倪师体系：命宫 + 夫妻宫 + 福德宫联参）。
 */
import 'server-only';

import { buildHemingBrief } from '@/lib/ai/chart-brief';
import { guard } from '@/lib/ai/guard';
import { buildHemingSystemPrompt } from '@/lib/ai/prompts';
import { getAIProvider } from '@/lib/ai/provider';
import { createSSEResponse, streamChatCompletion, type ChatMessage } from '@/lib/ai/stream';
import { HEMING_METHODOLOGY } from '@/lib/ziwei/heming-knowledge';
import type { ZiweiChart } from '@/lib/ziwei/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_QUESTION_CHARS = 1000;
const TIMEOUT_MS = 180_000;

interface HemingBody {
  chartA?: ZiweiChart;
  chartB?: ZiweiChart;
  question?: string;
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

  let body: HemingBody;
  try {
    body = (await req.json()) as HemingBody;
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!isChart(body.chartA) || !isChart(body.chartB)) {
    return Response.json({ error: '缺少或非法的双方命盘（chartA / chartB）' }, { status: 400 });
  }

  const question = (body.question ?? '').trim().slice(0, MAX_QUESTION_CHARS);
  const systemPrompt = buildHemingSystemPrompt(
    buildHemingBrief(body.chartA, body.chartB),
    HEMING_METHODOLOGY,
  );

  const history: ChatMessage[] = [
    {
      role: 'user',
      content: question
        ? `请分析这两份命盘的合盘情况，并重点回答：${question}`
        : '请分析这两份命盘的合盘情况，按框架给出完整分析。',
    },
  ];

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
