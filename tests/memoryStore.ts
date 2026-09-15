import { randomUUID } from 'node:crypto';
import type { Store } from '../src/lib/store';
import type {
  EventRow,
  InteractionRow,
  Participant,
  ResponseRow,
  ScaleRow,
} from '../src/lib/types';

export class MemoryStore implements Store {
  participants: Participant[] = [];
  responses: ResponseRow[] = [];
  interactions: InteractionRow[] = [];
  events: EventRow[] = [];
  scales: ScaleRow[] = [];

  async createParticipant(p: Participant) {
    this.participants.push(p);
  }
  async getParticipant(id: string) {
    return this.participants.find((p) => p.id === id) ?? null;
  }
  async getParticipantByToken(token: string, kind: 'main' | 'delayed') {
    return (
      this.participants.find((p) => (kind === 'main' ? p.token === token : p.delayedToken === token)) ??
      null
    );
  }
  async updateParticipant(id: string, patch: Partial<Participant>) {
    const i = this.participants.findIndex((p) => p.id === id);
    if (i === -1) throw new Error('not found');
    this.participants[i] = { ...this.participants[i], ...patch };
    return this.participants[i];
  }
  async listParticipants() {
    return this.participants;
  }
  async addResponses(rows: ResponseRow[]) {
    this.responses.push(...rows);
  }
  async listResponses() {
    return this.responses;
  }
  async addInteraction(row: InteractionRow) {
    this.interactions.push(row);
  }
  async listInteractions(participantId?: string) {
    return participantId ? this.interactions.filter((r) => r.participantId === participantId) : this.interactions;
  }
  async addEvent(row: EventRow) {
    this.events.push(row);
  }
  async listEvents() {
    return this.events;
  }
  async addScale(row: ScaleRow) {
    this.scales.push(row);
  }
  async listScales() {
    return this.scales;
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
