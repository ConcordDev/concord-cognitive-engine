/**
 * SLICE B7 — FIX-defense-003: Missions, Map, Threats, Logistics and
 * Communications Log records gain in-place Edit controls wired to the
 * update verbs (mission-task-update / cop-update / threat-update /
 * supply-update / comms-update).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({
  TimelineView: () => <div data-testid="timeline" />,
  MapView: () => <div data-testid="map" />,
}));

import { MissionPlanner } from '@/components/defense/MissionPlanner';
import { CommonOperatingPicture } from '@/components/defense/CommonOperatingPicture';
import { ThreatBoard } from '@/components/defense/ThreatBoard';
import { LogisticsBoard } from '@/components/defense/LogisticsBoard';
import { CommsLog } from '@/components/defense/CommsLog';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (_d: string, action: string) => {
    if (action === 'mission-plan') return ok({
      tasks: [{ id: 't1', name: 'Breach the wall', phase: 'shaping', owner: '', status: 'pending', durationHours: 24, dependsOn: [], startOffset: 0, earliestStart: 0, finish: 24 }],
      phases: [], criticalPath: [], blocked: [], totalDurationHours: 24, completionPct: 0,
    });
    if (action === 'cop-map') return ok({
      markers: [{ id: 'cop_1', kind: 'operation', label: 'FOB Alpha', lat: 10, lon: 20, affiliation: 'friendly', note: '' }],
      byKind: {}, totals: { asset: 0, threat: 0, operation: 1 }, unmapped: { assets: [], threats: [] },
    });
    if (action === 'threat-board') return ok({
      threats: [{ id: 'th1', name: 'Unknown patrol', category: 'ground', severity: 'low', status: 'watching', region: 'North', note: '', history: [{ at: '', event: 'added', severity: 'low' }] }],
      total: 1, bySeverity: {}, byStatus: {}, highestSeverity: 'low', activeWatch: 1,
    });
    if (action === 'supply-board') return ok({
      requests: [{ id: 's1', item: 'Fuel', quantity: 10, category: 'fuel', priority: 'routine', status: 'requested', destination: '', requestedBy: '', history: [] }],
      total: 1, byStatus: { requested: 1, in_transit: 0, delivered: 0, cancelled: 0 }, openCount: 1, fulfillmentPct: 0,
    });
    if (action === 'comms-log') return ok({
      messages: [{ id: 'm1', channel: 'ops', body: 'All quiet', classification: 'unclassified', precedence: 'routine', sender: 'HQ', acknowledged: false, postedAt: '2026-11-13T10:00:00Z' }],
      channels: ['ops'], total: 1, unacknowledged: 1,
    });
    return ok({});
  });
});

describe('FIX-defense-003 edit controls', () => {
  it('mission task edit saves name/phase/duration via mission-task-update', async () => {
    render(<MissionPlanner />);
    fireEvent.click(await screen.findByLabelText('Edit task Breach the wall'));
    fireEvent.change(await screen.findByLabelText('Edit task name'), { target: { value: 'Breach the east wall' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('mission-task-update')).toHaveLength(1));
    expect(calls('mission-task-update')[0][2]).toMatchObject({ id: 't1', name: 'Breach the east wall', durationHours: 24 });
  });

  it('COP marker edit saves via cop-update', async () => {
    render(<CommonOperatingPicture />);
    fireEvent.click(await screen.findByLabelText('Edit marker FOB Alpha'));
    fireEvent.change(await screen.findByLabelText('Edit marker label'), { target: { value: 'FOB Alpha North' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('cop-update')).toHaveLength(1));
    expect(calls('cop-update')[0][2]).toMatchObject({ id: 'cop_1', label: 'FOB Alpha North', lat: 10, lon: 20 });
  });

  it('threat edit saves via threat-update', async () => {
    render(<ThreatBoard />);
    fireEvent.click(await screen.findByLabelText('Edit threat Unknown patrol'));
    fireEvent.change(await screen.findByLabelText('Edit threat name'), { target: { value: 'Armored patrol' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('threat-update')).toHaveLength(1));
    expect(calls('threat-update')[0][2]).toMatchObject({ id: 'th1', name: 'Armored patrol' });
  });

  it('supply request edit saves via supply-update', async () => {
    render(<LogisticsBoard />);
    fireEvent.click(await screen.findByLabelText('Edit request Fuel'));
    fireEvent.change(await screen.findByLabelText('Edit request quantity'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('supply-update')).toHaveLength(1));
    expect(calls('supply-update')[0][2]).toMatchObject({ id: 's1', quantity: 25 });
  });

  it('comms entry edit saves via comms-update', async () => {
    render(<CommsLog />);
    fireEvent.click(await screen.findByLabelText('Edit message on ops'));
    fireEvent.change(await screen.findByLabelText('Edit message body'), { target: { value: 'Contact at grid 4' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('comms-update')).toHaveLength(1));
    expect(calls('comms-update')[0][2]).toMatchObject({ id: 'm1', body: 'Contact at grid 4' });
  });
});
