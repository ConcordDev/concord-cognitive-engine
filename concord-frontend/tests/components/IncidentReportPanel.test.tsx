/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the desert infrastructure/hazard incident reporting panel (Wave 4
// gap-closure, docs/lens-specs/desert-capability-map.md "Genuinely missing,
// deferred" #2) against the real desert.incident* macro contract: create,
// the status lifecycle (open -> investigating -> resolved with a required
// resolution note, and a resolved incident's explicit reopen gate), delete,
// and the nearby proximity query with its open/critical aggregation.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { IncidentReportPanel } from '@/components/desert/IncidentReportPanel';

const INCIDENT = {
  id: 'incident_1',
  category: 'washed_out_crossing',
  severity: 'high',
  description: 'Culvert washed out after flash flood.',
  lat: 10,
  lng: 20,
  status: 'open' as const,
  reportedAt: '2026-07-14T00:00:00.000Z',
  resolvedAt: null,
  resolutionNotes: '',
  statusHistory: [{ from: null, to: 'open', at: '2026-07-14T00:00:00.000Z' }],
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

function listResponse(incidents: Array<Record<string, unknown>> = []) {
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const i of incidents) {
    byStatus[i.status as string] = (byStatus[i.status as string] || 0) + 1;
    bySeverity[i.severity as string] = (bySeverity[i.severity as string] || 0) + 1;
  }
  return { data: { ok: true, result: { incidents, count: incidents.length, byStatus, bySeverity } } };
}

describe('IncidentReportPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via incidentList and renders the incident row', async () => {
    lensRun.mockResolvedValueOnce(listResponse([INCIDENT]));
    render(<IncidentReportPanel />);

    expect(await screen.findByText('Culvert washed out after flash flood.')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('desert', 'incidentList', {});
  });

  it('an empty book renders an honest empty state, not a fabricated incident', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<IncidentReportPanel />);
    await waitFor(() => expect(screen.getByText(/No incidents on file/)).toBeInTheDocument());
  });

  it('file report calls incidentReport with the typed category/severity/description/coords and refreshes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { ...INCIDENT, id: 'incident_new', description: 'Downed line across trail.' } } })
      .mockResolvedValueOnce(listResponse([{ ...INCIDENT, id: 'incident_new', description: 'Downed line across trail.' }]));

    render(<IncidentReportPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'downed_power_line' } });
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    fireEvent.change(screen.getByPlaceholderText('lat'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('lng'), { target: { value: '6' } });
    fireEvent.change(screen.getByPlaceholderText(/Describe the incident/), { target: { value: 'Downed line across trail.' } });
    fireEvent.click(screen.getByText('File incident report'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('desert', 'incidentReport', {
        category: 'downed_power_line',
        severity: 'critical',
        description: 'Downed line across trail.',
        lat: 5,
        lng: 6,
      }),
    );
    expect(await screen.findByText('Downed line across trail.')).toBeInTheDocument();
  });

  it('rejects filing without a description (client-side honesty check, no macro call)', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<IncidentReportPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('lat'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('lng'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('File incident report'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Description is required');
    expect(lensRun).toHaveBeenCalledTimes(1); // no incidentReport call fired
  });

  it('selecting an open incident and marking investigating drives incidentUpdateStatus', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([INCIDENT]))
      .mockResolvedValueOnce({ data: { ok: true, result: { incident: { ...INCIDENT, status: 'investigating' }, moved: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...INCIDENT, status: 'investigating' }]));

    render(<IncidentReportPanel />);
    fireEvent.click(await screen.findByText('Culvert washed out after flash flood.'));

    fireEvent.click(screen.getByText('Mark investigating'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('desert', 'incidentUpdateStatus', {
        id: 'incident_1',
        status: 'investigating',
        reopen: undefined,
        resolutionNotes: undefined,
      }),
    );
  });

  it('Resolve is disabled until resolution notes are typed, then calls incidentUpdateStatus with the notes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([{ ...INCIDENT, status: 'investigating' }]))
      .mockResolvedValueOnce({ data: { ok: true, result: { incident: { ...INCIDENT, status: 'resolved', resolutionNotes: 'Rebuilt the crossing.' }, moved: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...INCIDENT, status: 'resolved', resolutionNotes: 'Rebuilt the crossing.' }]));

    render(<IncidentReportPanel />);
    fireEvent.click(await screen.findByText('Culvert washed out after flash flood.'));

    const resolveBtn = screen.getByText('Resolve');
    expect(resolveBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Resolution notes (required to resolve)'), { target: { value: 'Rebuilt the crossing.' } });
    expect(resolveBtn).not.toBeDisabled();
    fireEvent.click(resolveBtn);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('desert', 'incidentUpdateStatus', {
        id: 'incident_1',
        status: 'resolved',
        reopen: undefined,
        resolutionNotes: 'Rebuilt the crossing.',
      }),
    );
  });

  it('a resolved incident shows a Reopen action that passes reopen: true', async () => {
    const resolved = { ...INCIDENT, status: 'resolved' as const, resolutionNotes: 'Rebuilt the crossing.', resolvedAt: '2026-07-15T00:00:00.000Z' };
    lensRun
      .mockResolvedValueOnce(listResponse([resolved]))
      .mockResolvedValueOnce({ data: { ok: true, result: { incident: { ...resolved, status: 'open', resolvedAt: null }, moved: {} } } })
      .mockResolvedValueOnce(listResponse([{ ...resolved, status: 'open', resolvedAt: null }]));

    render(<IncidentReportPanel />);
    fireEvent.click(await screen.findByText('Culvert washed out after flash flood.'));

    expect(screen.getByText(/Resolved: Rebuilt the crossing\./)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reopen'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('desert', 'incidentUpdateStatus', {
        id: 'incident_1',
        status: 'open',
        reopen: true,
        resolutionNotes: undefined,
      }),
    );
  });

  it('delete calls incidentDelete and refreshes the list', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([INCIDENT]))
      .mockResolvedValueOnce({ data: { ok: true, result: { deleted: 'incident_1' } } })
      .mockResolvedValueOnce(listResponse([]));

    render(<IncidentReportPanel />);
    await screen.findByText('Culvert washed out after flash flood.');

    fireEvent.click(screen.getByLabelText('Delete incident incident_1'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('desert', 'incidentDelete', { id: 'incident_1' }));
    await waitFor(() => expect(screen.getByText(/No incidents on file/)).toBeInTheDocument());
  });

  it('nearby search calls incidentsNearby and prominently renders openCount/criticalCount', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: { incidents: [{ ...INCIDENT, distanceKm: 2.1 }], count: 1, openCount: 1, criticalCount: 1 },
        },
      });

    render(<IncidentReportPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('search lat'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('search lng'), { target: { value: '20' } });
    fireEvent.click(screen.getByText('Find'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('desert', 'incidentsNearby', { lat: 10, lng: 20, radiusKm: 100 }),
    );
    expect(await screen.findByText('2.1 km')).toBeInTheDocument();
    expect(screen.getByText('Open nearby')).toBeInTheDocument();
    expect(screen.getByText(/Critical/)).toBeInTheDocument();
  });

  it('surfaces an honest error on a failed load instead of a silent blank panel', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    render(<IncidentReportPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('STATE unavailable');
  });
});
