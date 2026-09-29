/** Shared file helpers for the offline grading scripts (blind-sheet, grade, agreement). */
import { promises as fs } from 'node:fs';
import type { TranslationRow } from '../src/lib/types';

/** Accepts a `npm run db:dump` translations.json, a dev data/db.json, or a bare array. */
export async function loadTranslations(file: string): Promise<TranslationRow[]> {
  const data = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  const rows = Array.isArray(data) ? data : (data as { translations?: unknown }).translations;
  if (!Array.isArray(rows)) throw new Error(`${file}: no translations array`);
  return rows as TranslationRow[];
}

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(cell => cell.trim().length));
  if (!header) return [];
  const keys = header.map(h => h.replace(/^﻿/, '').trim());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
