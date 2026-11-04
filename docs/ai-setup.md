# AI 解读接口接入说明

开源版默认不带 `/api/interpret` 和 `/api/heming`，本项目已自行实现这两个路由。
排盘仍然全部在浏览器里完成，**不需要 Key**；只有 AI 解读会调用服务端。

## 1. 目录结构

| 文件 | 作用 |
| --- | --- |
| `app/api/interpret/route.ts` | 单盘解读，SSE 流式返回 |
| `app/api/heming/route.ts` | 双盘合盘分析，SSE 流式返回 |
| `lib/ai/provider.ts` | 从环境变量解析服务商（OpenAI 兼容协议） |
| `lib/ai/stream.ts` | 调用上游 + 把上游 SSE 转成前端约定的格式 |
| `lib/ai/chart-brief.ts` | 把 `ZiweiChart` 压成紧凑文本（十二宫、大限/流年四化、格局） |
| `lib/ai/prompts.ts` | 系统提示词（方法论 + 输出约束） |
| `lib/ai/guard.ts` | 同源校验 + 内存限流 |

## 2. 配置

写在 `.env.local`（已被 `.gitignore` 忽略）：

```bash
AI_PROVIDER=deepseek          # deepseek | openai | mimo(自定义)
DEEPSEEK_API_KEY=sk-...
AI_MODEL=deepseek-chat        # 可换 deepseek-v4-pro
```

改完 `.env.local` 后 dev server 会自动重载环境变量；若没生效就重启。

自定义 OpenAI 兼容服务（不限于内置三家）：

```bash
AI_PROVIDER=mimo
MIMO_API_KEY=...
MIMO_BASE_URL=https://your-provider/v1
MIMO_MODEL=your-model
```

## 3. 接口约定

```http
POST /api/interpret
{ "chart": <ZiweiChart>, "messages": [{ "role": "user", "content": "..." }] }
```

```http
POST /api/heming
{ "chartA": <ZiweiChart>, "chartB": <ZiweiChart>, "question": "可选" }
```

两者都返回 SSE：

```
data: {"delta":{"text":"..."}}

data: [DONE]
```

`chart` 由前端 `lib/ziwei/algorithm.ts` 的 `generateChart()` 算好后直接传上来，服务端不重新排盘，因此前后端盘面必然一致。

## 4. 错误码

| 状态 | 含义 |
| --- | --- |
| 400 | 请求体缺字段 / 不是合法 JSON |
| 403 | 跨站调用（Origin 与 Host 不一致） |
| 429 | 单 IP 超过 30 次/分钟 |
| 503 | 未配置 API Key，或配置仍是占位值 |

前端只对 404 显示「开源版不含该接口」，其余错误统一提示「解读失败」。

## 5. 安全提示

- Key 只在服务端使用，不会下发到浏览器。
- `guard.ts` 只做开发级防护（同源 + 内存限流），**不适合直接公网部署**；对外部署请换成带鉴权、持久化限流的方案。
- dev server 默认监听 `0.0.0.0`，同一局域网的人打开你的地址也能用你的 Key。只想本机访问可加 `-H 127.0.0.1`。
