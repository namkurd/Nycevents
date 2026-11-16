import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandRules, type FreeNightRule } from '../pipeline/collectors/curated.ts';
import { fomoCategory, isLibraryProgram, isRepertoryPick } from '../pipeline/categories.ts';
import { score } from '../pipeline/rank.ts';
import { Event } from '../pipeline/schema.ts';

const rules: FreeNightRule[] = JSON.parse(readFileSync(new URL('../data/curated/free-nights.json', import.meta.url), 'utf8')).rules;

describe('free museum nights', () => {
  const events = expandRules(rules, '2026-11-16', '2026-12-13');
  it('expands weekly and nth-weekday rules into valid dated events', () => {
    for (const e of events) {
      const r = Event.safeParse({ ...e, id: '000000000000', score: 0 });
      if (!r.success) throw new Error(`${e.title}: ${r.error.message}`);
    }
    const whitneyFri = events.filter(e => e.title === 'Whitney: Free Friday Night').map(e => e.start);
    expect(whitneyFri).toEqual(['2026-11-20T17:00:00-05:00', '2026-11-27T17:00:00-05:00', '2026-12-04T17:00:00-05:00', '2026-12-11T17:00:00-05:00']);
    expect(events.filter(e => e.title === 'Noguchi Museum: Free First Friday').map(e => e.start)).toEqual(['2026-12-04']);
    expect(events.filter(e => e.title === 'Jewish Museum: Free Third Thursday').map(e => e.start)).toEqual(['2026-11-19T17:00:00-05:00']);
    expect(events.filter(e => e.title === 'Whitney: Free Second Sunday').map(e => e.start)).toEqual(['2026-12-13']);
  });
  it('applies one-day overrides from the museum page', () => {
    const nov18 = events.find(e => e.title.startsWith('Museum of the City of New York') && e.start.startsWith('2026-11-18'))!;
    expect(nov18.end).toBe('2026-11-18T14:00:00-05:00');
    expect(nov18.description).toMatch(/Closing early/);
  });
  it('counts as a trusted pick', () => {
    expect(events.every(e => e.pickedBy.includes('curated') && e.price.free)).toBe(true);
  });
});

describe('repertory picks', () => {
  const base = { category: 'film' as const, tags: ['Screening'], start: '2026-11-20T19:00:00-05:00' };
  it('picks classics and special screenings at repertory houses', () => {
    expect(isRepertoryPick({ ...base, title: 'The Shop Around the Corner (1940)', venue: { name: 'Film Forum' } })).toBe(true);
    expect(isRepertoryPick({ ...base, title: 'Paris, Texas', description: 'New 4K restoration, in 35mm', venue: { name: 'Metrograph' } })).toBe(true);
    expect(isRepertoryPick({ ...base, title: 'Wicked: For Good', description: 'Q&A with the director', venue: { name: 'Nitehawk Cinema (Prospect Park)' } })).toBe(true);
    expect(isRepertoryPick({ ...base, title: 'Hamnet', venue: { name: 'Angelika Film Center & Cafe' } })).toBe(false);
    expect(isRepertoryPick({ ...base, title: 'Vertigo (1958)', venue: { name: 'AMC Empire 25' } })).toBe(false);
  });
});

describe('weights and groups', () => {
  it('weights Oh My Rockness below newsletters', () => {
    expect(score({ pickedBy: ['ohmyrockness'], price: { free: null } })).toBe(1);
    expect(score({ pickedBy: ['skint'], price: { free: null } })).toBe(3);
    expect(score({ pickedBy: ['repertory', 'fieldnotes'], price: { free: true } })).toBe(6);
  });
  it('hides library classes and kids programs but not author talks', () => {
    expect(isLibraryProgram('Class', ['Education'], 'other', 'https://www.nypl.org/events/x', 'Hudson Park Library')).toBe(true);
    expect(isLibraryProgram('Workshop', ['Kids'], 'kids', 'https://www.bklynlibrary.org/node/1', 'Dyker Library')).toBe(true);
    expect(isLibraryProgram('Reading', ['Literature'], 'books', 'https://www.nypl.org/events/y', 'Stavros Niarchos Foundation Library (SNFL)')).toBe(false);
    expect(isLibraryProgram('Workshop', ['Crafts'], 'art', 'https://example.org', 'Pioneer Works')).toBe(false);
  });
  it('treats sports watch parties as community, not film', () => {
    expect(fomoCategory('Watch Party', ['Sports', 'Soccer'])).toBe('community');
  });
});
