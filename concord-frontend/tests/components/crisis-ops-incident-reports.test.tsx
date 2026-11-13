import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { IncidentReportPanel } from '@/components/crisis-ops/IncidentReportPanel';

// FIX-crisis-ops-002 pins: the per-crisis Incident reports list scopes by
// crisisId, but a report filed without a crisis (from the all-reports view,
// or before a crisis was selected) must not silently vanish — triage lists
// it, so the per-crisis view lists it too, in its own labelled group, with
// an attach action. Reports of OTHER crises never render.

const updateSpy = vi.fn(async () => ({}));
const createSpy = vi.fn(async () => ({}));
const removeSpy = vi.fn(async () => ({}));
let mockItems: Array<Record<string, unknown>> = [];

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: mockItems,
    isLoading: false,
    isError: false,
    create: createSpy,
    update: updateSpy,
    remove: removeSpy,
  }),
}));

const MINE = {
  id: 'rep-mine',
  title: 'Sitrep — north gate',
  data: { crisisId: 'cr_1', severity: 'major', body: 'Gate secured.' },
  meta: { status: 'major', tags: ['incident_report', 'crisis:cr_1'] },
};
const OTHER = {
  id: 'rep-other',
  title: 'Sitrep — south pier',
  data: { crisisId: 'cr_2', severity: 'minor', body: 'Pier report.' },
  meta: { status: 'minor', tags: ['incident_report', 'crisis:cr_2'] },
};
const UNSCOPED = {
  id: 'rep-free',
  title: 'Sitrep — filed first',
  data: { severity: 'minor', body: 'Filed before any crisis was selected.' },
  meta: { status: 'minor', tags: ['incident_report'] },
};

describe('IncidentReportPanel per-crisis scoping (FIX-crisis-ops-002)', () => {
  beforeEach(() => {
    updateSpy.mockClear();
    mockItems = [MINE, OTHER, UNSCOPED];
  });

  it('lists this crisis\'s report and the unscoped one in its group; the other crisis\'s report never renders', () => {
    render(<IncidentReportPanel crisisId="cr_1" />);
    expect(screen.getByText('Sitrep — north gate')).toBeInTheDocument();
    expect(screen.getByText('Sitrep — filed first')).toBeInTheDocument();
    expect(screen.getByText(/Filed without a crisis \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText('Sitrep — south pier')).not.toBeInTheDocument();
  });

  it('attach files the unscoped report against this crisis, re-sending the full record', async () => {
    render(<IncidentReportPanel crisisId="cr_1" />);
    fireEvent.click(screen.getByRole('button', { name: /Attach report Sitrep — filed first to this crisis/i }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const [id, input] = updateSpy.mock.calls[0] as unknown as [string, { data: Record<string, unknown>; meta: { tags: string[] } }];
    expect(id).toBe('rep-free');
    expect(input.data.crisisId).toBe('cr_1');
    expect(input.data.body).toBe('Filed before any crisis was selected.');
    expect(input.data.severity).toBe('minor');
    expect(input.meta.tags).toContain('crisis:cr_1');
    expect(input.meta.tags).toContain('incident_report');
  });

  it('with only an unscoped report, the empty state says so instead of claiming none were filed', () => {
    mockItems = [UNSCOPED];
    render(<IncidentReportPanel crisisId="cr_1" />);
    expect(screen.getByText(/No incident reports filed for this crisis yet — 1 report filed without a crisis is listed below\./)).toBeInTheDocument();
    expect(screen.getByText('Sitrep — filed first')).toBeInTheDocument();
  });

  it('without a selected crisis, every report renders with no unscoped group', () => {
    render(<IncidentReportPanel />);
    expect(screen.getByText('Sitrep — north gate')).toBeInTheDocument();
    expect(screen.getByText('Sitrep — south pier')).toBeInTheDocument();
    expect(screen.getByText('Sitrep — filed first')).toBeInTheDocument();
    expect(screen.queryByText(/Filed without a crisis/)).not.toBeInTheDocument();
  });
});
