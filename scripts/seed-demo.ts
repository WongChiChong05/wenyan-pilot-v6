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
  console.log('Existing records are preserved. Each run adds twelve new synthetic sessions.');
  // v6 entry points: S1b (baseline translation), S2 (training passage 1), S5b and S5a.
  for (const arm of ['socratic', 'direct', 'control'] as Arm[]) {
    for (const stage of ['S1b', 'S2', 'S5b', 'S5a'] as const) {
      const now = new Date().toISOString();
      const translation = stage === 'S2' ? null : { stage, index: 0, shownTs: now };
      const p: Participant = {
        id: randomUUID(), token: randomUUID(), delayedToken: randomUUID(), arm, stage,
        stratum: 'mid', pretestScore: 4, consentTs: now,
        demographics: { synthetic: true }, excludeFlags: [], completedTargets: [], active: null,
        stageEnteredTs: { [stage]: now },
        progress: { trainingIndex: stage === 'S2' ? 0 : 2, passageEnteredTs: [now], translation },
        studyConfig: { mode: 'dry-run', synthetic: true, provider: 'mock', purpose: 'interface review' },
      };
      await store.createParticipant(p);
      console.log(`${arm} ${stage}: http://localhost:3000/run?t=${p.token}`);
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo seeding failed'); process.exitCode = 1; });
