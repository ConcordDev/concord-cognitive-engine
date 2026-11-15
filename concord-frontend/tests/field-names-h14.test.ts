/**
 * H14 — every form control in the debug and ops lenses carries a name (so
 * DevTools stops flagging "form field should have an id or name") and a
 * human label, and the crypto wallet row's icon buttons are named.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(__dirname, '..');

function tags(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    for (let k = m.index; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { out.push(src.slice(m.index, k + 1)); break; }
    }
  }
  return out;
}

describe.each(['components/debug', 'components/ops'])('H14 %s', (dir) => {
  const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.tsx') && !f.includes('.test.')).map((f) => join(root, dir, f));
  it('every input/select/textarea has an id or name', () => {
    const bad: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const n of ['input', 'select', 'textarea']) {
        for (const t of tags(s, n)) {
          if (/type="(hidden|file)"/.test(t)) continue;
          if (!/\s(id|name)=/.test(t)) bad.push(`${f.replace(root, '')}: ${t.slice(0, 70)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('H14 crypto wallet row', () => {
  const s = readFileSync(resolve(root, 'components/crypto/CryptoWalletWorkspace.tsx'), 'utf8');
  it.each([
    'aria-label={`Copy address ${shortAddr}`}',
    'aria-label="Receive to this wallet (QR code)"',
    'aria-label="Copy wallet address"',
    'aria-label="Remove wallet"',
  ])('has %s', (needle) => {
    expect(s).toContain(needle);
  });
});
