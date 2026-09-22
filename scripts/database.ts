import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { createPool, PostgresStore } from '../src/lib/store.postgres';
import { toCsv } from '../src/lib/export';
import type { Db } from '../src/lib/store.snapshot';

async function main() {
  loadEnvConfig(process.cwd());
  const command = process.argv[2];
  const url = command === 'migrate' ? process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL : process.env.DATABASE_URL;
  const pool = createPool(url);
  const client = await pool.connect();
  try {
    if (command === 'migrate') {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA IF NOT EXISTS wenyan');
      await client.query('CREATE TABLE IF NOT EXISTS wenyan.schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      await client.query('LOCK TABLE wenyan.schema_migrations IN EXCLUSIVE MODE');
      const migrations: { version: number; file: string }[] = [
        { version: 1, file: path.join(process.cwd(), 'db/schema.sql') },
      ];
      const folder = path.join(process.cwd(), 'db/migrations');
      for (const name of (await fs.readdir(folder)).sort()) {
        const match = /^(\d+)_.*\.sql$/.exec(name);
        if (match) migrations.push({ version: Number(match[1]), file: path.join(folder, name) });
      }
      const seen = new Set<number>();
      for (const migration of migrations.sort((a, b) => a.version - b.version)) {
        if (seen.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}`);
        seen.add(migration.version);
        const sql = await fs.readFile(migration.file, 'utf8');
        const hash = createHash('sha256').update(sql).digest('hex');
        const prior = await client.query('SELECT checksum FROM wenyan.schema_migrations WHERE version = $1', [migration.version]);
        if (prior.rows.length && prior.rows[0].checksum !== hash) {
          throw new Error(`Applied migration ${migration.version} changed; create a new reviewed migration instead`);
        }
        if (!prior.rows.length) {
          await client.query(sql);
          await client.query('INSERT INTO wenyan.schema_migrations(version, checksum) VALUES ($1, $2)', [migration.version, hash]);
        }
      }
      await client.query('ALTER TABLE wenyan.schema_migrations ENABLE ROW LEVEL SECURITY');
      await client.query('COMMIT');
      console.log(`Schema v${Math.max(...seen)} ready. Legacy public tables were not changed.`);
      return;
    }
    await client.query(command === 'dump' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const store = new PostgresStore(pool, client);
    if (command === 'dump') {
      const data: Db = { participants: await store.listParticipants(), responses: await store.listResponses(), interactions: await store.listInteractions(), events: await store.listEvents(), scales: await store.listScales() };
      await client.query('COMMIT');
      const folder = path.resolve('backups', new Date().toISOString().replace(/[:.]/g, '-'));
      await fs.mkdir(folder, { recursive: true });
      for (const [table, rows] of Object.entries(data)) {
        await fs.writeFile(path.join(folder, `${table}.json`), JSON.stringify(rows, null, 2), { flag: 'wx' });
        await fs.writeFile(path.join(folder, `${table}.csv`), toCsv(rows), { flag: 'wx' });
      }
      console.log(`Exported a consistent snapshot to ${folder}`);
    } else if (command === 'import') {
      // The lock blocks writes while checking emptiness and importing; there is no partial import.
      await client.query('LOCK TABLE wenyan.participants, wenyan.responses, wenyan.interactions, wenyan.events, wenyan.scales IN ACCESS EXCLUSIVE MODE');
      const existing = await client.query('SELECT (SELECT count(*) FROM wenyan.participants) + (SELECT count(*) FROM wenyan.responses) + (SELECT count(*) FROM wenyan.interactions) + (SELECT count(*) FROM wenyan.events) + (SELECT count(*) FROM wenyan.scales) AS n');
      if (Number(existing.rows[0].n) !== 0) throw new Error('Import requires an empty target database');
      const data = JSON.parse(await fs.readFile(path.resolve(process.argv[3] ?? 'data/db.json'), 'utf8')) as Db;
      for (const key of ['participants', 'responses', 'interactions', 'events', 'scales'] as const) {
        if (!Array.isArray(data[key])) throw new Error(`Missing ${key} array`);
      }
      // Legacy rows are labelled explicitly; their historical configuration cannot be inferred.
      for (const p of data.participants) await store.createParticipant({ ...p, configVersion: p.configVersion ?? 'legacy-unrecorded' });
      await store.addResponses(data.responses.map(r => ({ ...r, configVersion: r.configVersion ?? 'legacy-unrecorded' })));
      for (const r of data.interactions) await store.addInteraction({ ...r, configVersion: r.configVersion ?? 'legacy-unrecorded' });
      for (const r of data.events) await store.addEvent({ ...r, configVersion: r.configVersion ?? 'legacy-unrecorded' });
      for (const r of data.scales) await store.addScale({ ...r, configVersion: r.configVersion ?? 'legacy-unrecorded' });
      await client.query('COMMIT');
      console.log('Import committed. Source JSON was not changed.');
    } else throw new Error('Use migrate, dump, or import');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Database operation failed'); process.exitCode = 1; });
