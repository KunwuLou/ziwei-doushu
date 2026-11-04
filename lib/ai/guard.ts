/**
 * AI 接口的轻量防护（服务端专用）
 *
 * - 同源校验：避免局域网内其他网页盗用你的 API Key
 * - 简单限流：内存计数，防误触刷屏
 *
 * 注意：这是开发/自用级别的防护，不适合直接对外生产部署。
 */
import 'server-only';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') || 'local';
}

/** 返回 true 表示应拒绝 */
export function isRateLimited(req: Request): boolean {
  const key = clientKey(req);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // 顺手清理过期桶，避免 Map 无限增长
    if (buckets.size > 500) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_PER_WINDOW;
}

/** 跨站调用返回 false */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // curl 等非浏览器调用

  const host = req.headers.get('host');
  if (!host) return false;

  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return true;
    // 本机访问时 localhost / 127.0.0.1 混用是常见的，放行
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const stripPort = (h: string) => h.replace(/:\d+$/, '');
    return localHosts.has(stripPort(originHost)) && localHosts.has(stripPort(host));
  } catch {
    return false;
  }
}

export function guard(req: Request): Response | null {
  if (!isSameOrigin(req)) {
    return Response.json({ error: '仅允许本站页面调用该接口' }, { status: 403 });
  }
  if (isRateLimited(req)) {
    return Response.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
  }
  return null;
}
