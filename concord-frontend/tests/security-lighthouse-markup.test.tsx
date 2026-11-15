/**
 * FIX-security-009 (markup legs) — Lighthouse a11y 91 flagged
 * unlabeled selects and form controls across the security lens. The
 * ops panel's fields all had visible labels that were never
 * associated; they now carry those names programmatically, as do the
 * SOC console's forms (named from their fields/placeholders), the
 * vuln manager, the threat grid, and the advisory stack box. The CSP
 * eval leg is a Lighthouse artifact (zero eval/new Function in the
 * lens, grep-verified); contrast/role legs price at the desk's
 * re-run.
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
    if (t.includes('type="checkbox"')) continue; // text-bearing wrapping labels name these
    if (!t.includes('aria-label') && !t.includes('aria-labelledby') && !t.includes('id=')) out.push(t.slice(0, 60));
  }
  return out;
}

describe('FIX-security-009 — security controls are named', () => {
  it('SecurityOpsPanel fields carry their label text', () => {
    const s = read('components/security/SecurityOpsPanel.tsx');
    expect(s).toContain('aria-label="Severity"');
    expect(s).toContain('aria-label="Filter by status"');
    expect(unlabeled(s)).toEqual([]);
  });

  it('SOCConsole forms are named', () => {
    const s = read('components/security/SOCConsole.tsx');
    expect(s).toContain('value={evForm.severity} aria-label="Event severity"');
    expect(s).not.toMatch(/value=\{[a-zA-Z.]+ aria-label/);
    expect(s).toContain('aria-label={`Status for camera ${c.name}`}');
    expect(unlabeled(s)).toEqual([]);
  });

  it('vuln manager, threat grid, advisories and action menu are named', () => {
    expect(read('components/security/VulnManager.tsx')).toContain('aria-label={`Status for ${v.cveId}`}');
    expect(read('components/security/ThreatVulnPanel.tsx')).toContain('aria-label="Probability (1-5)"');
    expect(read('components/security/SecurityAdvisories.tsx')).toContain('aria-label="Filter by severity"');
    expect(read('components/security/AdvisoryActionMenu.tsx')).toContain('aria-label="Your stack"');
  });

  it('no eval or new Function in the lens (CSP leg)', () => {
    for (const f of ['SecurityOpsPanel.tsx', 'SOCConsole.tsx', 'VulnManager.tsx', 'ThreatVulnPanel.tsx']) {
      const s = read(`components/security/${f}`);
      expect(s).not.toContain('eval(');
      expect(s).not.toContain('new Function');
    }
  });
});
