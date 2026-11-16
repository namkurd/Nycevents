import { PICK_WEIGHTS, type Event } from './schema.ts';

/**
 * score = sum of pick weights (PICK_WEIGHTS: newsletters 3 … Oh My Rockness 1) + 1 if free
 *       + 1 if transit tier 1 + 0.5 if tier 2 + 0.5 if homeKm < 3.
 * Proximity is a nudge: one newsletter pick (3) outweighs every transit bonus combined (2).
 */
export function score(e: Pick<Event, 'pickedBy' | 'price' | 'transit' | 'homeKm'>): number {
  let s = e.pickedBy.reduce((n, p) => n + (PICK_WEIGHTS[p] ?? 3), 0);
  if (e.price.free) s += 1;
  if (e.transit?.tier === 1) s += 1;
  else if (e.transit?.tier === 2) s += 0.5;
  if (e.homeKm != null && e.homeKm < 3) s += 0.5;
  return s;
}

export const isPick = (e: Pick<Event, 'pickedBy'>) => e.pickedBy.length > 0;
