/**
 * FIX-mental-health-004 (closable legs) — the lens's manifest claimed
 * the Live tier ("Real, polled live from an external source") for
 * personal tracking data; the lens stated no privacy notice; and its
 * only public action (publishing a CDC stats card) fired without
 * confirmation or a clear public label. The tier now uses the
 * existing REAL_WORKSPACE vocabulary, the page carries the privacy
 * notice, and Publish arms for a confirming click first.
 * (Per-record visibility has no field in the record model — that leg
 * is a desk/design call, named in the slice completion post.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-mental-health-004 — privacy legs', () => {
  it('manifest tier is REAL_WORKSPACE, not REAL_LIVE', () => {
    const m = read('lib/lenses/manifest.ts');
    const seg = m.slice(m.indexOf("domain: 'mental-health'"), m.indexOf("domain: 'mental-health'") + 700);
    expect(seg).toContain("dataTier: 'REAL_WORKSPACE'");
    expect(seg).not.toContain("dataTier: 'REAL_LIVE'");
  });

  it('the page states records are private', () => {
    const s = read('app/lenses/mental-health/page.tsx');
    expect(s).toContain('Private to you');
    expect(s).toContain('visible only to your account');
  });

  it('publish requires a confirming second click', () => {
    const s = read('components/mental-health/MentalHealthActionPanel.tsx');
    expect(s).toContain('publishArmed');
    expect(s).toContain('Click Publish again to confirm');
    expect(s).toContain('PUBLIC stats card — asks first');
  });
});
