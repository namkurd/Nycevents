import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feedItems } from '../pipeline/collectors/substack.ts';
import { headingDate, parseCityHappenings, parseFieldNotes, parseReadingTheCity } from '../pipeline/parse/substack.ts';
import { Event } from '../pipeline/schema.ts';

// Real RSS feeds fetched Nov 16, 2026; the newest post in each is the Nov 9-15 issue.
const feed = (n: string) => feedItems(readFileSync(new URL(`./fixtures/substack-${n}.xml`, import.meta.url), 'utf8'));
const valid = (events: unknown[]) => {
  for (const e of events as Record<string, unknown>[]) {
    const r = Event.safeParse({ ...e, id: '000000000000', score: 0 });
    if (!r.success) throw new Error(`${e.title}: ${r.error.message}`);
  }
};

describe('Substack parsers', () => {
  it('reads day headings with the post year', () => {
    expect(headingDate('Monday, November 9', '2026-11-09')).toBe('2026-11-09');
    expect(headingDate('Monday November 9', '2026-11-09')).toBe('2026-11-09');
    expect(headingDate('Thursday, January 1', '2026-12-28')).toBe('2027-01-01');
    expect(headingDate('Subscribe now', '2026-11-09')).toBeNull();
  });

  it('field notes: reads nearly every entry', () => {
    const r = parseFieldNotes(feed('fieldnotesnyc')[0]);
    expect(r.total).toBeGreaterThan(15);
    expect(r.matched / r.total).toBeGreaterThan(0.9);
    valid(r.events);
    const first = r.events[0];
    expect(first.title).toBe('New York: A Documentary Film: Shadows of the Past Screening and Q&A');
    expect(first.start).toBe('2026-11-09T18:00:00-05:00');
    expect(first.end).toBe('2026-11-09T21:00:00-05:00');
    expect(first.venue).toEqual({ name: 'SVA Theatre', address: '333 W 23rd St, Manhattan' });
    expect(first.url).not.toContain('utm_source');
  });

  it('City Happenings: reads nearly every entry and picks the ticket link', () => {
    const r = parseCityHappenings(feed('cityhappenings')[0]);
    expect(r.total).toBeGreaterThan(15);
    expect(r.matched / r.total).toBeGreaterThan(0.85);
    valid(r.events);
    const first = r.events[0];
    expect(first.venue.name).toBe('SVA Theatre');
    expect(first.venue.address).toBe('333 W 23rd St, Chelsea');
    expect(first.start).toBe('2026-11-09T18:00:00-05:00');
    expect(first.url).toMatch(/eventbrite\.com/);
  });

  it('Reading the City: reads logistics lines into time, venue and price', () => {
    const r = parseReadingTheCity(feed('readingthecity')[0]);
    expect(r.total).toBeGreaterThan(10);
    expect(r.matched / r.total).toBeGreaterThan(0.85);
    valid(r.events);
    const doshi = r.events.find(e => /The First House/.test(e.title))!;
    expect(doshi.start).toBe('2026-11-09T19:00:00-05:00');
    expect(doshi.venue.name).toBe('Books Are Magic Montague');
    expect(doshi.price.text).toMatch(/\$10/);
    expect(doshi.category).toBe('books');
  });
});
