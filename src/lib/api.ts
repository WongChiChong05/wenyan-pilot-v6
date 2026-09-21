export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const insist: (condition: unknown, message: string, status?: number) => asserts condition =
  (condition, message, status = 400) => { if (!condition) throw new ApiError(status, message); };
export function object(value: unknown): Record<string, unknown> {
  insist(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected an object');
  return value as Record<string, unknown>;
}
export function string(value: unknown, name: string, max = 4000): string {
  insist(typeof value === 'string' && value.length <= max, `invalid ${name}`);
  return value;
}
export function token(value: unknown): string {
  const result = string(value, 'token', 36);
  insist(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result), 'invalid token');
  return result;
}
export function delayedFlag(value: unknown): boolean {
  insist(value === undefined || typeof value === 'boolean', 'invalid delayed flag');
  return value === true;
}
export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  // Next may use an internal hostname in req.url; Host is the browser-facing
  // destination. Never trust an arbitrary forwarded-origin header.
  const host = req.headers.get('host');
  insist(!origin || origin === url.origin || (host && origin === `${url.protocol}//${host}`), 'origin mismatch', 403);
  const reader = req.body?.getReader();
  insist(reader, 'missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 65536) { await reader.cancel(); throw new ApiError(413, 'request too large'); }
    chunks.push(part.value);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'invalid JSON'); }
}
export async function api(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const status = error instanceof ApiError ? error.status : ['23505', '55P03', '40001'].includes(code ?? '') ? 409 : 500;
    // Provider/database errors may contain credentials or participant data. Never echo them.
    return Response.json({ error: error instanceof ApiError ? error.message : status === 409 ? 'request conflict; reload state' : 'server unavailable' },
      { status, headers: { 'cache-control': 'no-store' } });
  }
}
