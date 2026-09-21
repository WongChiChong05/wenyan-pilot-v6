import { api, bodyOf } from '@/lib/api';
import { submitQuiz } from '@/lib/study';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return api(async () => {
    const body = await bodyOf(req);
    return getStore().transaction(async store => {
      const result = await submitQuiz(store, body);
      return result;
    }, { assignment: true });
  });
}
