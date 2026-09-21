import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { JsonStore } from '../src/lib/store';
import { storeContract } from './store.contract';

storeContract('JsonStore', async fn => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'wenyan-store-'));
  try { await fn(new JsonStore(path.join(folder, 'db.json'))); }
  finally { await fs.rm(folder, { recursive: true, force: true }); }
});
it('does not treat corrupt research data as an empty database', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'wenyan-corrupt-'));
  const file = path.join(folder, 'db.json');
  try {
    await fs.writeFile(file, '{broken');
    await assert.rejects(new JsonStore(file).listParticipants());
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
