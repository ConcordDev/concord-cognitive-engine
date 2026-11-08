/**
 * Aviation full build (GB-1088 wave 1) — AV-S1 rule reconciliation.
 *
 * The seven OpsRecordsPanel kinds (Flight · Pilot · Aircraft · WorkOrder ·
 * Charter · WeightBalance · Weather) create through the generic artifact
 * layer, gated by validateArtifact against the aviation rule in
 * server/lib/domain-logic-extended.js — a rule authored in a vocabulary
 * the lens never sends (types flight-plan/inspection/logbook/checklist/
 * incident; statuses draft/filed/approved/active/completed/archived), so
 * every records create refused (the determination probe's core-create
 * "validation failed", R2 2026-11-01) and Quick Capture beside them.
 * The reconciliation admits the lens's own vocabulary (the types and
 * status sets in concord-frontend/components/aviation/aviation-ops.ts,
 * plus 'capture') while keeping the legacy vocabulary entire.
 *
 * Rules are merged exactly as server.js merges them (line ~2949):
 * a native DOMAIN_RULES entry wins; an EXTENDED entry applies only
 * where no native rule exists. Aviation has no native rule.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DOMAIN_RULES, validateArtifact, getValidTransitions, computeFields } from '../lib/domain-logic.js';
import { EXTENDED_DOMAIN_RULES } from '../lib/domain-logic-extended.js';

for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}

const MARKER = 'PR2AVIATION-PROBE-1101';

// The panel's exact create shapes (OpsRecordsPanel.handleSave →
// useLensData create): { type, title/data, meta: { status } } with the
// per-kind default status from OpsRecordsPanel.defaultStatus.
const PANEL_CREATES = [
  { kind: 'flights', type: 'Flight', status: 'planned' },
  { kind: 'pilots', type: 'Pilot', status: 'planned' },
  { kind: 'fleet', type: 'Aircraft', status: 'airworthy' },
  { kind: 'maintenance', type: 'WorkOrder', status: 'unscheduled' },
  { kind: 'charter', type: 'Charter', status: 'inquiry' },
  { kind: 'wb', type: 'WeightBalance', status: 'planned' },
  { kind: 'weather', type: 'Weather', status: 'VFR' },
];

// Every status the panel can send per kind (aviation-ops.ts status sets;
// pilots and wb have no status list and ride the default).
const PANEL_STATUSES = {
  Flight: ['planned', 'dispatched', 'airborne', 'completed', 'cancelled', 'diverted'],
  Pilot: ['planned'],
  Aircraft: ['airworthy', 'in-maintenance', 'grounded', 'stored'],
  WorkOrder: ['scheduled', 'unscheduled', 'ad-compliance', 'sb-compliance', 'inspection', 'overhaul'],
  Charter: ['inquiry', 'quoted', 'confirmed', 'completed', 'cancelled'],
  WeightBalance: ['planned'],
  Weather: ['VFR', 'MVFR', 'IFR', 'LIFR'],
};

describe('AV-S1 — the records layer accepts the panel’s own vocabulary', () => {
  it('every kind’s default create validates (the probe’s refusal, reversed)', () => {
    for (const { type, status } of PANEL_CREATES) {
      const r = validateArtifact('aviation', type, { title: MARKER }, { status });
      assert.equal(r.ok, true, `${type}/${status} refused: ${r.errors.join('; ')}`);
      assert.deepEqual(r.errors, []);
    }
  });

  it('every status the panel can send validates for its type', () => {
    for (const [type, statuses] of Object.entries(PANEL_STATUSES)) {
      for (const status of statuses) {
        const r = validateArtifact('aviation', type, { title: MARKER }, { status });
        assert.equal(r.ok, true, `${type}/${status} refused: ${r.errors.join('; ')}`);
      }
    }
  });

  it('Quick Capture validates (type capture, no status — QuickCapture’s exact shape)', () => {
    const r = validateArtifact('aviation', 'capture', { content: 'note', source: 'user.capture' }, {});
    assert.equal(r.ok, true, `capture refused: ${r.errors.join('; ')}`);
  });

  it('the gate still refuses unknown types and statuses, by name', () => {
    const badType = validateArtifact('aviation', 'Bogus', { title: MARKER }, { status: 'planned' });
    assert.equal(badType.ok, false);
    assert.match(badType.errors.join(' '), /Bogus/);
    const badStatus = validateArtifact('aviation', 'Flight', { title: MARKER }, { status: 'bogus-status' });
    assert.equal(badStatus.ok, false);
    assert.match(badStatus.errors.join(' '), /bogus-status/);
  });

  it('the legacy vocabulary still validates (no legacy-shaped record strands)', () => {
    const r = validateArtifact('aviation', 'flight-plan', { title: MARKER }, { status: 'draft' });
    assert.equal(r.ok, true, `legacy refused: ${r.errors.join('; ')}`);
    assert.deepEqual(getValidTransitions('aviation', 'draft'), ['filed', 'archived']);
  });

  it('FE statuses transition freely among themselves; the shared status takes the permissive list', () => {
    assert.ok(getValidTransitions('aviation', 'airworthy').includes('grounded'));
    assert.ok(getValidTransitions('aviation', 'planned').includes('airborne'));
    assert.ok(getValidTransitions('aviation', 'VFR').includes('LIFR'));
    // "completed" is both a legacy status and a Flight/Charter status;
    // the reconciliation gives it the FE list (legacy archived-only
    // transition superseded for the shared key, as documented in the rule).
    assert.ok(getValidTransitions('aviation', 'completed').includes('planned'));
  });

  it('legacy computedFields behaviour is unchanged (checklist completion still computed)', () => {
    const out = computeFields('aviation', 'checklist', { items: [{ checked: true }, { checked: false }] });
    assert.equal(out.checklistComplete, 1);
  });
});
