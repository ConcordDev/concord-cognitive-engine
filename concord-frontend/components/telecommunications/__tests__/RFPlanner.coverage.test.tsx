// Render + behaviour coverage for the RF network planner: every sub-tab with real-shaped macro
// results (sites, coverage, interference, capacity, topology, spectrum, outages/SLA, drive test).
// Heavy viz components are stubbed.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const TOWER = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Tower ${id}`, lat: 40.7, lon: -74, heightM: 45, powerWatts: 20, gainDbi: 15, freqMhz: 1800, technology: 'LTE', terrain: 'urban', status: 'active', backhaul: 'fiber', sectors: 3, ...over });
const ALLOC = (id: string, band: string, start: number) => ({ id, band, startMhz: start, widthMhz: 20, endMhz: start + 20, technology: 'LTE', licenseType: 'licensed', region: 'US', guardBandMhz: 5 });
const OUTAGE = (id: string, sev: string, resolved: number | null) => ({ id, site: `Tower t1`, cause: 'Fiber cut', severity: sev, affectedSubscribers: 1200, startedAt: 1_770_000_000, resolvedAt: resolved, status: resolved ? 'resolved' : 'open' });
function resultFor(action: string): unknown {
  switch (action) {
    case 'towerList': return { towers: [TOWER('t1'), TOWER('t2', { terrain: 'rural', status: 'planned', backhaul: 'satellite', lat: 40.8 })] };
    case 'spectrumList': return { allocations: [ALLOC('a1', 'B3', 1710), ALLOC('a2', 'B7', 2500)] };
    case 'outageList': return { outages: [OUTAGE('o1', 'critical', null), OUTAGE('o2', 'minor', 1_770_003_600), OUTAGE('o3', 'major', null)] };
    case 'towerSave': return { tower: TOWER('t3') };
    case 'towerDelete': case 'spectrumDelete': case 'outageDelete': return { removed: 1 };
    case 'propagationModel': return { model: 'COST-231 Hata', totalCoverageKm2: 42.5, assumptions: { rxSensitivityDbm: -105, mobileHeightM: 1.5, fadeMarginDb: 8 }, cells: [{ id: 't1', name: 'Tower t1', lat: 40.7, lon: -74, terrain: 'urban', freqMhz: 1800, eirpDbm: 58, linkBudgetDb: 140, effectiveRangeKm: 3.2, coverageKm2: 32.1, edgeRsrpDbm: -105, edgeQuality: 'good' }, { id: 't2', name: 'Tower t2', lat: 40.8, lon: -74, terrain: 'rural', freqMhz: 700, eirpDbm: 60, linkBudgetDb: 150, effectiveRangeKm: 9, coverageKm2: 10.4, edgeRsrpDbm: -108, edgeQuality: 'weak' }] };
    case 'interferenceAnalysis': return { pairsAnalyzed: 1, overlappingPairs: 1, coChannelConflicts: 1, worstCiDb: 4.2, recommendation: 'Re-plan channels', conflicts: [{ towerA: 'Tower t1', towerB: 'Tower t2', separationKm: 2.1, overlapKm2: 5.5, overlapPercent: 22, coChannel: true, freqGapMhz: 0, ciDb: 4.2, severity: 'high' }] };
    case 'capacityProjection': return { horizonMonths: 12, targetUtilizationPercent: 70, breachMonth: 9, breachWarning: 'Utilisation breaches 70% in month 9', recommendedBandwidthGbps: 4, additionalGbps: 1.5, reason: null, series: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, subscribers: 1000 + i * 100, demandMbps: 200 + i * 30, utilizationPercent: 30 + i * 5, headroomPercent: 70 - i * 5 })) };
    case 'topology': return { tree: { id: 'core', label: 'Core', children: [{ id: 'hub', label: 'Hub', children: [{ id: 't1', label: 'Tower t1' }] }] }, towerCount: 2, aggregationHubs: 1, totalBackhaulGbps: 3.2, satelliteHops: 1, links: [{ from: 't1', to: 'hub', kind: 'fiber', latencyMs: 2, demandGbps: 1.1 }, { from: 't2', to: 'hub', kind: 'satellite', latencyMs: 600 }] };
    case 'spectrumAllocate': return { allocation: ALLOC('a3', 'B1', 2100) };
    case 'spectrumPlan': return { allocations: [ALLOC('a1', 'B3', 1710)], totalAllocatedMhz: 40, spectralSpanMhz: 810, utilizationPercent: 4.9, gaps: [{ afterBand: 'B3', beforeBand: 'B7', startMhz: 1730, widthMhz: 770 }], guardBandViolations: [{ bandA: 'B3', bandB: 'B1', actualGapMhz: 2, requiredGuardMhz: 5 }], byTechnology: [{ technology: 'LTE', mhz: 40 }] };
    case 'outageReport': return { outage: OUTAGE('o9', 'major', null) };
    case 'outageResolve': return { outage: OUTAGE('o1', 'critical', 1_770_007_200) };
    case 'slaReport': return { windowDays: 30, slaTargetPercent: 99.9, availabilityPercent: 99.5, downtimeHours: 3.6, openDowntimeHours: 1.2, incidents: 3, openIncidents: 2, mttrHours: 1.8, slaMet: false, breachBudgetHours: 0.7, bySeverity: [{ severity: 'critical', count: 1 }, { severity: 'minor', count: 2 }] };
    case 'driveTestImport': return { imported: 3, skipped: 1, total: 4 };
    case 'driveTestValidate': return { sampleCount: 3, meanErrorDbm: -2.1, rmseDbm: 4.4, meanAbsErrorDbm: 3.3, calibrationOffsetDbm: 2.1, modelGrade: 'good', recommendation: 'Apply +2.1 dB offset', points: [{ id: 'p1', lat: 40.7, lon: -74, measuredDbm: -90, predictedDbm: -92, errorDbm: 2, server: 't1' }, { id: 'p2', lat: 40.71, lon: -74, measuredDbm: -100, predictedDbm: -98, errorDbm: -2, server: null }] };
    default: return {};
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/components/viz', () => ({
  ChartKit: ({ data }: { data?: unknown[] }) => <div>chart:{data?.length ?? 0}</div>,
  TimelineView: ({ events }: { events?: unknown[] }) => <div>timeline:{events?.length ?? 0}</div>,
  TreeDiagram: ({ root }: { root?: { label?: string } }) => <div>tree:{root?.label}</div>,
  MapView: ({ markers }: { markers?: unknown[] }) => <div>map:{markers?.length ?? 0}</div>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const TABS = ['Sites', 'RF Coverage', 'Interference', 'Capacity Plan', 'Topology', 'Spectrum', 'Outages / SLA', 'Drive Test'];
const tabRe = /^(Sites|RF Coverage|Interference|Capacity Plan|Topology|Spectrum|Outages \/ SLA|Drive Test)$/;
const goTab = async (name: string) => { const b = screen.getAllByRole('button').find((x) => (x.textContent || '').trim() === name); if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 20)); }); };
const mount = async (props: Record<string, unknown> = {}) => { const { RFPlanner } = await import('../RFPlanner'); const v = render(<RFPlanner {...props} />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
});

describe('RFPlanner', () => {
  it('walks every sub-tab and runs each analysis', { timeout: 120000 }, async () => {
    const onChanged = vi.fn();
    const v = await mount({ onDataChanged: onChanged });
    expect(sent()).toEqual(expect.arrayContaining(['towerList', 'spectrumList', 'outageList']));
    for (const t of TABS) {
      await goTab(t);
      await exercise({ passes: 1, text: '12', skip: new RegExp(`${tabRe.source}|delete|remove|trash|discard|cancel|close|dismiss|clear|^×$`, 'i') });
      await settle();
    }
    const calls = sent();
    for (const a of ['propagationModel', 'interferenceAnalysis', 'capacityProjection', 'topology', 'spectrumPlan', 'slaReport']) expect(calls).toContain(a);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('manages sites, spectrum and outages including deletes', { timeout: 120000 }, async () => {
    const v = await mount();
    for (const t of ['Sites', 'Spectrum', 'Outages / SLA']) {
      await goTab(t);
      await exercise({ passes: 1, text: 'x', skip: new RegExp(`${tabRe.source}|cancel|close|dismiss|clear|^×$`, 'i') });
      await settle();
    }
    expect(sent().some((x) => /Delete$/.test(x))).toBe(true);
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });

  it('works as a controlled component and surfaces failures', { timeout: 60000 }, async () => {
    const onTab = vi.fn();
    const v = await mount({ tab: 'propagation', onTabChange: onTab });
    await goTab('Interference');
    expect(onTab).toHaveBeenCalledWith('interference');
    cleanup();
    lensRunMock.mockImplementation(async (...a: unknown[]) => {
      if (actionOf(a) === 'towerList') return { data: { ok: false, error: 'tower store offline' } };
      if (actionOf(a) === 'spectrumList') throw new Error('spectrum exploded');
      return { data: { ok: true, result: null } };
    });
    const bad = await mount();
    expect(bad.container.textContent).toMatch(/spectrum exploded|outageList failed|tower store offline/);
    for (const t of TABS) { await goTab(t); await exercise({ passes: 1, text: '5', skip: new RegExp(`${tabRe.source}|delete|remove|cancel|close|^×$`, 'i') }); }
  });
});
