import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PostgresStore, type SqlConnection, type SqlPool } from '../src/lib/store.postgres';
import { storeContract } from './store.contract';

// PGlite executes the actual SQL/schema, but has one connection. It does NOT prove
// cross-connection locking; use TEST_DATABASE_URL for that contract in a dedicated DB.
storeContract('PostgresStore (PGlite)', async fn => {
  const db = new PGlite();
  await db.exec(await readFile('db/schema.sql', 'utf8'));
  await db.exec(await readFile('db/migrations/002_differentiated_cognitive_load.sql', 'utf8'));
  let queue = Promise.resolve();
  const query: SqlConnection['query'] = async (sql, values) => db.query(sql, values);
  const pool: SqlPool = {
    query,
    async connect() {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      return { query, release };
    },
    async end() { await db.close(); },
  };
  try { await fn(new PostgresStore(pool)); }
  finally { await db.close(); }
});

if (process.env.TEST_DATABASE_URL) {
  storeContract('PostgresStore (real database)', async fn => {
    const { createPool } = await import('../src/lib/store.postgres');
    const pool = createPool(process.env.TEST_DATABASE_URL);
    // Isolate each case. Never drop or mutate the application's wenyan schema.
    const schema = `wenyan_test_${randomUUID().replaceAll('-', '')}`;
    if (!/^wenyan_test_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid test schema');
    const rewrite = (sql: string) => sql.replace(/\bwenyan\b/g, schema);
    const isolated: SqlPool = {
      query: (sql, values) => pool.query(rewrite(sql), values),
      async connect() {
        const client = await pool.connect();
        return { query: (sql, values) => client.query(rewrite(sql), values), release: () => client.release() };
      },
      end: () => pool.end(),
    };
    try {
      await isolated.query(await readFile('db/schema.sql', 'utf8'));
      await isolated.query(await readFile('db/migrations/002_differentiated_cognitive_load.sql', 'utf8'));
      await fn(new PostgresStore(isolated));
    } finally {
      try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
      finally { await pool.end(); }
    }
  });
}
