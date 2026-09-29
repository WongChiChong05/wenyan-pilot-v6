import { getStore } from '@/lib/store';
import { authorised } from '@/lib/admin';
import { buildWideRows, toCsv } from '@/lib/export';
import { CONFIG } from '@/lib/config';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const store = getStore();
  const table = new URL(req.url).searchParams.get('table') ?? 'participants';
  const readers = {
    participants: () => store.listParticipants(), responses: () => store.listResponses(),
    interactions: () => store.listInteractions(), events: () => store.listEvents(), scales: () => store.listScales(),
    translations: () => store.listTranslations(),
  };
  if (table === 'wide') {
    const rows = buildWideRows(await store.listParticipants(), await store.listResponses(), await store.listScales(), await store.listTranslations());
    return csv(rows, 'wide.csv');
  }
  if (table === 'contact-reminders') {
    const rows = await store.transaction(async tx => {
      const now = Date.now();
      const participants = await tx.listParticipants();
      const contacts = await tx.listContacts();
      const byId = new Map(participants.map(participant => [participant.id, participant]));
      for (const contact of contacts) {
        const participant = byId.get(contact.participantId);
        const finished = Date.parse(participant?.stageEnteredTs.S6 ?? '');
        const expired = participant?.stage === 'DONE' || (Number.isFinite(finished) && now > finished + CONFIG.delayedTest.maxHours * 3600000);
        if (contact.email && expired) await tx.updateContact(contact.participantId, { email: null, emailDeletedTs: new Date(now).toISOString() });
      }
      const refreshed = await tx.listContacts();
      return refreshed.flatMap(contact => {
        const participant = byId.get(contact.participantId);
        const finished = Date.parse(participant?.stageEnteredTs.S6 ?? '');
        if (!participant || participant.stage !== 'S6' || !contact.email || !Number.isFinite(finished)) return [];
        const opensAt = finished + CONFIG.delayedTest.minHours * 3600000;
        const closesAt = finished + CONFIG.delayedTest.maxHours * 3600000;
        return [{
          participant_id: participant.id,
          email: contact.email,
          delayed_path: `/run?t=${participant.delayedToken}&d=1`,
          opens_at: new Date(opensAt).toISOString(),
          closes_at: new Date(closesAt).toISOString(),
          ready_to_send: now >= opensAt && now <= closesAt,
          email_sent_ts: contact.emailSentTs ?? null,
        }];
      });
    });
    return csv(rows, 'contact-reminders.csv');
  }
  if (!Object.hasOwn(readers, table)) return Response.json({ error: 'unknown table' }, { status: 400 });
  const rows = await readers[table as keyof typeof readers]();
  return csv(rows, `${table}.csv`);
}

function csv(rows: object[], filename: string) {
  return new Response(toCsv(rows), { headers: {
    'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
    'content-disposition': `attachment; filename="${filename}"`,
  } });
}
