import { CONFIG } from './config';

export interface LlmResult {
  text: string;
  raw: string;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export interface LlmProvider {
  name: string;
  complete(system: string, user: string): Promise<LlmResult>;
}

/** Offline provider used by tests, the smoke run and the degraded path. */
export class MockProvider implements LlmProvider {
  name = 'mock';
  private readonly responder: (system: string, user: string) => string;

  constructor(responder: (system: string, user: string) => string) {
    this.responder = responder;
  }
  async complete(system: string, user: string): Promise<LlmResult> {
    const text = this.responder(system, user);
    return { text, raw: text, latencyMs: 0, ok: true };
  }
}

/**
 * Anthropic provider over plain fetch — no SDK dependency, so the exact request is
 * visible in this file and can be checked against the API docs. Both arms MUST be
 * constructed with the same settings (CONFIG.llm), which is what makes "same model,
 * only the system prompt differs" true rather than aspirational.
 */
export class AnthropicProvider implements LlmProvider {
  name = CONFIG.llm.model;
  private readonly endpoint = 'https://api.anthropic.com/v1/messages';
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  async complete(system: string, user: string): Promise<LlmResult> {
    const started = Date.now();
    let lastError = '';
    for (let attempt = 0; attempt <= CONFIG.llm.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.llm.timeoutMs);
      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: CONFIG.llm.model,
            max_tokens: CONFIG.llm.maxTokens,
            temperature: CONFIG.llm.temperature,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        });
        const raw = await res.text();
        if (!res.ok) {
          lastError = `${res.status} ${raw.slice(0, 200)}`;
          continue;
        }
        const parsed = JSON.parse(raw) as { content?: { type: string; text?: string }[] };
        const text = (parsed.content ?? [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('');
        return { text, raw, latencyMs: Date.now() - started, ok: true };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }
    }
    return { text: '', raw: '', latencyMs: Date.now() - started, ok: false, error: lastError };
  }
}

/**
 * Google Gemini provider.
 *
 * Request shape follows the official REST reference
 * (https://ai.google.dev/api/generate-content):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<KEY>
 *   body: { systemInstruction, contents, generationConfig { temperature, maxOutputTokens } }
 *   response: candidates[0].content.parts[].text
 *
 * Swapping the provider changes BOTH arms at once, which is what keeps them
 * comparable. Whichever provider is used for real collection must be named,
 * with its exact model string, in the paper's method section.
 */
export class GeminiProvider implements LlmProvider {
  name = CONFIG.llm.model;
  private readonly base = 'https://generativelanguage.googleapis.com/v1beta/models';
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  async complete(system: string, user: string): Promise<LlmResult> {
    const started = Date.now();
    let lastError = '';
    const url = `${this.base}/${CONFIG.llm.model}:generateContent?key=${process.env.GEMINI_API_KEY ?? ''}`;
    for (let attempt = 0; attempt <= CONFIG.llm.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.llm.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
              temperature: CONFIG.llm.temperature,
              maxOutputTokens: CONFIG.llm.maxTokens,
            },
          }),
        });
        const raw = await res.text();
        if (!res.ok) {
          lastError = `${res.status} ${raw.slice(0, 200)}`;
          continue;
        }
        const parsed = JSON.parse(raw) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = (parsed.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.text ?? '')
          .join('');
        return { text, raw, latencyMs: Date.now() - started, ok: true };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }
    }
    return { text: '', raw: '', latencyMs: Date.now() - started, ok: false, error: lastError };
  }
}

/**
 * Provider selection, driven by LLM_PROVIDER in .env.local:
 *   mock      -> offline, no network (default when no key is present)
 *   anthropic -> Claude
 *   gemini    -> Google Gemini
 */
export function getProvider(): LlmProvider {
  const choice = (process.env.LLM_PROVIDER ?? '').toLowerCase();
  if (choice === 'gemini' && process.env.GEMINI_API_KEY) return new GeminiProvider();
  if (choice === 'anthropic' && process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  if (choice === '' && process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  if (choice === '' && process.env.GEMINI_API_KEY) return new GeminiProvider();
  return new MockProvider(() =>
    JSON.stringify({ type: 'question', strategy: 'C', text: STRATEGY_FALLBACK })
  );
}

export const STRATEGY_FALLBACK = '這個字在句子什麼位置？前後是什麼詞性？';

/** Models sometimes wrap JSON in prose; accept both, fail loudly otherwise. */
export function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
