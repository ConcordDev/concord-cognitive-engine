/**
 * FIX-government-005 (markup leg) + FIX-government-021 — Lighthouse
 * counted hundreds of government fields without id/name and no
 * accessible names. Every control in the lens's components now
 * carries a name (from its visible label, its placeholder, or its
 * field), and the Payments panel's Pay buttons render an honest
 * disabled state — with the reason — when online payment is not
 * configured, instead of opening a dialog to explain.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

function unlabeled(src: string): string[] {
  const out: string[] = [];
  const re = /<(select|input|textarea)\b(?:[^>{]|\{[^}]*\})*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const t = m[0];
    if (!t.includes('aria-label') && !t.includes('aria-labelledby') && !t.includes('id=')) out.push(t.slice(0, 60));
  }
  return out;
}

describe('FIX-government-005/021 — government forms', () => {
  it('no unlabeled control remains in any government component', () => {
    const dir = path.join(process.cwd(), 'components/government');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      expect({ file: f, left: unlabeled(read(`components/government/${f}`)) }).toEqual({ file: f, left: [] });
    }
  });

  it('CaseOpsPanel carries no duplicate aria-label on the redaction notes field', () => {
    const s = read('components/government/CaseOpsPanel.tsx');
    expect(s).not.toContain('aria-label="Redaction Required" aria-label="Redaction Notes"');
    expect(s).toContain('aria-label="Redaction Notes"');
  });

  it('Pay buttons disable with the reason when payment is unconfigured', () => {
    const s = read('components/government/PaymentsPanel.tsx');
    expect(s).toContain('disabled={busy || !stripeConfigured}');
    expect(s).toContain("title={stripeConfigured ? undefined : 'Online payment is not configured'}");
  });
});
