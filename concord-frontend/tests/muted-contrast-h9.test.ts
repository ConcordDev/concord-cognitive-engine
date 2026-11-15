/**
 * H9 — no `text-*-500` muted text left in the 19 lens folders whose tickets
 * reported dim helper text on the dark theme (zinc/gray/slate/neutral 500
 * is ~4.2:1 on near-black, below AA 4.5:1). hover:/disabled: variants and
 * border/bg classes are not text and are ignored.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(__dirname, '..');
const LENSES = ['commonsense', 'cri', 'docs', 'emergency-services', 'fashion', 'home-improvement', 'inference', 'lfg', 'market', 'metalearning', 'music', 'ops-telemetry', 'privacy', 'realestate', 'social', 'strategic-adds', 'suffering', 'translation', 'ux-suite'];

function files(dir: string): string[] {
  let out: string[] = [];
  try {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (n === '__tests__' || n.includes('.test.')) continue;
      if (statSync(p).isDirectory()) out = out.concat(files(p));
      else if (p.endsWith('.tsx')) out.push(p);
    }
  } catch { /* folder absent */ }
  return out;
}

describe.each(LENSES)('H9 %s', (lens) => {
  it('has no bare text-/placeholder- 500 muted shades', () => {
    const left: string[] = [];
    for (const f of [...files(resolve(root, 'components', lens)), ...files(resolve(root, 'app/lenses', lens))]) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/(?<![:\w-])(text|placeholder)-(zinc|gray|slate|neutral)-500\b/.test(line)) left.push(`${f.replace(root, '')}:${i + 1}`);
      });
    }
    expect(left).toEqual([]);
  });
});
