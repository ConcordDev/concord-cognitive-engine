/**
 * Aviation full build (GB-1088 wave 1) — AV-S1 vocabulary contract ·
 * AV-S2 tier declaration.
 *
 * AV-S1: the OpsRecordsPanel kinds create through the generic artifact
 * layer against the aviation rule in server/lib/domain-logic-extended.js.
 * This suite pins the FRONTEND half of that contract: the types and
 * status sets aviation-ops.ts can send are exactly the vocabulary the
 * reconciled rule admits (the server half is pinned by
 * server/tests/aviation-full-build.test.js against the same literals).
 *
 * AV-S2 (G1/G2): the manifest declares REAL_LIVE and the depth badge
 * renders the aviation override — label "Live", the caption naming the
 * live sources — in place of the REAL_FREE "static / open-access" line
 * the gate record stopped at.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { getTypeForKind, getStatusesForKind, type OpsKind } from '@/components/aviation/aviation-ops';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const KINDS: OpsKind[] = ['flights', 'pilots', 'fleet', 'maintenance', 'charter', 'wb', 'weather'];
const FE_TYPES = ['Flight', 'Pilot', 'Aircraft', 'WorkOrder', 'Charter', 'WeightBalance', 'Weather'];
// The status union the reconciled rule admits (aviation-ops sets +
// the shared "completed"); pinned identically in the server suite.
const FE_STATUSES = new Set([
  'planned', 'dispatched', 'airborne', 'completed', 'cancelled', 'diverted',
  'airworthy', 'in-maintenance', 'grounded', 'stored',
  'scheduled', 'unscheduled', 'ad-compliance', 'sb-compliance', 'inspection', 'overhaul',
  'inquiry', 'quoted', 'confirmed',
  'VFR', 'MVFR', 'IFR', 'LIFR',
]);

describe('AV-S1 — the panel vocabulary is the rule vocabulary', () => {
  it('every kind maps to one of the seven admitted types', () => {
    for (const kind of KINDS) {
      expect(FE_TYPES).toContain(getTypeForKind(kind));
    }
    // all seven types are reachable from a kind
    expect(new Set(KINDS.map(getTypeForKind))).toEqual(new Set(FE_TYPES));
  });

  it('every status the panel can send is in the admitted union', () => {
    for (const kind of KINDS) {
      for (const status of getStatusesForKind(kind)) {
        expect(FE_STATUSES.has(status), `${kind}/${status}`).toBe(true);
      }
    }
  });
});

function BadgeProbe({ lensId }: { lensId: string }) {
  const badge = useDepthBadge(lensId);
  return <div>{badge ? `${badge.label} :: ${badge.caption}` : 'none'}</div>;
}

describe('AV-S2 — the tier declaration reads Live, with the honest caption', () => {
  it('the manifest declares REAL_LIVE for aviation', () => {
    expect(getLensManifest('aviation')?.dataTier).toBe('REAL_LIVE');
  });

  it('the depth badge renders the aviation override', () => {
    const { container } = render(<BadgeProbe lensId="aviation" />);
    expect(container.textContent).toContain('Live ::');
    expect(container.textContent).toContain('METAR/TAF');
    expect(container.textContent).toContain('OpenSky');
    expect(container.textContent).not.toContain('static / open-access');
  });
});
