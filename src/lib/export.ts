/** Stable CSV for both storage backends; JSONB may reorder object keys. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function toCsv(rows: object[]): string {
  if (!rows.length) return '';
  const records = rows as Record<string, unknown>[];
  const cols = [...new Set(records.flatMap(Object.keys))].sort();
  const escape = (value: unknown) => {
    const s = value == null ? '' : typeof value === 'object' ? JSON.stringify(canonical(value)) : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...records.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
}
