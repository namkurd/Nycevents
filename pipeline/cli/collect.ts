/** npm run collect -- --source=skint   (one collector, prints counts and a sample; for debugging) */
import { collectFomo } from '../collectors/fomo.ts';
import { collectNycForFree } from '../collectors/nycforfree.ts';
import { collectSkint } from '../collectors/skint.ts';
import { collectSubstack } from '../collectors/substack.ts';
import { collectOhMyRockness } from '../collectors/ohmyrockness.ts';
import { collectThoughtGallery } from '../collectors/thoughtgallery.ts';

const source = process.argv.find(a => a.startsWith('--source='))?.split('=')[1];
const fns: Record<string, () => Promise<{ events: { start: string; title: string; venue: { name: string } }[]; unparsed?: unknown[]; notes?: string[] }>> = {
  fomo: () => collectFomo(process.cwd()),
  nycforfree: () => collectNycForFree(process.cwd()),
  skint: () => collectSkint(process.cwd()),
  fieldnotes: () => collectSubstack(process.cwd(), 'fieldnotes'),
  cityhappenings: () => collectSubstack(process.cwd(), 'cityhappenings'),
  readingthecity: () => collectSubstack(process.cwd(), 'readingthecity'),
  ohmyrockness: () => collectOhMyRockness(process.cwd()),
  thoughtgallery: () => collectThoughtGallery(process.cwd()),
};
if (!source || !fns[source]) {
  console.error(`usage: npm run collect -- --source=${Object.keys(fns).join('|')}`);
  process.exit(1);
}
const r = await fns[source]();
console.log(`${r.events.length} events, ${r.unparsed?.length ?? 0} unparsed`, r.notes ?? '');
for (const e of r.events.slice(0, 15)) console.log(`${e.start}  ${e.title.slice(0, 60)}  @ ${e.venue.name}`);
