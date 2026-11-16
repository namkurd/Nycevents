import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nyToday } from './time.ts';

const UA = 'nyc-events-personal/0.1';
const lastHit = new Map<string, number>();
const MIN_GAP_MS = 1000; // at most 1 request per second per host

async function politeWait(url: string) {
  const host = new URL(url).host;
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

export class FetchError extends Error {
  constructor(public url: string, public status: number) {
    super(`GET ${url} -> ${status}`);
  }
}

/**
 * Every response is kept for the day under data/raw/http/<date>/ (gitignored).
 * With NYC_USE_CACHE=1, a same-day cached copy is used instead of fetching again (for development).
 */
function cachePath(url: string): string {
  return join(process.cwd(), 'data', 'raw', 'http', nyToday(), createHash('sha1').update(url).digest('hex').slice(0, 16));
}

export async function getText(url: string, opts: { accept?: string } = {}): Promise<string> {
  const cached = cachePath(url);
  if (process.env.NYC_USE_CACHE === '1') {
    try { return await readFile(cached, 'utf8'); } catch { /* not cached yet */ }
  }
  await politeWait(url);
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: opts.accept ?? '*/*' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new FetchError(url, res.status);
  const body = await res.text();
  await mkdir(dirname(cached), { recursive: true });
  await writeFile(cached, body);
  return body;
}

export async function getJson<T = unknown>(url: string): Promise<T> {
  return JSON.parse(await getText(url, { accept: 'application/json' })) as T;
}

/** Save a raw payload under data/raw/<source>/<date>/<name> (gitignored) for debugging and re-use. */
export async function saveRaw(root: string, source: string, name: string, body: string): Promise<void> {
  const path = join(root, 'data', 'raw', source, nyToday(), name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}
