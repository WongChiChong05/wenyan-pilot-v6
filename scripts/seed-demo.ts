import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { JsonStore } from '../src/lib/store';
import type { Arm, Participant } from '../src/lib/types';

// Local synthetic fixtures only. No remote database, provider, or production bypass.
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is development-only');
  const file = path.resolve('tmp/interface-demo/db.json');
  const store = new JsonStore(file);
  console.log('Synthetic local sessions only. Start the dev server with DATA_FILE=./tmp/interface-demo/db.json, DATABASE_URL empty, LLM_PROVIDER=mock, STUDY_MODE=dry-run.');
  console.log('Existing records are preserved. Each run adds nine new synthetic sessions.');
  for (const arm of ['socratic', 'direct', 'control'] as Arm[]) {
    for (const stage of ['S2', 'S4', 'S6'] as const) {
      const now = new Date().toISOString();
      const p: Participant = {
        id: randomUUID(), token: randomUUID(), delayedToken: randomUUID(), arm, stage,
        stratum: 'mid', pretestScore: 4, consentTs: now,
        demographics: { synthetic: true }, excludeFlags: [], completedTargets: [], active: null,
        stageEnteredTs: { [stage]: stage === 'S6' ? new Date(Date.now() - 25 * 3600000).toISOString() : now },
        studyConfig: { mode: 'dry-run', synthetic: true, provider: 'mock', purpose: 'interface review' },
      };
      await store.createParticipant(p);
      console.log(`${arm} ${stage}: http://localhost:3000/run?t=${stage === 'S6' ? p.delayedToken : p.token}${stage === 'S6' ? '&d=1' : ''}`);
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo seeding failed'); process.exitCode = 1; });
