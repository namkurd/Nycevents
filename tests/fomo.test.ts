import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFomo, type FomoChunk, type FomoLocation } from '../pipeline/collectors/fomo.ts';
import { Event } from '../pipeline/schema.ts';

// Real fomo.nyc responses (Nov 15, 2026 export), trimmed to a sample covering each case.
const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const day0: FomoChunk = load('fomo-day0.json');
const rem0: FomoChunk = load('fomo-remainder0.json');
const locs = new Map<number, FomoLocation>((load('fomo-locations.json') as FomoLocation[]).map(l => [l.id, l]));
const FROM = '2026-11-15';
const TO = '2026-12-12';
const all = [...day0.events, ...rem0.events];
const events = parseFomo([day0, rem0], locs, FROM, TO);

describe('fomo collector', () => {
  it('produces schema-valid events', () => {
    expect(events.length).toBeGreaterThan(10);
    for (const e of events) {
      const r = Event.safeParse({ ...e, id: '000000000000', score: 0 });
      if (!r.success) throw new Error(`${e.title}: ${r.error.message}`);
    }
  });

  it('drops virtual and out-of-NYC events', () => {
    const virtual = all.filter(e => e.tags.includes('Virtual') || e.tags.includes('Online')).map(e => e.name);
    const outside = all.filter(e => e.lat && (e.lat > 40.92 || e.lat < 40.49 || e.lng! < -74.26 || e.lng! > -73.69)).map(e => e.name);
    expect(virtual.length + outside.length).toBeGreaterThan(0);
    for (const name of [...virtual, ...outside]) expect(events.some(e => e.title === name.trim())).toBe(false);
  });

  it('collapses several sessions on one day into one event with times listed', () => {
    const keys = events.filter(e => !e.ongoing).map(e => `${e.url}|${e.start.slice(0, 10)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(events.some(e => e.description?.startsWith('Times: '))).toBe(true);
  });

  it('treats a lone date range as an ongoing run, and ignores booking windows next to sessions', () => {
    const ongoing = events.filter(e => e.ongoing);
    expect(ongoing.length).toBeGreaterThan(0);
    for (const e of ongoing) {
      expect(e.allDay).toBe(true);
      expect(e.ongoing!.to >= FROM).toBe(true);
    }
    const windowed = all.filter(e => e.occurrences.some(o => o[2] && o[2] > o[0]) && e.occurrences.some(o => !o[2] || o[2] === o[0]));
    expect(windowed.length).toBeGreaterThan(0);
    for (const w of windowed) expect(events.some(e => e.title === w.name.trim() && e.ongoing)).toBe(false);
  });

  it('keeps only sessions inside the window', () => {
    for (const e of events.filter(x => !x.ongoing)) {
      expect(e.start.slice(0, 10) >= FROM && e.start.slice(0, 10) <= TO).toBe(true);
    }
  });

  it('flags fitness and pop-ups as hidden by default', () => {
    const pop = events.filter(e => e.tags[0] === 'Pop-Up');
    const fit = events.filter(e => e.tags[0] === 'Fitness' || e.tags[0] === 'Open Practice');
    expect(pop.length + fit.length).toBeGreaterThan(0);
    for (const e of pop) expect(e.hide).toContain('brand-popup');
    for (const e of fit) expect(e.hide).toContain('fitness');
  });
});

describe('NYC boundary', () => {
  it('keeps the five boroughs and drops New Jersey', async () => {
    const { inNyc } = await import('../pipeline/collectors/fomo.ts');
    expect(inNyc(40.7580, -73.9855)).toBe(true); // Times Square
    expect(inNyc(40.8506, -73.9396)).toBe(true); // Washington Heights
    expect(inNyc(40.6264, -74.0755)).toBe(true); // St. George, Staten Island
    expect(inNyc(40.5795, -73.8372)).toBe(true); // Rockaway
    expect(inNyc(40.8448, -73.8648)).toBe(true); // Bronx
    expect(inNyc(40.7178, -74.0431)).toBe(false); // Jersey City
    expect(inNyc(40.7440, -74.0324)).toBe(false); // Hoboken
    expect(inNyc(40.8509, -73.9701)).toBe(false); // Fort Lee
    expect(inNyc(40.8859, -74.0435)).toBe(false); // Hackensack
    expect(inNyc(40.8007, -73.7285)).toBe(false); // Great Neck (Nassau)
    expect(inNyc(40.9126, -73.8371)).toBe(false); // Mount Vernon (Westchester)
    expect(inNyc(40.7663, -73.7430)).toBe(true); // Little Neck, Queens
    expect(inNyc(40.7445, -73.7166)).toBe(true); // Glen Oaks, Queens
    expect(inNyc(40.8987, -73.8673)).toBe(true); // Woodlawn, Bronx
  });
});
