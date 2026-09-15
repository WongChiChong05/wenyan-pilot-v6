import { NextResponse } from 'next/server';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s =
      v === null || v === undefined
        ? ''
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/** CSV export for R / jamovi. `table=participants|responses|interactions|events|scales` */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const store = getStore();
  const table = url.searchParams.get('table') ?? 'participants';
  const data: Record<string, Record<string, unknown>[]> = {
    participants: (await store.listParticipants()) as unknown as Record<string, unknown>[],
    responses: (await store.listResponses()) as unknown as Record<string, unknown>[],
    interactions: (await store.listInteractions()) as unknown as Record<string, unknown>[],
    events: (await store.listEvents()) as unknown as Record<string, unknown>[],
    scales: (await store.listScales()) as unknown as Record<string, unknown>[],
  };
  const rows = data[table];
  if (!rows) return NextResponse.json({ error: 'unknown table' }, { status: 400 });
  return new NextResponse(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${table}.csv"`,
    },
  });
}
