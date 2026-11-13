// FIX-construction-008 — Lighthouse: "Select elements do not have
// associated label elements" (plus form fields without id/name). The
// construction forms rendered captions as bare <label> elements with
// no htmlFor and controls with no id, so the association existed only
// visually. Two shapes fixed it: the Field wrapper in
// FieldManagementPanel now clones its control with a generated id
// (+ name) and points its label at it, healing every Field-wrapped
// form at once; ProjectRegistryPanel's caption labels are paired with
// their controls by id; and the remaining placeholder/filter controls
// carry explicit names. This pin re-runs the association scan over the
// whole construction surface.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '..', 'components', 'construction');
const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));
const sources = new Map(files.map((f) => [f, readFileSync(path.join(DIR, f), 'utf8')]));

function unlabelledSelects(src: string): number[] {
  const spans = Array.from(src.matchAll(/<label\b[^>]*>.*?<\/label>/gs)).map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const fieldBlocks = Array.from(src.matchAll(/<Field\b[^>]*>.*?<\/Field>/gs)).map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const fors = new Set(Array.from(src.matchAll(/htmlFor="([^"]+)"/g)).map((m) => m[1]));
  const bad: number[] = [];
  for (const m of src.matchAll(/<select\b([^>]*)>/g)) {
    const attrs = m[1];
    if (attrs.includes('aria-label') || attrs.includes('aria-labelledby')) continue;
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (id && fors.has(id)) continue;
    const at = m.index ?? 0;
    if (spans.some(([a, b]) => a <= at && at <= b)) continue;
    if (fieldBlocks.some(([a, b]) => a <= at && at <= b)) continue; // Field clones id + htmlFor
    bad.push(at);
  }
  return bad;
}

describe('FIX-construction-008 — construction form labels are associated', () => {
  it('no select on the construction surface is unlabelled', () => {
    for (const [file, src] of sources) {
      expect(unlabelledSelects(src), file).toEqual([]);
    }
  });

  it('the Field wrapper associates its label with the control', () => {
    const field = sources.get('FieldManagementPanel.tsx') ?? '';
    expect(field).toContain('htmlFor={controlId}');
    expect(field).toContain('cloneElement');
  });

  it('registry captions are paired with their controls', () => {
    const registry = sources.get('ProjectRegistryPanel.tsx') ?? '';
    const pairs = registry.match(/htmlFor="construction-[a-z0-9-]+"/g) ?? [];
    expect(pairs.length).toBeGreaterThanOrEqual(20);
    expect(registry).toContain('aria-label="Filter by status"');
  });
});
