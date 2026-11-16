/**
 * Home location and routes, read only from the environment (never committed; the repo is public).
 *   NYC_HOME_LAT, NYC_HOME_LNG, NYC_HOME_ROUTES_T1 ("A,C,M5"), NYC_HOME_ROUTES_T2 ("7")
 */
import { metres } from '../lib/text.ts';
import type { StopsFile } from './build-stops.ts';

export interface HomeConfig { lat: number; lng: number; tier1: string[]; tier2: string[] }

export function homeConfig(env: NodeJS.ProcessEnv = process.env): HomeConfig | null {
  const lat = Number(env.NYC_HOME_LAT);
  const lng = Number(env.NYC_HOME_LNG);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !env.NYC_HOME_LAT || !env.NYC_HOME_LNG) return null;
  const list = (v?: string) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return { lat, lng, tier1: list(env.NYC_HOME_ROUTES_T1), tier2: list(env.NYC_HOME_ROUTES_T2) };
}

export const WALK_M = 400; // about a 5-minute walk

/** Transit tier and distance from home for one point. */
export function scoreTransit(lat: number, lng: number, home: HomeConfig, stops: StopsFile | null):
  { transit?: { tier: 1 | 2; routes: string[]; walkM: number }; homeKm: number } {
  const homeKm = Math.round(metres(home.lat, home.lng, lat, lng) / 100) / 10;
  if (!stops) return { homeKm };
  for (const [tier, routes] of [[1, home.tier1], [2, home.tier2]] as const) {
    let best = Infinity;
    const hit: string[] = [];
    for (const r of routes) {
      let near = Infinity;
      for (const [sLat, sLng] of stops.routes[r] ?? []) {
        // cheap bounding check before the trig
        if (Math.abs(sLat - lat) > 0.006 || Math.abs(sLng - lng) > 0.008) continue;
        near = Math.min(near, metres(lat, lng, sLat, sLng));
      }
      if (near <= WALK_M) { hit.push(r); best = Math.min(best, near); }
    }
    if (hit.length) return { transit: { tier, routes: hit, walkM: Math.round(best) }, homeKm };
  }
  return { homeKm };
}
