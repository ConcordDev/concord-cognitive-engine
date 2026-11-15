// FIX-mental-health-008 — Lighthouse: "Form elements do not have
// associated labels" / unlabeled selects. The mental-health panels
// are compact grids whose controls were identified only by their
// options or placeholders; every select, input, and textarea on the
// surface now carries an accessible name (explicit aria-labels naming
// what each field is). This pin re-runs the association scan over the
// whole mental-health surface.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '..', 'components', 'mental-health');
const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));
const sources = new Map(files.map((f) => [f, readFileSync(path.join(DIR, f), 'utf8')]));

function unlabelled(src: string): string[] {
  const spans = Array.from(src.matchAll(/<label\b[^>]*>.*?<\/label>/gs)).map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const fors = new Set(Array.from(src.matchAll(/htmlFor="([^"]+)"/g)).map((m) => m[1]));
  const bad: string[] = [];
  for (const m of src.matchAll(/<(select|input|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (attrs.includes('aria-label') || attrs.includes('aria-labelledby')) continue;
    const type = /type="([^"]+)"/.exec(attrs)?.[1];
    if (type === 'hidden' || type === 'checkbox' || type === 'radio') continue;
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (id && fors.has(id)) continue;
    const at = m.index ?? 0;
    if (spans.some(([a, b]) => a <= at && at <= b)) continue;
    bad.push(`${m[1]}@${at}`);
  }
  return bad;
}

describe('FIX-mental-health-008 — mental-health form controls are labelled', () => {
  it('no control on the surface is unlabelled', () => {
    for (const [file, src] of sources) {
      expect(unlabelled(src), file).toEqual([]);
    }
  });

  it('the six audited selects carry their names', () => {
    const all = Array.from(sources.values()).join('\n');
    for (const name of ['Country', 'Current mood', 'Session type', 'Session duration', 'Reminder kind', 'Sleep quality']) {
      expect(all).toContain(`aria-label="${name}"`);
    }
  });
});
