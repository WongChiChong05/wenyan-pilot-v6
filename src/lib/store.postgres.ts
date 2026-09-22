import { createRequire } from 'node:module';
import type { Pool } from 'pg';
import { CONFIG } from './config';
import type { Store } from './store';
import type { EventRow, InteractionRow, Participant, ResponseRow, ScaleRow } from './types';

export interface SqlConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface SqlPool extends SqlConnection {
  connect(): Promise<SqlConnection & { release(): void }>;
  end(): Promise<void>;
}
type Table = 'participants' | 'responses' | 'interactions' | 'events' | 'scales';
// Identifiers originate only from this allowlist, never from a request.
const fields: Record<Table, string[]> = {
  participants: ['id', 'token', 'delayedToken', 'arm', 'stage', 'stratum', 'pretestScore', 'consentTs', 'demographics', 'excludeFlags', 'stageEnteredTs', 'completedTargets', 'active', 'delayedStartedTs', 'studyConfig', 'configVersion'],
  responses: ['id', 'participantId', 'stage', 'itemId', 'level', 'chosen', 'correct', 'rtMs', 'ts', 'configVersion'],
  interactions: ['id', 'participantId', 'interactionId', 'inTargetSentence', 'granularity', 'highlightText', 'turnIndex', 'actor', 'type', 'text', 'strategy', 'latencyMs', 'rawResponse', 'leakFlags', 'generatedOptions', 'generatedAnswerIndex', 'degraded', 'ts', 'configVersion'],
  events: ['id', 'participantId', 'event', 'payload', 'ts', 'configVersion'],
  scales: [
    'id', 'participantId',
    'intrinsic1', 'intrinsic2', 'germane1', 'germane2', 'germane3',
    'extraneous1', 'extraneous2', 'extraneous3',
    'intrinsicMean', 'germaneMean', 'extraneousMean',
    'mentalEffort', 'load', 'frustration', 'selfEfficacy', 'ts', 'configVersion',
  ],
};
const jsonFields = new Set(['demographics', 'excludeFlags', 'stageEnteredTs', 'completedTargets', 'active', 'studyConfig', 'leakFlags', 'generatedOptions', 'payload']);
const column = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const encode = (key: string, value: unknown) => value == null ? null : jsonFields.has(key) ? JSON.stringify(value) : value;
function decode<T>(table: Table, row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const key of fields[table]) {
    const value = row[column(key)];
    // Omit absent optional fields to preserve the JSON-store export shape.
    if (value == null && [
      'delayedStartedTs', 'studyConfig', 'generatedOptions', 'generatedAnswerIndex', 'degraded',
      'intrinsic1', 'intrinsic2', 'germane1', 'germane2', 'germane3',
      'extraneous1', 'extraneous2', 'extraneous3',
      'intrinsicMean', 'germaneMean', 'extraneousMean',
      'mentalEffort', 'load', 'frustration', 'selfEfficacy',
    ].includes(key)) {
      if (key === 'generatedAnswerIndex' && row.degraded !== null) result[key] = null;
      continue;
    }
    result[key] = value instanceof Date ? value.toISOString() : value;
  }
  return result as T;
}

/** Direct PostgreSQL connection to Supabase; credentials are server-only. */
export function createPool(connectionString = process.env.DATABASE_URL): SqlPool {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  // Lazy load keeps the dependency-free offline harness usable without pg installed.
  const pg = createRequire(import.meta.url)('pg') as typeof import('pg');
  const pool: Pool = new pg.Pool({
    connectionString, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
    application_name: 'wenyan-pilot',
    // TLS settings are supplied by the connection string, preferably sslmode=verify-full.
  });
  pool.on('error', () => console.error('PostgreSQL idle connection failed'));
  return pool as unknown as SqlPool;
}

export class PostgresStore implements Store {
  private readonly pool: SqlPool;
  private readonly connection: SqlConnection;
  private readonly inTransaction: boolean;
  constructor(pool?: SqlPool, connection?: SqlConnection) {
    this.pool = pool ?? createPool();
    this.connection = connection ?? this.pool;
    this.inTransaction = !!connection;
  }
  async transaction<T>(fn: (store: Store) => Promise<T>, options?: { assignment?: boolean }): Promise<T> {
    if (this.inTransaction) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '180s'");
      if (options?.assignment) await client.query('SELECT id FROM wenyan.assignment_lock WHERE id = 1 FOR UPDATE');
      const result = await fn(new PostgresStore(this.pool, client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  async close() { await this.pool.end(); }
  private async insert(table: Table, value: object) {
    const row = { ...value, configVersion: (value as { configVersion?: string }).configVersion ?? CONFIG.version } as Record<string, unknown>;
    const keys = fields[table].filter(k => row[k] !== undefined);
    await this.connection.query(
      `INSERT INTO wenyan.${table} (${keys.map(column).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map(k => encode(k, row[k]))
    );
  }
  private async list<T>(table: Table, participantId?: string): Promise<T[]> {
    const result = await this.connection.query(
      `SELECT * FROM wenyan.${table}${participantId ? ' WHERE participant_id = $1' : ''} ORDER BY sequence`,
      participantId ? [participantId] : []
    );
    return result.rows.map(row => decode<T>(table, row));
  }
  createParticipant(p: Participant) { return this.insert('participants', p); }
  async getParticipant(id: string): Promise<Participant | null> {
    const result = await this.connection.query('SELECT * FROM wenyan.participants WHERE id = $1' + (this.inTransaction ? ' FOR UPDATE' : ''), [id]);
    return result.rows[0] ? decode('participants', result.rows[0]) : null;
  }
  async getParticipantByToken(token: string, kind: 'main' | 'delayed'): Promise<Participant | null> {
    const result = await this.connection.query(
      `SELECT * FROM wenyan.participants WHERE ${kind === 'main' ? 'token' : 'delayed_token'} = $1${this.inTransaction ? ' FOR UPDATE' : ''}`, [token]
    );
    return result.rows[0] ? decode('participants', result.rows[0]) : null;
  }
  async updateParticipant(id: string, patch: Partial<Participant>): Promise<Participant> {
    const keys = fields.participants.filter(k => k !== 'id' && Object.prototype.hasOwnProperty.call(patch, k));
    const row = patch as Record<string, unknown>;
    const sets = keys.map((key, i) => `${column(key)} = $${i + 2}`);
    const result = await this.connection.query(
      `UPDATE wenyan.participants SET ${[...sets, 'version = version + 1'].join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...keys.map(k => encode(k, row[k]))]
    );
    if (!result.rows[0]) throw new Error('participant not found');
    return decode('participants', result.rows[0]);
  }
  listParticipants() { return this.list<Participant>('participants'); }
  async addResponses(rows: ResponseRow[]) {
    if (!this.inTransaction) return this.transaction(store => store.addResponses(rows));
    for (const row of rows) await this.insert('responses', row);
  }
  listResponses() { return this.list<ResponseRow>('responses'); }
  addInteraction(row: InteractionRow) { return this.insert('interactions', row); }
  listInteractions(id?: string) { return this.list<InteractionRow>('interactions', id); }
  addEvent(row: EventRow) { return this.insert('events', row); }
  listEvents() { return this.list<EventRow>('events'); }
  addScale(row: ScaleRow) { return this.insert('scales', row); }
  listScales() { return this.list<ScaleRow>('scales'); }
}
