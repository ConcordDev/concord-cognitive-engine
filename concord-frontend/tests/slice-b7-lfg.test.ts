import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Slice B7 — FIX-lfg-009: DevTools Issues flagged LFG form fields
// with no id/name (autofill + form-identity). Every input/select/
// textarea on the LFG surfaces (the lens page's post form, the world
// LFG board's post form, the party create form) now carries both.

const ROOT = join(__dirname, '..');
const FILES = [
  'app/lenses/lfg/page.tsx',
  'components/world/LFGBoardPanel.tsx',
  'components/world/PartyPanel.tsx',
];

function formElements(src: string): string[] {
  // Normalize arrow functions first so their '>' doesn't end the tag early.
  const flat = src.replace(/=>/g, '=ARROW');
  const out: string[] = [];
  const re = /<(input|select|textarea)\b[\s\S]*?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) out.push(m[0]);
  return out;
}

describe('FIX-lfg-009 form field identity', () => {
  for (const rel of FILES) {
    it(`${rel}: every form field carries id and name`, () => {
      const els = formElements(readFileSync(join(ROOT, rel), 'utf8'));
      expect(els.length).toBeGreaterThan(0);
      for (const el of els) {
        expect(el, el.slice(0, 80)).toMatch(/\bid=/);
        expect(el, el.slice(0, 80)).toMatch(/\bname=/);
      }
    });
  }
});
