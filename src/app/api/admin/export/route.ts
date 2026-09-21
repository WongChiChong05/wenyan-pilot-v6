import { getStore } from '@/lib/store';
import { authorised } from '@/lib/admin';
import { toCsv } from '@/lib/export';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const store = getStore();
  const table = new URL(req.url).searchParams.get('table') ?? 'participants';
  const readers = {
    participants: () => store.listParticipants(), responses: () => store.listResponses(),
    interactions: () => store.listInteractions(), events: () => store.listEvents(), scales: () => store.listScales(),
  };
  if (!Object.hasOwn(readers, table)) return Response.json({ error: 'unknown table' }, { status: 400 });
  const rows = await readers[table as keyof typeof readers]();
  return new Response(toCsv(rows), { headers: {
    'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
    'content-disposition': 'attachment; filename="' + table + '.csv"',
  } });
}
