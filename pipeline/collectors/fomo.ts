/**
 * fomo.nyc — the backbone. Public static JSON, ~3,100 events a day.
 * Files: data/manifest.json -> day chunks + remainder chunks; events.X.json, events.X.desc.json,
 * locations.dayN.json / locations.remainder.json.
 */
import { fomoCategory, fomoHide } from '../categories.ts';
import { getJson, saveRaw } from '../lib/http.ts';
import { truncate, safeUrl } from '../lib/text.ts';
import { addDays, nyIso, nyToday, parseClock } from '../lib/time.ts';
import type { CollectResult, RawEvent } from '../schema.ts';

const BASE = 'https://fomo.nyc/data/';

/** [startDate, startTime, endDate|null, endTime, opts?] */
export type FomoOccurrence = [string, string | null, string | null, string | null, Record<string, unknown>?];

export interface FomoEvent {
  id: number;
  name: string;
  event_type: string;
  location: string;
  sublocation?: string;
  place_id?: number;
  lat?: number;
  lng?: number;
  tags: string[];
  occurrences: FomoOccurrence[];
  urls: string[];
  section?: string;
}

export interface FomoLocation {
  id: number;
  name: string;
  address?: string;
  tags?: string[];
  aliases?: string[];
}

export interface FomoChunk {
  events: FomoEvent[];
  descs: Record<string, string>;
}

// New York City bounding box; drops Westchester, Long Island, NJ and upstate venues fomo also lists.
const NYC = { minLat: 40.49, maxLat: 40.92, minLng: -74.26, maxLng: -73.69 };
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];

// Approximate Hudson River centre line (lat, lng); anything west of it is New Jersey.
const HUDSON: [number, number][] = [[40.648, -74.04], [40.70, -74.025], [40.75, -74.012], [40.80, -73.975], [40.85, -73.948], [40.88, -73.928], [40.92, -73.912]];

function hudsonLng(lat: number): number {
  for (let i = 1; i < HUDSON.length; i++) {
    const [la0, lo0] = HUDSON[i - 1];
    const [la1, lo1] = HUDSON[i];
    if (lat <= la1) return lo0 + ((lat - la0) / (la1 - la0)) * (lo1 - lo0);
  }
  return HUDSON[HUDSON.length - 1][1];
}

/** Inside New York City: the bounding box, minus New Jersey west of the Hudson and the Kill van Kull. */
export function inNyc(lat?: number, lng?: number): lat is number {
  if (lat == null || lng == null) return false;
  if (lat < NYC.minLat || lat > NYC.maxLat || lng < NYC.minLng || lng > NYC.maxLng) return false;
  if (lat >= 40.648 && lng < hudsonLng(lat)) return false; // Bayonne, Jersey City, Hoboken, Fort Lee, Bergen County
  if (lat > 40.772 && lng > -73.765) return false; // Great Neck / Manhasset (Nassau), north of Little Neck Bay
  if (lat > 40.903 && lng > -73.87) return false; // Mount Vernon, Pelham (Westchester)
  return true;
}

function borough(loc?: FomoLocation): string | undefined {
  const t = loc?.tags ?? [];
  return BOROUGHS.find(b => t.includes(`venue:${b}`) || t.includes(`venue:The ${b}`));
}

/**
 * Turn fomo chunks into RawEvents for dates in [from, to].
 * - Single-day occurrences are sessions; all sessions on one day collapse into one event (times listed).
 * - A date range with no single-day sessions is an ongoing run (exhibition, film run, festival).
 * - A range next to single-day sessions is only a booking window and is ignored.
 */
export function parseFomo(chunks: FomoChunk[], locations: Map<number, FomoLocation>, from: string, to: string): RawEvent[] {
  const seen = new Set<number>();
  const out: RawEvent[] = [];
  for (const { events, descs } of chunks) {
    for (const e of events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (!inNyc(e.lat, e.lng)) continue;
      if (e.tags.includes('Virtual') || e.tags.includes('Online')) continue;
      const url = safeUrl(e.urls?.[0]);
      if (!url) continue;

      const loc = e.place_id != null ? locations.get(e.place_id) : undefined;
      const category = fomoCategory(e.event_type, e.tags);
      const hide = fomoHide(e.event_type, e.tags, category);
      const base = {
        title: e.name.trim(),
        venue: {
          name: (e.location || loc?.name || 'Unknown venue').trim(),
          address: loc?.address,
          lat: e.lat,
          lng: e.lng,
          borough: borough(loc),
        },
        category,
        price: { free: e.tags.includes('Free') ? true : null },
        url,
        sources: [{ id: 'fomo' as const, url }],
        pickedBy: [],
        tags: [e.event_type, ...e.tags.filter(t => t !== 'Format' && t !== e.event_type)].slice(0, 12),
        ...(hide.length ? { hide } : {}),
      };
      const desc = descs[String(e.id)];

      const singles = e.occurrences.filter(o => !o[2] || o[2] === o[0]);
      if (singles.length) {
        const byDay = new Map<string, FomoOccurrence[]>();
        for (const o of singles) {
          if (o[0] < from || o[0] > to) continue;
          byDay.set(o[0], [...(byDay.get(o[0]) ?? []), o]);
        }
        for (const [day, occ] of byDay) {
          const times = occ
            .map(o => ({ s: parseClock(o[1]), e: parseClock(o[3]) }))
            .filter(t => t.s)
            .sort((a, b) => a.s!.localeCompare(b.s!));
          const uniq = [...new Set(times.map(t => t.s!))];
          const first = times[0];
          const showtimes = uniq.length > 1 ? `Times: ${uniq.map(clock12).join(', ')}. ` : '';
          out.push({
            ...base,
            description: truncate(showtimes + (desc ?? ''), 400),
            start: first ? nyIso(day, first.s!) : day,
            ...(first?.e && uniq.length === 1 && first.e > first.s! ? { end: nyIso(day, first.e) } : {}),
            allDay: !first,
          });
        }
      } else {
        // Ongoing run: keep if it overlaps the window.
        const ranges = e.occurrences.filter(o => o[2] && o[2] > o[0]);
        const start = ranges.reduce((m, o) => (o[0] < m ? o[0] : m), '9999-12-31');
        const end = ranges.reduce((m, o) => (o[2]! > m ? o[2]! : m), '0000-01-01');
        if (!ranges.length || end < from || start > to) continue;
        out.push({
          ...base,
          description: truncate(desc, 400),
          start: start < from ? from : start,
          allDay: true,
          ongoing: { from: start, to: end },
        });
      }
    }
  }
  return out;
}

export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const mer = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${mer}` : `${h12}${mer}`;
}

/** Venue aliases from fomo's location files, used by dedupe to match newsletter venue names. */
export function aliasesOf(locations: Map<number, FomoLocation>): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of locations.values()) for (const a of [l.name, ...(l.aliases ?? [])]) m.set(a, l.name);
  return m;
}

export async function collectFomo(root: string, days = 28): Promise<CollectResult & { locations: Map<number, FomoLocation> }> {
  const from = nyToday();
  const to = addDays(from, days - 1);
  const manifest = await getJson<{ days: string[]; remainderChunks: string[]; exportedAt: string }>(`${BASE}manifest.json`);
  const qm = await getJson<{ files: Record<string, string> }>(`${BASE}query-manifest.json`);
  const has = (f: string) => Object.hasOwn(qm.files, f);

  const chunkNames = [...manifest.days.map((_, i) => `day${i}`), ...manifest.remainderChunks];
  const chunks: FomoChunk[] = [];
  const notes: string[] = [`fomo export ${manifest.exportedAt}`];
  for (const name of chunkNames) {
    const ev = `events.${name}.json`;
    if (!has(ev)) { notes.push(`missing ${ev}`); continue; }
    const events = await getJson<FomoEvent[]>(BASE + ev);
    const descFile = `events.${name}.desc.json`;
    const descs = has(descFile) ? await getJson<Record<string, string>>(BASE + descFile) : {};
    chunks.push({ events, descs });
  }

  const locations = new Map<number, FomoLocation>();
  const locFiles = [...manifest.days.map((_, i) => `locations.day${i}.json`), 'locations.remainder.json'];
  for (const f of locFiles) {
    if (!has(f)) continue;
    for (const l of await getJson<FomoLocation[]>(BASE + f)) locations.set(l.id, l);
  }

  await saveRaw(root, 'fomo', 'manifest.json', JSON.stringify(manifest));
  const events = parseFomo(chunks, locations, from, to);
  notes.push(`${chunks.reduce((n, c) => n + c.events.length, 0)} fomo records in ${chunks.length} chunks`);
  return { source: 'fomo', events, notes, locations };
}
