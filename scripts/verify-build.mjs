import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Next's tracing globs can behave differently with Windows path separators.
// Remove private local fixtures from generated deployment manifests, never the data.
const root = process.cwd();
const privateRoots = ['data', 'tmp', 'backups', '.verify'].map(name => path.resolve(root, name));
const within = (file, folder) => {
  const relative = path.relative(folder, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
async function walk(folder) {
  const paths = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(file));
    else if (entry.name.endsWith('.nft.json')) paths.push(file);
  }
  return paths;
}
let removed = 0;
const traces = await walk(path.join(root, '.next'));
for (const file of traces) {
  const trace = JSON.parse(await readFile(file, 'utf8'));
  const kept = trace.files.filter(entry => !privateRoots.some(folder => within(path.resolve(path.dirname(file), entry), folder)));
  removed += trace.files.length - kept.length;
  if (kept.length !== trace.files.length) await writeFile(file, JSON.stringify({ ...trace, files: kept }));
}
const assistTrace = JSON.parse(await readFile(path.join(root, '.next/server/app/api/assist/route.js.nft.json'), 'utf8'));
if (!assistTrace.files.some(file => file.replaceAll('\\', '/').includes('/node_modules/pg/lib/index.js'))) {
  throw new Error('PostgreSQL driver missing from deployment trace');
}
console.log(`Deployment trace check OK: ${traces.length} manifests, ${removed} private-file references removed; PostgreSQL driver included. Local data was not changed.`);
