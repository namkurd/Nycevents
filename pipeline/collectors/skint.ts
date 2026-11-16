import { getJson, saveRaw } from '../lib/http.ts';
import { addDays, nyToday } from '../lib/time.ts';
import { parseSkintPost, type WpPost } from '../parse/skint.ts';
import type { CollectResult } from '../schema.ts';

const API = 'https://www.theskint.com/wp-json/wp/v2/posts';

export async function collectSkint(root: string): Promise<CollectResult> {
  const after = `${addDays(nyToday(), -8)}T00:00:00`;
  const posts = await getJson<WpPost[]>(`${API}?per_page=15&after=${after}&_fields=id,date,link,title,content`);
  await saveRaw(root, 'skint', 'posts.json', JSON.stringify(posts));
  const result: CollectResult = { source: 'skint', events: [], unparsed: [], notes: [] };
  let matched = 0;
  let total = 0;
  for (const p of posts) {
    const r = parseSkintPost(p);
    result.events.push(...r.events);
    result.unparsed!.push(...r.unparsed);
    matched += r.matched;
    total += r.total;
  }
  result.notes!.push(`${posts.length} posts; rules read ${matched}/${total} entries`);
  return result;
}
