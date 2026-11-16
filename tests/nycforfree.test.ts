import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNycForFree } from '../pipeline/collectors/nycforfree.ts';
import { Event } from '../pipeline/schema.ts';

// Real https://www.nycforfree.co/events page fetched Nov 16, 2026 (scripts, styles and SVGs stripped).
const html = readFileSync(new URL('./fixtures/nycforfree-events.html', import.meta.url), 'utf8');
const FROM = '2026-11-16';
const TO = '2026-12-13';
const { events, skipped } = parseNycForFree(html, FROM, TO);

describe('NYC for FREE collector', () => {
  it('reads every card and produces schema-valid events', () => {
    expect(skipped).toBe(0);
    expect(events.length).toBeGreaterThan(20);
    for (const e of events) {
      const r = Event.safeParse({ ...e, id: '000000000000', score: 0 });
      if (!r.success) throw new Error(`${e.title}: ${r.error.message}`);
    }
  });

  it('expands explicit occurrences into dated sessions', () => {
    const occ = [...html.matchAll(/event-data="occurrences"[^>]*>([^<]+)</g)].map(m => m[1]);
    expect(occ.length).toBeGreaterThan(0);
    const firstDay = occ.flatMap(o => o.split(',')).map(p => p.split('|')).find(([d]) => d >= FROM && d <= TO);
    if (firstDay) {
      const [day, s] = firstDay;
      expect(events.some(e => e.start.startsWith(`${day}T${s}`))).toBe(true);
    }
  });

  it('turns long runs without sessions into ongoing events', () => {
    const ongoing = events.filter(e => e.ongoing);
    expect(ongoing.length).toBeGreaterThan(0);
    for (const e of ongoing) expect(e.ongoing!.to >= FROM).toBe(true);
  });

  it('marks everything free, as a background source (not a pick), hiding brand categories', () => {
    for (const e of events) {
      expect(e.price.free).toBe(true);
      expect(e.pickedBy).toEqual([]);
    }
    for (const e of events.filter(x => ['Fashion', 'Beauty'].includes(x.tags[0]))) expect(e.hide).toContain('brand-popup');
  });
});
