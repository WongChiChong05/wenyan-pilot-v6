import { randomUUID } from 'node:crypto';
import type { Store } from '../src/lib/store';
import { SnapshotStore } from '../src/lib/store.snapshot';
import type { Participant } from '../src/lib/types';

export class MemoryStore extends SnapshotStore {
  private queue: Promise<unknown> = Promise.resolve();
  get participants() { return this.db.participants; }
  get responses() { return this.db.responses; }
  get interactions() { return this.db.interactions; }
  get events() { return this.db.events; }
  get scales() { return this.db.scales; }
  transaction<T>(fn: (store: Store) => Promise<T>, _options?: { assignment?: boolean }): Promise<T> {
    const next = this.queue.then(async () => {
      const working = structuredClone(this.db);
      const result = await fn(new SnapshotStore(working));
      Object.assign(this.db, working);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export function makeParticipant(arm: Participant['arm']): Participant {
  return {
    id: randomUUID(),
    token: randomUUID(),
    delayedToken: randomUUID(),
    arm,
    stage: 'S2',
    stratum: 'mid',
    pretestScore: 4,
    consentTs: new Date().toISOString(),
    demographics: {},
    excludeFlags: [],
    stageEnteredTs: {},
    completedTargets: [],
    active: null,
  };
}
