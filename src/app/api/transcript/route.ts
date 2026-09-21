import { api, insist, token as validateToken } from '@/lib/api';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The S2 conversation sidebar reads this.
 *
 * It exists so the transcript survives a page reload: the reader is promised the whole
 * session, and React state alone would lose it the moment the tab is refreshed.
 *
 * WHAT IS DELIBERATELY NOT SENT
 *   - rawResponse and leakFlags   (internal QA fields)
 *   - strategy                    (which questioning stem was used — an experimenter field)
 *   - inTargetSentence            (would tell the client which highlights are the four
 *                                  target sentences; the control arm must never learn that,
 *                                  and it is not needed to render a chat log)
 *   - ladder state and answer keys (never leave the server at all)
 */
export async function GET(req: Request) {
  return api(async () => {
  const token = validateToken(new URL(req.url).searchParams.get('t'));
  const store = getStore();
  const p = await store.getParticipantByToken(token, 'main');
  insist(p, 'unknown token', 404);
  if (p.stage !== 'S2') return { messages: [] };

  const rows = await store.listInteractions(p.id);
  const messages = rows
    .slice()
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.turnIndex - b.turnIndex))
    .map((r) => ({
      interactionId: r.interactionId,
      highlightText: r.highlightText,
      actor: r.actor,
      type: r.type,
      text: r.text,
      ts: r.ts,
    }));

  return { messages, locked: p.active !== null };
  });
}
