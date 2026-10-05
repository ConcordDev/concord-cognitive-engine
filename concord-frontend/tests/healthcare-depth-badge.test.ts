// Pins the Healthcare header chip and empty-state copy. Patients, allergies,
// meds and encounters are the user's own persisted records, so the lens must
// not be labelled DEMO, and the manifest must only advertise macros the
// server really registers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('healthcare');

describe('Healthcare manifest honesty', () => {
  it('is on the real-data tier with a "Real" chip, not DEMO', () => {
    expect(m?.dataTier).toBe('REAL_FREE');
    const badge = renderHook(() => useDepthBadge('healthcare')).result.current;
    expect(badge?.label).toBe('Real');
  });

  it('empty state and guide do not call real charts "DEMO data" or a scaffold', () => {
    const copy = JSON.stringify([m?.emptyState, m?.firstRunGuide]);
    expect(copy).not.toMatch(/DEMO|demo data|scaffold/i);
    expect(m?.emptyState?.caption).toMatch(/Not connected to an outside EHR yet/);
  });

  it('every advertised action and guide macro is registered by server/domains/healthcare.js', () => {
    const src = readFileSync(join(__dirname, '../../server/domains/healthcare.js'), 'utf8');
    for (const a of m?.actions || []) {
      expect(src, a).toContain(`"healthcare", "${a}"`);
    }
    for (const gone of ['intakeWorkflow', 'riskFlagging', 'carePlanGenerate', 'labImport', 'dischargePackage']) {
      expect(JSON.stringify(m)).not.toContain(gone);
    }
  });
});
