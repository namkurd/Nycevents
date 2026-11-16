/** Time helpers. Everything is New York local time, written as ISO with the right offset. */

const TZ = 'America/New_York';
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' });
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** UTC offset in New York for a wall-clock date+time, e.g. "-05:00". */
export function nyOffset(date: string, hhmm = '12:00'): string {
  // Probe at the wall-clock instant interpreted as UTC, then correct once; good enough away from the 2am switch.
  const probe = new Date(`${date}T${hhmm}:00Z`);
  const part = offsetFmt.formatToParts(probe).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  const m = part.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? '00'}` : '-05:00';
}

/** Combine "2026-11-20" + "19:00" into "2026-11-20T19:00:00-05:00". */
export function nyIso(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00${nyOffset(date, hhmm)}`;
}

/** Today's date in New York, "YYYY-MM-DD". */
export function nyToday(now = new Date()): string {
  return dateFmt.format(now);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
}

/**
 * Parse a clock time like "7pm", "10:30am", "7:30", "noon", "19:00" into "HH:MM".
 * `meridiemHint` supplies am/pm when the text has none (e.g. the "6" in "6-9pm").
 */
export function parseClock(text: string | null | undefined, meridiemHint?: 'am' | 'pm'): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/\./g, '');
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  const mer = m[3] ? (m[3].startsWith('a') ? 'am' : 'pm') : meridiemHint;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (!mer && !m[2] && h <= 12) return null; // bare "7" with no hint is ambiguous
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Parse a range like "6-9pm", "6—9pm", "11am-5pm", "7:30pm", "6-7:30pm" into start/end "HH:MM".
 * The end's am/pm is applied to a bare start ("6-9pm" -> 18:00-21:00).
 */
export function parseClockRange(text: string): { start: string; end?: string } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?|noon|midnight)(?:[-–—]|to)(\d{1,2}(?::\d{2})?(?:am|pm)?|noon|midnight)$/);
  if (m) {
    const endMer = /pm$/.test(m[2]) ? 'pm' : /am$/.test(m[2]) ? 'am' : undefined;
    const end = parseClock(m[2]);
    let start = parseClock(m[1], endMer);
    // "11-1pm": start would be 23:00 > end; pull it back to am.
    if (start && end && start > end && !/(am|pm)$/.test(m[1])) start = parseClock(m[1], 'am');
    return start ? { start, end: end ?? undefined } : null;
  }
  const single = parseClock(t);
  return single ? { start: single } : null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Month name (full or 3-letter) to 1..12, or null. */
export function monthIndex(name: string): number | null {
  const n = name.toLowerCase().slice(0, 3);
  const i = MONTHS.findIndex(m => m.startsWith(n));
  return i >= 0 ? i + 1 : null;
}

/**
 * Resolve a month/day with no year to the YYYY-MM-DD nearest `anchor` (a post date),
 * so "December 2" in a late-November post lands in the same year and "January 3" in the next.
 */
export function resolveMonthDay(month: number, day: number, anchor: string): string {
  const y = Number(anchor.slice(0, 4));
  const candidates = [y - 1, y, y + 1].map(yy => `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  return candidates.reduce((best, c) => (Math.abs(daysBetween(anchor, c)) < Math.abs(daysBetween(anchor, best)) ? c : best));
}
