/**
 * ConKay facts for the Chat analyst (Review 3 — ConKay F2).
 *
 * Arriving with ?context=conkay used to give the analyst a label and no
 * data: it denied the user's open study existed and quoted an Engineering
 * frame DTU from the shared store as "the most recent FEA result". These
 * tests pin the conkay provider's contract:
 *   GROUNDED — current model + latest result come from the workspace's own
 *              reads (engineering.beamStudy-get / listParts), with sources.
 *   ORIGIN RULE — the block instructs that store records are cross-lens
 *              and must be origin-labelled, never read as the study.
 *   NO STUDY IS A FACT — "no study yet" is stated, not treated as missing.
 *   FAILURE NAMES ITSELF — an unreadable read is named, never zero-filled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
  apiHelpers: { dtus: { myDtus: vi.fn() } },
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));
vi.mock('@/lib/utils', () => ({
  formatNumber: (n: number) => n.toLocaleString('en-US'),
}));

import { buildLensFactsBlock } from '@/components/chat/lensAccountFacts';

const STUDY = {
  name: 'I-beam',
  dims: { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 },
  support: 'simply-supported',
  loadN: 200000,
  material: 'steel-a992',
  materialInfo: { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)', E: 200000, yield: 345 },
  summary: { maxStressMPa: 84.73, maxDeflectionMm: 0.339, utilization: 0.246, safetyFactor: 4.07, pass: true },
  jobId: 'sim_abc123',
  dtuId: 'dtu_6e443d7bbb6b98342082',
};

function wire(study: unknown, parts: Array<{ name: string }>) {
  lensRunMock.mockImplementation((_domain: string, action: string) => {
    if (action === 'beamStudy-get') return Promise.resolve({ data: { ok: true, result: { study } } });
    if (action === 'listParts') return Promise.resolve({ data: { ok: true, result: { parts } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('buildLensFactsBlock — conkay grounding (F2)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('grounds current model and latest result in the study itself', async () => {
    wire(STUDY, [{ name: 'I-beam' }, { name: 'Bracket' }]);
    const block = await buildLensFactsBlock('conkay');
    expect(block).toContain('ConKay');
    expect(block).toContain('Current study');
    expect(block).toContain('I-beam');
    expect(block).toContain('Most recent FEA result');
    expect(block).toContain('84.7 MPa');
    expect(block).toContain('sim_abc123');
    expect(block).toContain('dtu_6e443d7bbb6b98342082');
    expect(block).toContain('Saved models');
    expect(block).toContain('engineering.beamStudy-get');
  });

  it('carries the origin rule for shared-store records', async () => {
    wire(STUDY, []);
    const block = await buildLensFactsBlock('conkay');
    expect(block).toContain('shared across lenses');
    expect(block).toContain('name the lens it came from');
    expect(block).toContain('NOT the user\'s ConKay study');
  });

  it('states "no study yet" as a fact, not a failure', async () => {
    wire(null, []);
    const block = await buildLensFactsBlock('conkay');
    expect(block).toContain('No study has been solved or saved');
    expect(block).not.toContain('could not be read');
  });

  it('names an unreadable read instead of inventing values', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'beamStudy-get') return Promise.resolve({ data: { ok: false, error: 'state unavailable' } });
      return Promise.resolve({ data: { ok: true, result: { parts: [] } } });
    });
    const block = await buildLensFactsBlock('conkay');
    expect(block).toContain('Not readable just now');
    expect(block).toContain('Current study (engineering.beamStudy-get)');
    expect(block).not.toContain('84.7');
  });
});
