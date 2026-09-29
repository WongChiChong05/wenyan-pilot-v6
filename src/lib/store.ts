import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SnapshotStore, emptyDb, type Db } from './store.snapshot';
import { PostgresStore } from './store.postgres';
import type {
  EventRow,
  InteractionRow,
  Participant,
  ResponseRow,
  ScaleRow,
  ParticipantContact,
  TranslationRow,
} from './types';

export interface Store {
  /** All request writes commit together; assignment serializes the count-and-assign step. */
  transaction<T>(fn: (store: Store) => Promise<T>, options?: { assignment?: boolean }): Promise<T>;
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
  /** v6 sentence translations (S1b, S5a, S5b); one row per participant, stage and item. */
  addTranslation(row: TranslationRow): Promise<void>;
  listTranslations(participantId?: string): Promise<TranslationRow[]>;
  createContact(row: ParticipantContact): Promise<void>;
  listContacts(): Promise<ParticipantContact[]>;
  updateContact(participantId: string, patch: Partial<ParticipantContact>): Promise<ParticipantContact>;
}

/**
 * File-backed store for a single-process development dry run only.
 * Production uses PostgresStore; separate JsonStore instances do not share a lock.
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
      const db = JSON.parse(buf) as Db;
      if (db && !Array.isArray(db.contacts)) db.contacts = [];
      if (db && !Array.isArray(db.translations)) db.translations = [];
      if (!db || Object.keys(emptyDb()).some(key => !Array.isArray(db[key as keyof Db]))) {
        throw new Error('invalid database shape');
      }
      return db;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDb();
      throw error; // Never overwrite corrupt/unreadable research data with an empty database.
    }
  }

  private async write(db: Db): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx');
      try { await handle.writeFile(JSON.stringify(db, null, 2), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, this.file);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
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

  transaction<T>(fn: (store: Store) => Promise<T>, _options?: { assignment?: boolean }): Promise<T> {
    return this.tx(db => fn(new SnapshotStore(db)));
  }

  createParticipant(p: Participant) {
    return this.transaction(store => store.createParticipant(p));
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
    return this.transaction(store => store.addResponses(rows));
  }
  async listResponses() {
    return (await this.read()).responses;
  }
  addInteraction(row: InteractionRow) {
    return this.transaction(store => store.addInteraction(row));
  }
  async listInteractions(participantId?: string) {
    const db = await this.read();
    return participantId ? db.interactions.filter((r) => r.participantId === participantId) : db.interactions;
  }
  addEvent(row: EventRow) {
    return this.transaction(store => store.addEvent(row));
  }
  async listEvents() {
    return (await this.read()).events;
  }
  addScale(row: ScaleRow) {
    return this.transaction(store => store.addScale(row));
  }
  async listScales() {
    return (await this.read()).scales;
  }
  addTranslation(row: TranslationRow) {
    return this.transaction(store => store.addTranslation(row));
  }
  async listTranslations(participantId?: string) {
    const db = await this.read();
    return participantId ? db.translations.filter(r => r.participantId === participantId) : db.translations;
  }
  createContact(row: ParticipantContact) {
    return this.transaction(store => store.createContact(row));
  }
  async listContacts() {
    return (await this.read()).contacts;
  }
  updateContact(participantId: string, patch: Partial<ParticipantContact>) {
    return this.transaction(store => store.updateContact(participantId, patch));
  }
}

let singleton: Store | null = null;
export function getStore(): Store {
  if (!singleton) {
    if (process.env.DATABASE_URL) singleton = new PostgresStore();
    else if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
    else singleton = new JsonStore();
  }
  return singleton;
}
export function setStore(s: Store) {
  singleton = s;
}
