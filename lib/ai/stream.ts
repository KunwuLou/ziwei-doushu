/**
 * OpenAI 兼容协议的流式调用封装（服务端专用）
 *
 * 上游返回的 SSE 会被解析成纯文本增量，再由调用方决定如何输出。
 */
import 'server-only';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class UpstreamError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`上游模型返回 ${status}`);
    this.name = 'UpstreamError';
    this.status = status;
    this.detail = detail.slice(0, 500);
  }
}

export interface StreamOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** 逐段产出模型输出的文本增量 */
export async function* streamChatCompletion(
  opts: StreamOptions,
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature ?? 0.7,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new UpstreamError(res.status, detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        if (!payload) continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta;
          // 部分服务商会先吐 reasoning_content（如推理模型），这里只取正文
          const text = delta?.content;
          if (typeof text === 'string' && text.length > 0) yield text;
        } catch {
          // 忽略心跳/非 JSON 行
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

/** 把文本增量包装成前端约定的 SSE 响应：data: {"delta":{"text":"..."}} + [DONE] */
export function createSSEResponse(generator: AsyncGenerator<string, void, unknown>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        for await (const text of generator) {
          send({ delta: { text } });
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        const message = err instanceof UpstreamError ? err.detail || err.message : '生成中断';
        send({ error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
