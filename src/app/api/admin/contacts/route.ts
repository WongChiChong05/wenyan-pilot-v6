import { authorised } from '@/lib/admin';
import { api, bodyOf, insist, token } from '@/lib/api';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Record that the researcher manually sent the delayed-test email. */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'unauthorised' }, { status: 401 });
  return api(async () => {
    const body = await bodyOf(req);
    const participantId = token(body.participantId);
    return getStore().transaction(async store => {
      const contact = (await store.listContacts()).find(row => row.participantId === participantId);
      insist(contact?.email, 'active contact not found', 404);
      await store.updateContact(participantId, { emailSentTs: new Date().toISOString() });
      return { ok: true };
    });
  });
}
