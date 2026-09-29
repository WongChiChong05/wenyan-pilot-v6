import { api, bodyOf } from '@/lib/api';
import { translate } from '@/lib/study';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** v6 sentence translation (S1b, S5a, S5b): help, skip, submit, timeout. */
export async function POST(req: Request) {
  return api(async () => {
    const body = await bodyOf(req);
    return getStore().transaction(store => translate(store, body));
  });
}
