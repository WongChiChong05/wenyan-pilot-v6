import { describe, expect, it } from 'vitest';
import { AnthropicProvider, GeminiProvider, parseJsonObject } from '../src/lib/llm';

/**
 * Contract tests for the two HTTP providers. They check the request shape against the
 * published API references and the parsing of the documented response shape. They do NOT
 * call the real APIs — that check belongs on your machine with a real key (README §2).
 */

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('Anthropic provider', () => {
  it('posts to /v1/messages with the api key and version headers', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { f, calls } = stub(200, { content: [{ type: 'text', text: '哈囉' }] });
    const res = await new AnthropicProvider(f).complete('SYS', 'USER');
    expect(res.ok).toBe(true);
    expect(res.text).toBe('哈囉');
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.system).toBe('SYS');
    expect((body.messages as { content: string }[])[0].content).toBe('USER');
  });

  it('reports failure after the retry instead of throwing', async () => {
    const { f, calls } = stub(500, { error: 'boom' });
    const res = await new AnthropicProvider(f).complete('SYS', 'USER');
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(2); // one attempt + one retry
  });
});

describe('Gemini provider', () => {
  it('posts to generateContent with systemInstruction and generationConfig', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    const { f, calls } = stub(200, {
      candidates: [{ content: { parts: [{ text: '你好' }] } }],
    });
    const res = await new GeminiProvider(f).complete('SYS', 'USER');
    expect(res.ok).toBe(true);
    expect(res.text).toBe('你好');
    expect(calls[0].url).toContain('generativelanguage.googleapis.com/v1beta/models/');
    expect(calls[0].url).toContain(':generateContent?key=g-key');
    const body = JSON.parse(String(calls[0].init.body)) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
      generationConfig: { temperature: number; maxOutputTokens: number };
    };
    expect(body.systemInstruction.parts[0].text).toBe('SYS');
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('USER');
    expect(body.generationConfig.maxOutputTokens).toBeDefined();
  });

  it('joins multi-part responses', async () => {
    const { f } = stub(200, {
      candidates: [{ content: { parts: [{ text: '甲' }, { text: '乙' }] } }],
    });
    const res = await new GeminiProvider(f).complete('SYS', 'USER');
    expect(res.text).toBe('甲乙');
  });
});

describe('JSON extraction', () => {
  it('pulls the object out of a model reply wrapped in prose', () => {
    const out = parseJsonObject<{ text: string }>('好的：\n{"type":"question","text":"在哪裡？"}\n以上');
    expect(out?.text).toBe('在哪裡？');
  });
  it('returns null when there is no object', () => {
    expect(parseJsonObject('沒有 JSON')).toBeNull();
  });
});
