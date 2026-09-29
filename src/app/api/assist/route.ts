import { api, bodyOf } from '@/lib/api';
import { assist } from '@/lib/study';
import { isCancellable } from '@/lib/engine';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Worst case: reason judge (40s) + generation/regen (80s) + database overhead.
export const maxDuration = 150;

export async function POST(req: Request) {
  return api(async () => {
    const body = await bodyOf(req);
    return getStore().transaction(async store => {
      const result = await assist(store, body);
      const p = await store.getParticipantByToken(body.token as string, 'main');
      return { ...result, turnIndex: p?.active?.turnIndex ?? null, cancellable: p?.active ? isCancellable(p.active) : false };
    });
  });
}
