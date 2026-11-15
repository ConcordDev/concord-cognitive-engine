/**
 * H8a/H8b — Lighthouse a11y bundle for lenses A–Z (the 20 lens folders below): every form control in the
 * lens's own folders is named (aria-label / aria-labelledby / id / wrapping
 * label) and no small muted text stays at the 500 shade (below AA on dark).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(__dirname, '..');
const LENSES: Record<string, string[]> = {
  bio: ['components/bio', 'app/lenses/bio'],
  chem: ['components/chem', 'app/lenses/chem'],
  'byo-keys': ['components/byo-keys', 'app/lenses/byo-keys'],
  diy: ['components/diy', 'app/lenses/diy'],
  engineering: ['components/engineering', 'app/lenses/engineering'],
  experience: ['components/experience', 'app/lenses/experience'],
  forum: ['components/forum', 'app/lenses/forum'],
  ingest: ['components/ingest', 'app/lenses/ingest'],
  math: ['components/math', 'app/lenses/math'],
  message: ['components/message', 'app/lenses/message'],
  metacognition: ['components/metacognition', 'app/lenses/metacognition'],
  neuro: ['components/neuro', 'app/lenses/neuro'],
  news: ['components/news', 'app/lenses/news'],
  organ: ['components/organ', 'app/lenses/organ'],
  productivity: ['components/productivity', 'app/lenses/productivity'],
  quantum: ['components/quantum', 'app/lenses/quantum'],
  research: ['components/research', 'app/lenses/research'],
  root: ['components/root', 'app/lenses/root'],
  thread: ['components/thread', 'app/lenses/thread'],
  'urban-planning': ['components/urban-planning', 'app/lenses/urban-planning'],
};

function files(dir: string): string[] {
  const abs = resolve(root, dir);
  let out: string[] = [];
  try {
    for (const n of readdirSync(abs)) {
      const p = join(abs, n);
      if (n === '__tests__' || n.includes('.test.')) continue;
      if (statSync(p).isDirectory()) out = out.concat(files(join(dir, n)));
      else if (p.endsWith('.tsx')) out.push(p);
    }
  } catch { /* folder absent */ }
  return out;
}

function openingTags(src: string, name: string): Array<{ tag: string; at: number }> {
  const res: Array<{ tag: string; at: number }> = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    for (let k = m.index; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { res.push({ tag: src.slice(m.index, k + 1), at: m.index }); break; }
    }
  }
  return res;
}

/** True when a <label> (or a local <Field label=...> wrapper that renders one) opens before `at` and is still open. */
function insideLabel(src: string, at: number): boolean {
  const before = src.slice(Math.max(0, at - 1200), at);
  const open = before.lastIndexOf('<label');
  if (open >= 0 && before.indexOf('</label>', open) < 0) return true;
  const field = before.lastIndexOf('<Field ');
  return field >= 0 && before.indexOf('</Field>', field) < 0;
}

describe.each(Object.entries(LENSES))('H8a/H8b %s', (_lens, dirs) => {
  const all = dirs.flatMap(files);

  it('every select is named', () => {
    const unnamed: string[] = [];
    for (const f of all) {
      const s = readFileSync(f, 'utf8');
      for (const { tag, at } of openingTags(s, 'select')) {
        const lineStart = s.lastIndexOf('\n', at) + 1;
        if (/^\s*(\*|\/\/|\/\*)/.test(s.slice(lineStart, at + 1))) continue; // a comment, not markup
        if (/aria-label|aria-labelledby|\bid=|\{\.\.\./.test(tag)) continue;
        if (insideLabel(s, at)) continue;
        unnamed.push(`${f.replace(root, '')}:${s.slice(0, at).split('\n').length}`);
      }
    }
    expect(unnamed).toEqual([]);
  });

  it('no muted text-*-500 left in className strings', () => {
    const left: string[] = [];
    for (const f of all) {
      const s = readFileSync(f, 'utf8');
      s.split('\n').forEach((line, i) => {
        if (/(?<![:\w-])text-(zinc|gray|slate|neutral)-500\b/.test(line)) left.push(`${f.replace(root, '')}:${i + 1}`);
      });
    }
    expect(left).toEqual([]);
  });
});
