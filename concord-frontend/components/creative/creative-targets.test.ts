import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// FIX-creative-012 (tap-target leg): the Creative lens measured tabs 32px,
// chips 23px, buttons 28-32px and footer actions ~16px. Every button,
// input, select and control-link in the lens components now carries the
// 44px floor — directly, or through the ProductionSuite BTN / BTN_GHOST /
// INPUT constants, which carry it once for all their consumers. Excluded
// by design: multi-line textareas (height is rows-driven), the full-row
// board button and the Reddit post-card link (heights are content-driven).
// The lens's tabs render through the shared NorthStarFrame; its pill
// height is a shared-frame question, not this lens ticket.
const FILES = ['CreativeActionPanel.tsx', 'CreativeBoard.tsx', 'CreativeBoardsSection.tsx', 'ProductionSuite.tsx', 'RedditCreative.tsx'];

function unfloored(path: string, src: string): string[] {
  const bad: string[] = [];
  const re = /<(button|input|select|a)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let k = m.index + m[0].length;
    let depth = 0;
    while (k < src.length) {
      const c = src[k];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      k += 1;
    }
    const tag = src.slice(m.index, k + 1);
    if (/type="(checkbox|radio|hidden)"/.test(tag) || tag.includes('className="hidden"')) continue;
    const cm = tag.match(/className=\{?["`]([^"`]*)["`]/);
    if (!cm) continue;
    const cls = cm[1];
    if (cls.includes('min-h-11') || cls.includes('h-11')) continue;
    if (cls.startsWith('${BTN') || cls.startsWith('${INPUT}')) continue;
    if (cls.includes('block w-full text-left')) continue;
    if (cls.startsWith('group block rounded border')) continue; // post-card link
    bad.push(`${path}: ${cls.slice(0, 70)}`);
  }
  return bad;
}

describe('Creative lens touch targets (FIX-creative-012, tap leg)', () => {
  it('the shared ProductionSuite constants carry the floor', () => {
    const src = readFileSync(join(__dirname, 'ProductionSuite.tsx'), 'utf8');
    expect(src).toContain("const BTN = 'inline-flex min-h-11");
    expect(src).toContain("const BTN_GHOST = 'inline-flex h-11 w-11");
    expect(src).toContain("const INPUT = 'min-h-11 w-full");
  });

  it('no control in the creative components sits under the floor', () => {
    const bad = FILES.flatMap((f) => unfloored(f, readFileSync(join(__dirname, f), 'utf8')));
    expect(bad).toEqual([]);
  });
});
