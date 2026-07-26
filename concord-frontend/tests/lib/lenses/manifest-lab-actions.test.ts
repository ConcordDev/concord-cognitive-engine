// Regression pin for the 2026-07-23 UX-polish audit fix: the `lab` lens
// manifest's `actions` array used to be
// ['run_protocol', 'record_result', 'compare_runs', 'statistical_analysis',
//  'equipment_calibrate', 'generate_report'] — six names that matched ZERO
// registered `lab.*` macros in server/domains/lab.js. `ManifestActionBar`
// (mounted on the lab lens page) fires every manifest action verbatim via
// `apiHelpers.lens.runDomain(domain, action, {})`, so every one of those six
// quick-action buttons always errored with an unknown-macro rejection.
//
// This pins two things against regression: (1) every `lab` manifest action
// is one of the REAL macro names registered by `registerLensAction("lab", …)`
// in server/domains/lab.js, and (2) each of those actions is safe to fire
// with `{}` (no required params) since ManifestActionBar always calls with
// an empty input object.
import { describe, it, expect } from 'vitest';
import { getLensManifest } from '@/lib/lenses/manifest';

// Mirrors the real `registerLensAction("lab", "<name>", …)` calls in
// server/domains/lab.js that accept a call with no params (list-style reads
// with an optional orgId — never required).
const REAL_ZERO_ARG_LAB_MACROS = new Set([
  'notebook-list',
  'inventory-list',
  'protocol-list',
  'plate-list',
  'run-list',
  'construct-list',
  'org-list-mine',
  'qc-trend',
]);

describe('lab lens manifest — actions resolve to real macros', () => {
  it('every action in manifest.actions is a real, zero-arg-safe lab macro', () => {
    const manifest = getLensManifest('lab');
    expect(manifest).toBeDefined();
    expect(manifest!.actions.length).toBeGreaterThan(0);
    for (const action of manifest!.actions) {
      expect(REAL_ZERO_ARG_LAB_MACROS.has(action), `manifest.lab.actions contains unregistered/unsafe macro "${action}"`).toBe(true);
    }
  });

  it('does not regress to the old fabricated placeholder action names', () => {
    const manifest = getLensManifest('lab');
    const fabricated = ['run_protocol', 'record_result', 'compare_runs', 'statistical_analysis', 'equipment_calibrate', 'generate_report'];
    for (const name of fabricated) {
      expect(manifest!.actions).not.toContain(name);
    }
  });

  it('macros.list / macros.get are real dotted lab macro ids, not the old lens.lab.* phantom namespace', () => {
    const manifest = getLensManifest('lab');
    expect(manifest!.macros.list).not.toMatch(/^lens\.lab\./);
    expect(manifest!.macros.get).not.toMatch(/^lens\.lab\./);
    expect(manifest!.macros.list).toMatch(/^lab\./);
    expect(manifest!.macros.get).toMatch(/^lab\./);
  });
});
