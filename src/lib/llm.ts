import { CONFIG } from './config';
import { FALLBACK_SOCRATIC_MCQ, LOCALISE_QUESTION, STRATEGY_STEMS } from './prompts';

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
  // A real provider without a pinned model id is a run whose data cannot be attributed to
  // a model. Fail at startup with a message that says what to set, rather than 404ing
  // halfway through a participant's session.
  const real = (make: () => LlmProvider) => {
    if (!CONFIG.llm.model) {
      throw new Error(
        'LLM_MODEL is not set. Pin an exact dated model id in .env.local before running ' +
          'with a real provider: an empty or aliased value makes the run unreproducible, ' +
          'and the study has to report which model produced the data.'
      );
    }
    return make();
  };
  if (choice === 'gemini' && process.env.GEMINI_API_KEY) return real(() => new GeminiProvider());
  if (choice === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return real(() => new AnthropicProvider());
  }
  if (choice === '' && process.env.ANTHROPIC_API_KEY) return real(() => new AnthropicProvider());
  if (choice === '' && process.env.GEMINI_API_KEY) return real(() => new GeminiProvider());
  // DEV MOCK. It used to answer every prompt with the same question, which made the
  // direct arm show a QUESTION where its explanation belongs, and made the reason judge
  // return nothing parseable. It now branches on the system prompt the way the real
  // providers do, so a keyless dev run shows each arm's real shape.
  //
  // The explanation text says out loud that no model is attached: if a session is ever
  // run without a key by mistake, that string lands in the data where it cannot be
  // mistaken for real content.
  return new MockProvider((system, user) => {
    if (system.includes('判斷一段中文回答')) return JSON.stringify({ verdict: 'accept' });
    // v6 offline grader dry run: scores nothing, so a mock-graded file is obviously fake.
    if (system.includes('文言文翻譯的評分員')) {
      return JSON.stringify({ A: { score: 0, evidence: '示範模式' }, B: { score: 0, evidence: '示範模式' }, C: { score: 0, evidence: '示範模式' } });
    }
    if (system.includes('是否與參考答案一致')) return JSON.stringify({ correct: false });
    if (system.includes('解說者')) {
      return JSON.stringify({ type: 'explain', text: MOCK_EXPLANATION });
    }
    if (system.includes('可能想問的字或詞')) {
      const selection = user.match(/讀者反白：「([^」]+)」/)?.[1] ?? '';
      const options = [...new Set([...selection.replace(/[^\u3400-\u9fff]/gu, '')])].slice(0, 4);
      return JSON.stringify({ options });
    }
    if (system.includes('只產生目前指定層次的一個開放式問題')) {
      return JSON.stringify({
        type: 'question',
        text: user.includes('目前在第 2 層')
          ? '換看相鄰一句：哪一處線索可以檢查你剛才的判斷？'
          : '對照反白文字與前後文，你看到哪些可以互相檢查的線索？',
      });
    }
    // Task-A shape: every socratic turn is a MCQ. The mock returns three neutral
    // observation options so it survives leak-checking and structure validation
    // and passes through as a normal generated turn, not the fallback.
    const wordLevel = user.includes('粒度：word');
    return JSON.stringify({
      type: 'question',
      strategy: wordLevel ? 'C' : 'A',
      text: wordLevel ? STRATEGY_FALLBACK : LOCALISE_QUESTION,
      options: FALLBACK_SOCRATIC_MCQ.options,
      answerIndex: 0,
    });
  });
}

export const STRATEGY_FALLBACK = STRATEGY_STEMS.C;
export const MOCK_EXPLANATION = '（示範模式：未接上模型）正式施測時這裡會是這個選取的白話解釋。';

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
