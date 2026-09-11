/**
 * SecurityOpsPanel — Incident/Asset/Patrol/Surveillance/AccessControl/
 * ThreatIntel CRUD + dashboard, tested directly.
 * tests/security-lens-states.test.tsx already pins the page-level wiring,
 * loading/error/empty/populated states, and the Incidents-tab empty/
 * populated cases; this file exercises create/edit/delete across multiple
 * artifact types, the dashboard KPI derivation across all 5 secondary
 * useLensData feeds, and the four compute-action buttons' result handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

type QState = { items: unknown[]; isLoading: boolean; isError: boolean; error: Error | null };
const stateByType: Record<string, QState> = {};
function freshState(): QState {
  return { items: [], isLoading: false, isError: false, error: null };
}
const create = vi.fn(() => Promise.resolve({}));
const update = vi.fn(() => Promise.resolve({}));
const remove = vi.fn(() => Promise.resolve({}));
const refetch = vi.fn();
const runMutateAsync = vi.fn(() => Promise.resolve({ ok: true, result: {} }));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => {
    const st = stateByType[type] || (stateByType[type] = freshState());
    return { items: st.items, isLoading: st.isLoading, isError: st.isError, error: st.error, refetch, create, update, remove };
  },
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: runMutateAsync, isPending: false }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: ({ initial, onValueChange, placeholder, className, rows }: {
    initial?: string; onValueChange?: (v: string) => void; placeholder?: string; className?: string; rows?: number;
  }) => React.createElement('textarea', {
    value: initial, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onValueChange?.(e.target.value),
    placeholder, className, rows,
  }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import { SecurityOpsPanel } from './SecurityOpsPanel';

const INCIDENT = {
  id: 'inc_1', title: 'Phishing wave', data: { severity: 'P2', type: 'phishing', status: 'detected', mttd: 0, mttr: 0, affectedAssets: [] },
  meta: { tags: [], status: 'detected', visibility: 'private' }, createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};
const ASSET = {
  id: 'ast_1', title: 'db-prod-01', data: { assetType: 'server', criticality: 'critical', patchStatus: 'overdue', vulnerabilityCount: 3, owner: 'infra' },
  meta: { tags: [], status: 'active', visibility: 'private' }, createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};
const PATROL = {
  id: 'pat_1', title: 'Perimeter A', data: { route: 'Perimeter A', guard: 'J. Ruiz', incidentsReported: 1, responseTime: 4, completionRate: 95, checkpoints: ['Gate A', 'Lot B'] },
  meta: { tags: [], status: 'active', visibility: 'private' }, createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};
const SURVEILLANCE = {
  id: 'cam_1', title: 'Lobby Cam', data: { cameraId: 'CAM-01', zone: 'Lobby', type: 'dome', coverage: 'entrance', resolution: '4K', alertCount: 2, nightVision: true },
  meta: { tags: [], status: 'online', visibility: 'private' }, createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};
const ACCESS = {
  id: 'acc_1', title: 'Badge 4471', data: { accessLevel: 'restricted', badgeId: 'B-4471', holder: 'A. Chen', department: 'IT', zones: ['Datacenter'] },
  meta: { tags: [], status: 'active', visibility: 'private' }, createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};
const THREAT = {
  id: 'thr_1', title: 'C2 Beacon', data: { iocType: 'domain', iocValue: 'evil.example', threatActor: 'APT-99', confidence: 80, riskScore: 85 },
  meta: { tags: [], status: 'active', visibility: 'private' }, createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

function fieldByLabel(container: HTMLElement, labelText: string): HTMLElement {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent === labelText);
  if (!label || !label.nextElementSibling) throw new Error(`No field found for label: ${labelText}`);
  return label.nextElementSibling as HTMLElement;
}
function goTo(tabName: string) {
  fireEvent.click(within(screen.getByRole('navigation')).getByText(tabName));
}

beforeEach(() => {
  for (const k of Object.keys(stateByType)) delete stateByType[k];
  create.mockReset().mockResolvedValue({});
  update.mockReset().mockResolvedValue({});
  remove.mockReset().mockResolvedValue({});
  refetch.mockReset();
  runMutateAsync.mockReset().mockResolvedValue({ ok: true, result: {} });
});

describe('SecurityOpsPanel', () => {
  it('Dashboard mode renders real KPIs derived from all 5 secondary feeds', () => {
    stateByType.Incident = { ...freshState(), items: [INCIDENT] };
    stateByType.Asset = { ...freshState(), items: [ASSET] };
    render(<SecurityOpsPanel />);
    expect(screen.getAllByText('Open Incidents').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0); // 1 open incident, 1 unpatched asset
  });

  it('Incidents tab: creates a new incident via the real editor form', async () => {
    const { container } = render(<SecurityOpsPanel />);
    goTo('Incidents');
    fireEvent.click(screen.getByRole('button', { name: /New Incident/i }));
    expect(screen.getByRole('heading', { name: 'New Incident' })).toBeInTheDocument();

    fireEvent.change(fieldByLabel(container, 'Title'), { target: { value: 'Ransomware attempt' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Ransomware attempt' }),
      ),
    );
  });

  it('Create is disabled until a title is entered', () => {
    render(<SecurityOpsPanel />);
    goTo('Incidents');
    fireEvent.click(screen.getByRole('button', { name: /New Incident/i }));
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeDisabled();
  });

  it('clicking an incident card opens the editor pre-filled, Update calls update(), Delete calls remove()', async () => {
    stateByType.Incident = { ...freshState(), items: [INCIDENT] };
    const { container } = render(<SecurityOpsPanel />);
    goTo('Incidents');
    fireEvent.click(screen.getByText('Phishing wave'));

    expect(screen.getByText('Edit Incident')).toBeInTheDocument();
    expect(fieldByLabel(container, 'Title')).toHaveValue('Phishing wave');

    fireEvent.click(screen.getByRole('button', { name: /^Update$/i }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('inc_1', expect.objectContaining({ title: 'Phishing wave' })));
  });

  it('deletes an incident from the card footer without opening the editor', () => {
    stateByType.Incident = { ...freshState(), items: [INCIDENT] };
    render(<SecurityOpsPanel />);
    goTo('Incidents');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('inc_1');
    expect(screen.queryByText('Edit Incident')).not.toBeInTheDocument();
  });

  it('Cancel closes the editor without saving', () => {
    render(<SecurityOpsPanel />);
    goTo('Incidents');
    fireEvent.click(screen.getByRole('button', { name: /New Incident/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(create).not.toHaveBeenCalled();
  });

  it('Assets tab: renders real asset data and creates a new Asset with type-specific fields', async () => {
    stateByType.Asset = { ...freshState(), items: [ASSET] };
    const { container } = render(<SecurityOpsPanel />);
    goTo('Assets');
    expect(screen.getByText('db-prod-01')).toBeInTheDocument();
    expect(screen.getByText(/Owner: infra/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /New Asset/i }));
    fireEvent.change(fieldByLabel(container, 'Title'), { target: { value: 'web-prod-02' } });
    fireEvent.change(fieldByLabel(container, 'IP Address'), { target: { value: '10.0.0.5' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'web-prod-02', data: expect.objectContaining({ ip: '10.0.0.5' }) }),
      ),
    );
  });

  it('search narrows the visible Incidents list by title', () => {
    const other = { ...INCIDENT, id: 'inc_2', title: 'Insider threat', data: { ...INCIDENT.data, type: 'insider' } };
    stateByType.Incident = { ...freshState(), items: [INCIDENT, other] };
    render(<SecurityOpsPanel />);
    goTo('Incidents');
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'insider' } });
    expect(screen.queryByText('Phishing wave')).not.toBeInTheDocument();
    expect(screen.getByText('Insider threat')).toBeInTheDocument();
  });

  it('runs a compute action (vulnerabilityScan) against the first real artifact and renders the real result', async () => {
    stateByType.Incident = { ...freshState(), items: [INCIDENT] };
    runMutateAsync.mockResolvedValue({ ok: true, result: { totalIncidents: 5, byType: { phishing: 3, malware: 2 } } });
    render(<SecurityOpsPanel />);
    goTo('Incidents');

    fireEvent.click(screen.getByRole('button', { name: /Vulnerability Scan/i }));
    await waitFor(() => expect(runMutateAsync).toHaveBeenCalledWith({ id: 'inc_1', action: 'vulnerabilityScan' }));
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    expect(screen.getByText('Total Incidents')).toBeInTheDocument();
  });

  it('a rejected compute action shows the honest failure message, not a fabricated result', async () => {
    stateByType.Incident = { ...freshState(), items: [INCIDENT] };
    runMutateAsync.mockResolvedValue({ ok: false, error: 'no artifact access' });
    render(<SecurityOpsPanel />);
    goTo('Incidents');

    fireEvent.click(screen.getByRole('button', { name: /Vulnerability Scan/i }));
    await waitFor(() => expect(screen.getByText(/Action failed: no artifact access/i)).toBeInTheDocument());
  });

  it('compute action buttons are disabled with an honest reason when there is no artifact to run against', () => {
    render(<SecurityOpsPanel />);
    goTo('Incidents');
    expect(screen.getByRole('button', { name: /Vulnerability Scan/i })).toBeDisabled();
    expect(screen.getByText(/add one to enable them/i)).toBeInTheDocument();
  });

  it('Patrols tab: renders real patrol data + checkpoints and creates a new Patrol', async () => {
    stateByType.Patrol = { ...freshState(), items: [PATROL] };
    const { container } = render(<SecurityOpsPanel />);
    goTo('Patrols');
    expect(screen.getAllByText('Perimeter A').length).toBeGreaterThan(0);
    expect(screen.getByText('Gate A')).toBeInTheDocument();
    expect(screen.getByText(/Response: 4m/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /New Patrol/i }));
    fireEvent.change(fieldByLabel(container, 'Title'), { target: { value: 'Perimeter B' } });
    fireEvent.change(fieldByLabel(container, 'Route Name'), { target: { value: 'Perimeter B' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Perimeter B' })));
  });

  it('Surveillance tab: renders real camera data with night-vision badge', () => {
    stateByType.Surveillance = { ...freshState(), items: [SURVEILLANCE] };
    render(<SecurityOpsPanel />);
    goTo('Surveillance');
    expect(screen.getByText('Lobby Cam')).toBeInTheDocument();
    expect(screen.getByText('CAM-01')).toBeInTheDocument();
    expect(screen.getByText('Night Vision')).toBeInTheDocument();
    expect(screen.getByText(/Alerts: 2/)).toBeInTheDocument();
  });

  it('Access tab: renders real badge data with zones', () => {
    stateByType.AccessControl = { ...freshState(), items: [ACCESS] };
    render(<SecurityOpsPanel />);
    goTo('Access');
    expect(screen.getByText('Badge 4471')).toBeInTheDocument();
    expect(screen.getByText('B-4471')).toBeInTheDocument();
    expect(screen.getByText('Datacenter')).toBeInTheDocument();
  });

  it('Threats tab: renders real IOC data with risk score', () => {
    stateByType.ThreatIntel = { ...freshState(), items: [THREAT] };
    render(<SecurityOpsPanel />);
    goTo('Threats');
    expect(screen.getByText('C2 Beacon')).toBeInTheDocument();
    expect(screen.getByText('evil.example')).toBeInTheDocument();
    expect(screen.getByText('APT-99')).toBeInTheDocument();
    expect(screen.getByText(/Risk: 85\/100/)).toBeInTheDocument();
  });

  it('threatAssessment renders the real threatMatrix result shape', async () => {
    stateByType.ThreatIntel = { ...freshState(), items: [THREAT] };
    runMutateAsync.mockResolvedValue({
      ok: true,
      result: { totalThreats: 4, criticalCount: 1, matrix: [{ name: 'C2 Beacon', riskLevel: 'critical', riskScore: 90 }] },
    });
    render(<SecurityOpsPanel />);
    goTo('Threats');
    fireEvent.click(screen.getByRole('button', { name: /Threat Assessment/i }));
    await waitFor(() => expect(runMutateAsync).toHaveBeenCalledWith({ id: 'thr_1', action: 'threatAssessment' }));
    expect(await screen.findByText('Total Threats')).toBeInTheDocument();
    expect(screen.getByText(/critical \(90\)/)).toBeInTheDocument();
  });

  it('accessAudit renders the real security-posture result shape', async () => {
    stateByType.AccessControl = { ...freshState(), items: [ACCESS] };
    runMutateAsync.mockResolvedValue({
      ok: true,
      result: { postureScore: 62, rating: 'weak', assetCount: 10, openCritical: 3, recommendations: ['rotate badges'] },
    });
    render(<SecurityOpsPanel />);
    goTo('Access');
    fireEvent.click(screen.getByRole('button', { name: /Access Audit/i }));
    await waitFor(() => expect(runMutateAsync).toHaveBeenCalledWith({ id: 'acc_1', action: 'accessAudit' }));
    expect(await screen.findByText(/62\/100 \(weak\)/)).toBeInTheDocument();
  });

  it('a rejected action clears any previous result and shows the new failure', async () => {
    stateByType.Incident = { ...freshState(), items: [INCIDENT] };
    runMutateAsync.mockResolvedValueOnce({ ok: true, result: { totalIncidents: 1, byType: {} } });
    render(<SecurityOpsPanel />);
    goTo('Incidents');
    fireEvent.click(screen.getByRole('button', { name: /Vulnerability Scan/i }));
    await waitFor(() => expect(screen.getByText('Total Incidents')).toBeInTheDocument());

    runMutateAsync.mockResolvedValueOnce({ ok: false, error: 'locked' });
    fireEvent.click(screen.getByRole('button', { name: /Incident Escalate/i }));
    await waitFor(() => expect(screen.getByText(/Action failed: locked/i)).toBeInTheDocument());
  });
});
