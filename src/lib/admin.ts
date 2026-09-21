import { createHash, timingSafeEqual } from 'node:crypto';
export function authorised(req: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected === 'change-me') return false;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer /i, '');
  // Legacy query keys remain local-only: URLs are commonly captured by access logs.
  const provided = bearer ?? (process.env.NODE_ENV !== 'production' ? new URL(req.url).searchParams.get('key') : null);
  if (!provided) return false;
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(expected), hash(provided));
}
