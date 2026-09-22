import { CONFIG } from './config';
import type { Store } from './store';
import type { EventRow, InteractionRow, Participant, ParticipantContact, ResponseRow, ScaleRow } from './types';

export interface Db {
  participants: Participant[];
  responses: ResponseRow[];
  interactions: InteractionRow[];
  events: EventRow[];
  scales: ScaleRow[];
  contacts: ParticipantContact[];
}
export const emptyDb = (): Db => ({ participants: [], responses: [], interactions: [], events: [], scales: [], contacts: [] });
const copy = <T>(value: T): T => structuredClone(value);
const stamped = <T extends { configVersion?: string }>(value: T): T =>
  ({ ...copy(value), configVersion: value.configVersion ?? CONFIG.version });

/** A transaction-local snapshot. The owner commits it only after the callback succeeds. */
export class SnapshotStore implements Store {
  readonly db: Db;
  constructor(db: Db = emptyDb()) { this.db = db; }
  async transaction<T>(fn: (store: Store) => Promise<T>): Promise<T> { return fn(this); }
  async createParticipant(p: Participant) {
    if (this.db.participants.some(x => x.id === p.id || x.token === p.token || x.delayedToken === p.delayedToken)) {
      throw new Error('duplicate participant');
    }
    this.db.participants.push(stamped(p));
  }
  async getParticipant(id: string) { return copy(this.db.participants.find(p => p.id === id) ?? null); }
  async getParticipantByToken(token: string, kind: 'main' | 'delayed') {
    return copy(this.db.participants.find(p => (kind === 'main' ? p.token : p.delayedToken) === token) ?? null);
  }
  async updateParticipant(id: string, patch: Partial<Participant>) {
    const i = this.db.participants.findIndex(p => p.id === id);
    if (i < 0) throw new Error('participant not found');
    this.db.participants[i] = { ...this.db.participants[i], ...copy(patch), id };
    return copy(this.db.participants[i]);
  }
  async listParticipants() { return copy(this.db.participants); }
  async addResponses(rows: ResponseRow[]) {
    const keys = new Set(this.db.responses.map(r => `${r.participantId}/${r.stage}/${r.itemId}`));
    for (const r of rows) {
      const key = `${r.participantId}/${r.stage}/${r.itemId}`;
      if (keys.has(key)) throw new Error('duplicate response');
      keys.add(key);
    }
    this.db.responses.push(...rows.map(stamped));
  }
  async listResponses() { return copy(this.db.responses); }
  async addInteraction(row: InteractionRow) { this.db.interactions.push(stamped(row)); }
  async listInteractions(id?: string) {
    return copy(id ? this.db.interactions.filter(r => r.participantId === id) : this.db.interactions);
  }
  async addEvent(row: EventRow) { this.db.events.push(stamped(row)); }
  async listEvents() { return copy(this.db.events); }
  async addScale(row: ScaleRow) {
    if (this.db.scales.some(r => r.participantId === row.participantId)) throw new Error('duplicate scale');
    this.db.scales.push(stamped(row));
  }
  async listScales() { return copy(this.db.scales); }
  async createContact(row: ParticipantContact) {
    if (this.db.contacts.some(contact => contact.participantId === row.participantId)) throw new Error('duplicate contact');
    this.db.contacts.push(stamped(row));
  }
  async listContacts() { return copy(this.db.contacts); }
  async updateContact(participantId: string, patch: Partial<ParticipantContact>) {
    const i = this.db.contacts.findIndex(contact => contact.participantId === participantId);
    if (i < 0) throw new Error('contact not found');
    this.db.contacts[i] = { ...this.db.contacts[i], ...copy(patch), participantId };
    return copy(this.db.contacts[i]);
  }
}
