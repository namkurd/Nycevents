/** Minimal iCalendar (RFC 5545) reader for venue calendar feeds: VEVENT start/end, summary, url, location, description. */
import { clean } from './text.ts';

export interface IcsEvent { date: string; time: string | null; endDate?: string; endTime?: string | null; summary: string; url?: string; location?: string; description?: string; uid?: string }

const nyParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** A UTC instant -> New York wall-clock date and "HH:MM". */
export function nyWallClock(ms: number): { date: string; time: string } {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

function parseStamp(params: string, value: string): { date: string; time: string | null } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || /VALUE=DATE(?!-)/.test(params)) return { date, time: null };
  if (m[7]) return nyWallClock(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
  // TZID=America/New_York or floating time: treat as New York wall clock (our feeds are all NYC venues).
  return { date, time: `${m[4]}:${m[5]}` };
}

const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/); // unfold continuation lines
  const out: IcsEvent[] = [];
  let cur: Record<string, { params: string; value: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur?.DTSTART && cur.SUMMARY) {
        const s = parseStamp(cur.DTSTART.params, cur.DTSTART.value);
        const e = cur.DTEND ? parseStamp(cur.DTEND.params, cur.DTEND.value) : null;
        if (s) out.push({
          date: s.date, time: s.time, endDate: e?.date, endTime: e?.time ?? null,
          summary: clean(unescape(cur.SUMMARY.value)),
          url: cur.URL?.value, location: cur.LOCATION ? clean(unescape(cur.LOCATION.value)) : undefined,
          description: cur.DESCRIPTION ? unescape(cur.DESCRIPTION.value) : undefined, uid: cur.UID?.value,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    cur[name.toUpperCase()] = { params: params.join(';'), value: line.slice(i + 1) };
  }
  return out;
}
