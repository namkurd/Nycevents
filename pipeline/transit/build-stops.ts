/**
 * Build data/curated/one-seat-stops.json from MTA GTFS: every stop served by the home routes.
 * Routes come from NYC_HOME_ROUTES_T1 / NYC_HOME_ROUTES_T2 (comma lists of GTFS route_id).
 * The output is gitignored: together with the routes it would reveal roughly where home is.
 *
 *   npm run stops
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { homeConfig } from './home.ts';

const FEEDS = [
  'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip',
  'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip', // Brooklyn buses
];

export interface StopsFile {
  generatedAt: string;
  /** route_id -> [lat, lng, stop name][] */
  routes: Record<string, [number, number, string][]>;
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) => yauzl.open(path, { lazyEntries: true }, (err, zip) => (err ? rej(err) : res(zip!))));
}

/** Stream each line of one file inside a zip. */
async function* zipLines(path: string, name: string): AsyncGenerator<string> {
  const zip = await openZip(path);
  const stream = await new Promise<Readable | null>((res, rej) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName !== name) { zip.readEntry(); return; }
      zip.openReadStream(entry, (err, s) => (err ? rej(err) : res(s!)));
    });
    zip.on('end', () => res(null));
    zip.readEntry();
  });
  if (!stream) throw new Error(`${name} not found in ${path}`);
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) yield line;
  zip.close();
}

function csvSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function* rows(path: string, name: string): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const line of zipLines(path, name)) {
    if (!line) continue;
    const cells = csvSplit(line);
    if (!header) { header = cells.map(h => h.replace(/^﻿/, '')); continue; }
    yield Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  }
}

export async function buildStops(root: string): Promise<StopsFile> {
  const home = homeConfig();
  if (!home) throw new Error('NYC_HOME_* environment variables are not set; cannot build home-route stops.');
  const wanted = new Set([...home.tier1, ...home.tier2]);
  const result: StopsFile = { generatedAt: new Date().toISOString(), routes: {} };
  const tmp = join(tmpdir(), 'nycevents-gtfs');
  await mkdir(tmp, { recursive: true });

  for (const feed of FEEDS) {
    const zipPath = join(tmp, feed.split('/').pop()!);
    const res = await fetch(feed, { headers: { 'user-agent': 'nyc-events-personal/0.1' } });
    if (!res.ok || !res.body) throw new Error(`GET ${feed} -> ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));

    const stops = new Map<string, [number, number, string, string]>(); // id -> lat, lng, name, parent
    for await (const r of rows(zipPath, 'stops.txt')) stops.set(r.stop_id, [Number(r.stop_lat), Number(r.stop_lon), r.stop_name, r.parent_station]);
    const tripRoute = new Map<string, string>();
    for await (const r of rows(zipPath, 'trips.txt')) if (wanted.has(r.route_id)) tripRoute.set(r.trip_id, r.route_id);
    const routeStops = new Map<string, Set<string>>();
    for await (const r of rows(zipPath, 'stop_times.txt')) {
      const route = tripRoute.get(r.trip_id);
      if (!route) continue;
      if (!routeStops.has(route)) routeStops.set(route, new Set());
      routeStops.get(route)!.add(r.stop_id);
    }
    for (const [route, ids] of routeStops) {
      const seen = new Set<string>();
      const list: [number, number, string][] = [];
      for (const id of ids) {
        const s = stops.get(id);
        if (!s) continue;
        const key = s[3] || id; // collapse N/S platforms to their parent station
        if (seen.has(key)) continue;
        seen.add(key);
        list.push([s[0], s[1], s[2]]);
      }
      result.routes[route] = list;
    }
    await rm(zipPath, { force: true });
  }

  const missing = [...wanted].filter(r => !result.routes[r]);
  if (missing.length) console.warn(`No GTFS stops found for: ${missing.join(', ')}`);
  const out = join(root, 'data', 'curated', 'one-seat-stops.json');
  await mkdir(join(root, 'data', 'curated'), { recursive: true });
  await writeFile(out, JSON.stringify(result));
  return result;
}

export async function loadStops(root: string): Promise<StopsFile | null> {
  try {
    return JSON.parse(await readFile(join(root, 'data', 'curated', 'one-seat-stops.json'), 'utf8')) as StopsFile;
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await buildStops(process.cwd());
  console.log(Object.entries(r.routes).map(([k, v]) => `${k}: ${v.length} stops`).join('\n'));
}
