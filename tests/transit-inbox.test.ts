import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inboxHash, loadExtracted, writeInbox } from '../pipeline/inbox.ts';
import { homeConfig, scoreTransit } from '../pipeline/transit/home.ts';
import type { StopsFile } from '../pipeline/transit/build-stops.ts';
import { Event } from '../pipeline/schema.ts';

// A made-up home (Columbus Circle) and a few real station coordinates; never the owner's home.
const home = { lat: 40.7681, lng: -73.9819, tier1: ['1', 'M5'], tier2: ['7'] };
const stops: StopsFile = {
  generatedAt: '2026-11-16T00:00:00Z',
  routes: {
    '1': [[40.7553, -73.9871, 'Times Sq-42 St'], [40.7740, -73.9819, '66 St-Lincoln Center']],
    M5: [[40.7831, -73.9802, 'RIVERSIDE DR/W 79 ST']],
    '7': [[40.7470, -73.9456, 'Court Sq']],
  },
};

describe('transit scoring', () => {
  it('reads home config only from the environment', () => {
    expect(homeConfig({})).toBeNull();
    expect(homeConfig({ NYC_HOME_LAT: '40.7', NYC_HOME_LNG: '-73.9', NYC_HOME_ROUTES_T1: 'A, C', NYC_HOME_ROUTES_T2: '7' }))
      .toEqual({ lat: 40.7, lng: -73.9, tier1: ['A', 'C'], tier2: ['7'] });
  });

  it('gives tier 1 within a 5-minute walk of a home-route stop', () => {
    const r = scoreTransit(40.7737, -73.9832, home, stops); // Lincoln Center plaza
    expect(r.transit?.tier).toBe(1);
    expect(r.transit?.routes).toEqual(['1']);
    expect(r.transit!.walkM).toBeLessThan(200);
  });

  it('falls back to tier 2, then to none', () => {
    expect(scoreTransit(40.7475, -73.9460, home, stops).transit?.tier).toBe(2);
    expect(scoreTransit(40.8296, -73.9262, home, stops).transit).toBeUndefined(); // Yankee Stadium
  });

  it('always reports distance from home', () => {
    expect(scoreTransit(40.7553, -73.9871, home, null).homeKm).toBeCloseTo(1.5, 0);
  });
});

describe('inbox fallback', () => {
  it('writes unparsed text to the inbox and folds extracted results back in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nycevents-'));
    const unparsed = [{ postUrl: 'https://www.theskint.com/x/', title: 'FRI-MON', range: '2026-11-13..2026-11-16', text: 'sat late: a weird one >>' }];
    const r1 = await writeInbox(root, [{ source: 'skint', events: [], unparsed }]);
    expect(r1).toEqual({ written: 1, cached: 0 });
    const [file] = await readdir(join(root, 'data', 'inbox'));
    const h = inboxHash(unparsed[0].postUrl, unparsed[0].text);
    expect(file).toBe(`skint-${h}.md`);
    expect(await readFile(join(root, 'data', 'inbox', file), 'utf8')).toContain(`cache: data/cache/extract/${h}.json`);

    // What the daily Claude session writes after reading the inbox file.
    await writeFile(join(root, 'data', 'cache', 'extract', `${h}.json`), JSON.stringify({
      source: 'skint', postUrl: unparsed[0].postUrl, extractedAt: '2026-11-16T06:00:00Z',
      events: [{ title: 'A weird one', date: '2026-11-14', start: '11pm', venue: 'Union Pool', price: 'Free', url: 'https://example.org/weird' }],
    }));
    const { events, errors } = await loadExtracted(root);
    expect(errors).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].start).toBe('2026-11-14T23:00:00-05:00');
    expect(events[0].pickedBy).toEqual(['skint']);
    expect(Event.safeParse({ ...events[0], id: '000000000000', score: 0 }).success).toBe(true);

    // Once cached, the same text is not written to the inbox again.
    expect(await writeInbox(root, [{ source: 'skint', events: [], unparsed }])).toEqual({ written: 0, cached: 1 });
  });

  it('reports a malformed cache file instead of using it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nycevents-'));
    await writeInbox(root, []);
    await writeFile(join(root, 'data', 'cache', 'extract', 'bad000000000.json'), JSON.stringify({ source: 'skint', events: [{ title: 'x' }] }));
    const { events, errors } = await loadExtracted(root);
    expect(events).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
