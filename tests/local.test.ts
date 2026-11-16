import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIcsVenue, parseSquarespaceVenue, type LocalVenue } from '../pipeline/collectors/local.ts';
import { parseIcs } from '../pipeline/lib/ics.ts';
import { Event } from '../pipeline/schema.ts';

const venues: LocalVenue[] = JSON.parse(readFileSync(new URL('../data/curated/venues.json', import.meta.url), 'utf8')).venues;
const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const valid = (events: unknown[]) => { for (const e of events as Record<string, unknown>[]) { const r = Event.safeParse({ ...e, id: '000000000000', score: 0 }); if (!r.success) throw new Error(`${e.title}: ${r.error.message}`); } };

describe('calendar feeds', () => {
  it('reads time-zoned, UTC and all-day stamps', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20261117T190000\r\nSUMMARY:Bingo\r\n Night\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261120T000000Z\r\nSUMMARY:Late show\\, part 2\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261121\r\nSUMMARY:Market day\r\nEND:VEVENT\r\nEND:VCALENDAR';
    expect(parseIcs(ics).map(e => [e.date, e.time, e.summary])).toEqual([
      ['2026-11-17', '19:00', 'BingoNight'],
      ['2026-11-19', '19:00', 'Late show, part 2'],
      ['2026-11-21', null, 'Market day'],
    ]);
  });
});

// Real responses fetched Nov 16, 2026: Farm.One's calendar feed and Lunatico's Squarespace calendar.
describe('local venues', () => {
  it('Farm.One: turns its calendar feed into valid local picks', () => {
    const v = venues.find(x => x.id === 'farm-one')!;
    const events = parseIcsVenue(v, fx('farmone-list.ics'), '2026-11-16', '2026-12-13');
    expect(events.length).toBeGreaterThan(5);
    valid(events);
    expect(events.find(e => e.title === 'Bingo Night')?.start).toBe('2026-11-17T19:00:00-05:00');
    expect(events.every(e => e.pickedBy.includes('local') && e.venue.name === 'Farm.One')).toBe(true);
  });
  it('Lunatico: reads Squarespace items in New York time and skips closures', () => {
    const v = venues.find(x => x.id === 'lunatico')!;
    const items = JSON.parse(fx('lunatico-calendar.json')).items;
    const events = parseSquarespaceVenue(v, items, '2026-11-16', '2026-12-13');
    expect(events.length).toBeGreaterThan(5);
    valid(events);
    expect(events.some(e => /closed/i.test(e.title))).toBe(false);
    const sofia = events.find(e => e.title.startsWith('Sofia Rei'))!;
    // Times are the venue's own (Squarespace startDate in UTC, shown in New York time); we do not "fix" them.
    expect(sofia.start).toBe('2026-11-30T09:00:00-05:00');
    expect(events.filter(e => e.start.slice(11, 13) >= '19').length / events.length).toBeGreaterThan(0.8); // nightly shows
    expect(sofia.title).toBe('Sofia Rei & JC Maillard');
    expect(sofia.url).toMatch(/^https:\/\/www\.barlunatico\.com\/calendar\//);
    expect(sofia.price.text).toMatch(/\$10/);
  });
});
