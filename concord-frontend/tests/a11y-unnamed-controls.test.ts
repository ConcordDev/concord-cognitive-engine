/**
 * a11y.unnamed_control (§F) — pin for the four icon-only buttons that
 * rendered with an empty accessible name in fractal / ml / sub-worlds.
 *
 * The walker's surface() check flags AX-tree button nodes whose computed
 * accessible name is empty. Static form of the same test: a <button>
 * whose body is only icon components (possibly a ternary between two
 * icons) and whose opening tag carries no aria-label / aria-labelledby /
 * title has no name source at all.
 *
 * Legs:
 *  A — the four located sites now carry their accessible names.
 *  B — the four pristine opening-tag shapes (no aria-label) are absent.
 *  C — genus census over the three lenses' trees: no button whose body
 *      is solely an icon (or an icon ternary) lacks a name attribute.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(FE, rel), 'utf8');
}

/** Extract every <button ...> opening tag + body, brace-aware. */
function buttons(src: string): { tag: string; body: string }[] {
  const out: { tag: string; body: string }[] = [];
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let j = m.index;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      j++;
    }
    const tag = src.slice(m.index, j + 1);
    const close = src.indexOf('</button>', j);
    const body = close === -1 ? '' : src.slice(j + 1, close);
    out.push({ tag, body });
  }
  return out;
}

const NAMED = /aria-label|aria-labelledby|title\s*=/;
const ICON_ONLY =
  /^\s*(\{[^<]*<\w+[^>]*\/>\s*\}|\{[^{}]*\?\s*<\w+[^>]*\/>\s*:\s*<\w+[^>]*\/>\s*\})\s*$/s;

const SITES: { file: string; onClick: string; label: string }[] = [
  {
    file: 'components/fractal/FractalRenderer.tsx',
    onClick: 'onClick={savePreset}',
    label: 'aria-label="Save preset"',
  },
  {
    file: 'components/ml/DatasetHubPanel.tsx',
    onClick: 'onClick={loadHub}',
    label: 'aria-label="Refresh datasets"',
  },
  {
    file: 'components/ml/ModelHubPanel.tsx',
    onClick: 'onClick={load}',
    label: 'aria-label="Refresh models"',
  },
  {
    file: 'components/sub-worlds/WorldCard.tsx',
    onClick: 'onClick={onManage}',
    label: "aria-label={paused ? 'Resume world' : 'Pause world'}",
  },
];

describe('a11y.unnamed_control — the four located sites carry names', () => {
  for (const s of SITES) {
    it(`${s.file} (${s.onClick})`, () => {
      const btn = buttons(read(s.file)).find((b) => b.tag.includes(s.onClick));
      expect(btn, `button ${s.onClick} not found in ${s.file}`).toBeTruthy();
      expect(btn!.tag).toContain(s.label);
    });
  }
});

describe('a11y.unnamed_control — pristine shapes absent', () => {
  for (const s of SITES) {
    it(`${s.file} has no unnamed ${s.onClick} button`, () => {
      const btn = buttons(read(s.file)).find((b) => b.tag.includes(s.onClick));
      expect(btn).toBeTruthy();
      expect(NAMED.test(btn!.tag)).toBe(true);
    });
  }
});

describe('a11y.unnamed_control — genus census over the three lens trees', () => {
  const dirs = [
    'app/lenses/fractal',
    'app/lenses/ml',
    'app/lenses/sub-worlds',
    'components/fractal',
    'components/ml',
    'components/sub-worlds',
  ];
  function* walk(dir: string): Generator<string> {
    for (const e of fs.readdirSync(path.join(FE, dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (e.name.endsWith('.tsx') && !p.includes('__tests__')) yield p;
    }
  }
  it('no icon-only button lacks a name attribute', () => {
    const offenders: string[] = [];
    for (const d of dirs) {
      for (const f of walk(d)) {
        for (const b of buttons(read(f))) {
          if (ICON_ONLY.test(b.body) && !NAMED.test(b.tag)) {
            offenders.push(`${f}: ${b.tag.slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
