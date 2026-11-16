import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leadingVenue, parseSkintPost, parseWhen, postRange, venueFrom, type WpPost } from '../pipeline/parse/skint.ts';
import { Event } from '../pipeline/schema.ts';

// Real response from theskint.com/wp-json/wp/v2/posts?per_page=6 (Nov 16, 2026).
const posts: WpPost[] = JSON.parse(readFileSync(new URL('./fixtures/skint-posts.json', import.meta.url), 'utf8'));
const R = { from: '2026-11-13', to: '2026-11-16' }; // FRI-MON, 11/13-16

describe('Skint parser', () => {
  it('reads the date range from post titles', () => {
    expect(postRange('FRI-MON, 11/13-16: SKINT WEEKEND', '2026-11-13T00:44:04')).toEqual(R);
    expect(postRange('TUES-THURS, 11/10-12: ART WEEK NYC', '2026-11-09T23:23:04')).toEqual({ from: '2026-11-10', to: '2026-11-12' });
    expect(postRange('FRI-MON, 11/27-12/1: SKINT WEEKEND', '2026-11-27T00:00:00')).toEqual({ from: '2026-11-27', to: '2026-12-01' });
  });

  it('parses the "when" forms', () => {
    expect(parseWhen('► sat 11am-5pm', R)).toEqual({ sessions: [{ day: '2026-11-14', start: '11:00', end: '17:00' }] });
    expect(parseWhen('sat + sun (10am-5pm)', R)?.sessions.map(s => s.day)).toEqual(['2026-11-14', '2026-11-15']);
    expect(parseWhen('fri + sat (fri 6-9pm, sat 1-6pm)', R)?.sessions).toEqual([
      { day: '2026-11-13', start: '18:00', end: '21:00' },
      { day: '2026-11-14', start: '13:00', end: '18:00' },
    ]);
    expect(parseWhen('fri thru sun', R)?.sessions.map(s => s.day)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    expect(parseWhen('fri thru 1/24/2027', R)).toEqual({ sessions: [], ongoing: { from: '2026-11-13', to: '2027-01-24' } });
    expect(parseWhen('sun 12-6pm (+ 12/5, 12/19)', R)?.sessions.map(s => s.day)).toEqual(['2026-11-15', '2026-12-05', '2026-12-19']);
    expect(parseWhen('fri 7pm doors', R)?.sessions[0]).toEqual({ day: '2026-11-13', start: '19:00' });
    expect(parseWhen('sat 7pm-close', R)?.sessions[0]).toEqual({ day: '2026-11-14', start: '19:00' });
  });

  it('pulls the venue from "name (area)"', () => {
    expect(venueFrom('the new york historical store (uws). ')).toEqual({ name: 'the new york historical store', area: 'uws' });
    expect(venueFrom('a two-day fest at lifeworld (bushwick), $10-20.')).toEqual({ name: 'lifeworld', area: 'bushwick' });
    expect(leadingVenue('industry city, $20 admission.')).toEqual({ name: 'industry city' });
    expect(leadingVenue('the annual new york comedy festival is back with 100+ shows.')).toBeNull();
  });

  it('parses most entries of a real weekend post into valid events', () => {
    const weekend = posts.find(p => /SKINT WEEKEND/.test(p.title.rendered))!;
    const { events, unparsed, matched, total } = parseSkintPost(weekend);
    expect(total).toBeGreaterThan(30);
    expect(matched / total).toBeGreaterThan(0.9);
    expect(unparsed.length).toBe(total - matched);
    for (const e of events) {
      const r = Event.safeParse({ ...e, id: '000000000000', score: 0 });
      if (!r.success) throw new Error(`${e.title}: ${r.error.message}`);
      expect(e.pickedBy).toEqual(['skint']);
    }
    const market = events.find(e => /designing women market/i.test(e.title))!;
    expect(market.start).toBe('2026-11-14T11:00:00-05:00');
    expect(market.url).toMatch(/^https:\/\/www\.nyhistory\.org\//);
  });

  it('skips sponsored posts', () => {
    const sponsored = posts.find(p => /SPONSORED/.test(p.title.rendered))!;
    expect(parseSkintPost(sponsored)).toEqual({ events: [], unparsed: [], matched: 0, total: 0 });
  });
});

describe('Skint edge cases', () => {
  it('handles "thru <date>" runs already underway', () => {
    expect(parseWhen('thru 11/15', R)?.sessions.map(s => s.day)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    expect(parseWhen('thru 12/31', R)).toEqual({ sessions: [], ongoing: { from: '2026-11-13', to: '2026-12-31' } });
  });
});
