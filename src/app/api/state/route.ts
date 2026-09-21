import { api } from '@/lib/api';
import { readState } from '@/lib/study';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  return api(() => {
    const url = new URL(req.url);
    return getStore().transaction(store => readState(store, url.searchParams.get('t') ?? '', url.searchParams.get('d') === '1'));
  });
}
