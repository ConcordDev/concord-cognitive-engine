/**
 * The rule against faked numbers, enforced in code.
 *
 * Any lens file that uses the lens kit shows its numbers only through
 * `<SourcedNumber>` / `sourced()`. So in those files these are refused:
 *   .toFixed(  .toLocaleString(  .toPrecision(  Intl.NumberFormat   — formatting a number by hand
 *   Math.random(                                                     — inventing one
 * A genuine non-display use (an id, a seed, a CSS width) carries, on the same or the
 * line above, a comment saying so:  // lens-kit: not a displayed number — <why>
 *
 * And every lens token file that defines the `--lk-*` contract must pass the
 * contrast check in every mode it defines.
 *
 * The kit's own formatting module (lib/lens-kit/sourced.ts) is the one place allowed
 * to format. Lenses not yet on the kit are untouched; a lens joins by importing it,
 * which the starter template (scripts/new-lens.mjs) does from the first line.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { checkLensTokens } from '@/lib/lens-kit/contrast';

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'components', 'lib'];
const SKIP = /node_modules|\.next|__tests__|\.test\.|\.spec\./;
const KIT_IMPORT = /from\s+['"]@\/(?:components\/lens-kit|lib\/lens-kit)(?:\/[^'"]*)?['"]/;
const ALLOWED = new Set([path.join('lib', 'lens-kit', 'sourced.ts')]);
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\.toFixed\s*\(/, 'toFixed'], [/\.toLocaleString\s*\(/, 'toLocaleString'], [/\.toPrecision\s*\(/, 'toPrecision'],
  [/\bIntl\.NumberFormat\b/, 'Intl.NumberFormat'], [/\bMath\.random\s*\(/, 'Math.random'],
];
const EXEMPT = /lens-kit:\s*not a displayed number\s*[—-]\s*\S/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Violations in one file's text (exported shape for the self-test below). */
export function numberRuleViolations(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments describing the rule are not uses of it
    for (const [re, name] of FORBIDDEN) {
      if (!re.test(line)) continue;
      if (EXEMPT.test(line) || EXEMPT.test(lines[i - 1] || '')) continue;
      out.push(`line ${i + 1}: ${name} — show numbers with <SourcedNumber>/sourced(); a non-display use needs "// lens-kit: not a displayed number — <why>"`);
    }
  });
  return out;
}

describe('the number rule', () => {
  it('the checker itself: catches hand formatting and invented numbers, honours a reasoned exemption, ignores comments', () => {
    expect(numberRuleViolations('const s = price.toFixed(2);')).toHaveLength(1);
    expect(numberRuleViolations('<b>{n.toLocaleString()}</b>')).toHaveLength(1);
    expect(numberRuleViolations('const x = new Intl.NumberFormat("en").format(v)')).toHaveLength(1);
    expect(numberRuleViolations('const fake = Math.random() * 100;')).toHaveLength(1);
    expect(numberRuleViolations('// lens-kit: not a displayed number — a React key\nconst k = Math.random().toString(36);')).toHaveLength(0);
    expect(numberRuleViolations('const k = Math.random(); // lens-kit: not a displayed number — jitter for a layout seed')).toHaveLength(0);
    expect(numberRuleViolations('// lens-kit: not a displayed number —\nconst k = Math.random();')).toHaveLength(1); // an exemption needs a reason
    expect(numberRuleViolations(' * never call .toFixed() here')).toHaveLength(0);
  });

  it('every file that uses the kit shows numbers only through it', () => {
    const offenders: string[] = [];
    let adopters = 0;
    for (const d of DIRS) for (const f of walk(path.join(ROOT, d))) {
      if (!/\.(tsx?|jsx?)$/.test(f)) continue;
      const rel = path.relative(ROOT, f);
      if (ALLOWED.has(rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      const inKit = rel.startsWith(path.join('components', 'lens-kit')) || rel.startsWith(path.join('lib', 'lens-kit'));
      if (!inKit && !KIT_IMPORT.test(text)) continue;
      adopters += 1;
      for (const v of numberRuleViolations(text)) offenders.push(`${rel} ${v}`);
    }
    expect(adopters).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('every lens token file on the --lk contract passes contrast in every mode it defines', () => {
    const failures: string[] = [];
    for (const f of walk(path.join(ROOT, 'components'))) {
      if (!f.endsWith('.css')) continue;
      const css = fs.readFileSync(f, 'utf8');
      if (!/--lk-surface\s*:/.test(css)) continue;
      const r = checkLensTokens(css);
      for (const x of r.failures) failures.push(`${path.relative(ROOT, f)} [${x.mode}] ${x.detail || `${x.fg} on ${x.bg} is ${x.ratio}:1, needs ${x.min}:1 (${x.what})`}`);
    }
    expect(failures).toEqual([]);
  });
});
