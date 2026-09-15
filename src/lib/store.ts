import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  EventRow,
  InteractionRow,
  Participant,
  ResponseRow,
  ScaleRow,
} from './types';

export interface Store {
  createParticipant(p: Participant): Promise<void>;
  getParticipant(id: string): Promise<Participant | null>;
  getParticipantByToken(token: string, kind: 'main' | 'delayed'): Promise<Participant | null>;
  updateParticipant(id: string, patch: Partial<Participant>): Promise<Participant>;
  listParticipants(): Promise<Participant[]>;
  addResponses(rows: ResponseRow[]): Promise<void>;
  listResponses(): Promise<ResponseRow[]>;
  addInteraction(row: InteractionRow): Promise<void>;
  listInteractions(participantId?: string): Promise<InteractionRow[]>;
  addEvent(row: EventRow): Promise<void>;
  listEvents(): Promise<EventRow[]>;
  addScale(row: ScaleRow): Promise<void>;
  listScales(): Promise<ScaleRow[]>;
}

interface Db {
  participants: Participant[];
  responses: ResponseRow[];
  interactions: InteractionRow[];
  events: EventRow[];
  scales: ScaleRow[];
}

const EMPTY: Db = { participants: [], responses: [], interactions: [], events: [], scales: [] };

/**
 * File-backed store. Good enough for the dry run and for a pilot of 45 people on a
 * single server process; swap in SupabaseStore for a deployment that scales out.
 */
export class JsonStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(file?: string) {
    this.file = file ?? process.env.DATA_FILE ?? path.join(process.cwd(), 'data', 'db.json');
  }

  private async read(): Promise<Db> {
    try {
      const buf = await fs.readFile(this.file, 'utf8');
      return { ...EMPTY, ...(JSON.parse(buf) as Db) };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  private async write(db: Db): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(db, null, 2), 'utf8');
  }

  /** Serialises writes; a lost update would silently corrupt an experiment record. */
  private tx<T>(fn: (db: Db) => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      const db = await this.read();
      const out = await fn(db);
      await this.write(db);
      return out;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  createParticipant(p: Participant) {
    return this.tx((db) => {
      db.participants.push(p);
    });
  }
  async getParticipant(id: string) {
    const db = await this.read();
    return db.participants.find((p) => p.id === id) ?? null;
  }
  async getParticipantByToken(token: string, kind: 'main' | 'delayed') {
    const db = await this.read();
    return (
      db.participants.find((p) => (kind === 'main' ? p.token === token : p.delayedToken === token)) ?? null
    );
  }
  updateParticipant(id: string, patch: Partial<Participant>) {
    return this.tx((db) => {
      const i = db.participants.findIndex((p) => p.id === id);
      if (i === -1) throw new Error(`participant ${id} not found`);
      db.participants[i] = { ...db.participants[i], ...patch };
      return db.participants[i];
    });
  }
  async listParticipants() {
    return (await this.read()).participants;
  }
  addResponses(rows: ResponseRow[]) {
    return this.tx((db) => {
      db.responses.push(...rows);
    });
  }
  async listResponses() {
    return (await this.read()).responses;
  }
  addInteraction(row: InteractionRow) {
    return this.tx((db) => {
      db.interactions.push(row);
    });
  }
  async listInteractions(participantId?: string) {
    const db = await this.read();
    return participantId ? db.interactions.filter((r) => r.participantId === participantId) : db.interactions;
  }
  addEvent(row: EventRow) {
    return this.tx((db) => {
      db.events.push(row);
    });
  }
  async listEvents() {
    return (await this.read()).events;
  }
  addScale(row: ScaleRow) {
    return this.tx((db) => {
      db.scales.push(row);
    });
  }
  async listScales() {
    return (await this.read()).scales;
  }
}

let singleton: Store | null = null;
export function getStore(): Store {
  if (!singleton) singleton = new JsonStore();
  return singleton;
}
export function setStore(s: Store) {
  singleton = s;
}
