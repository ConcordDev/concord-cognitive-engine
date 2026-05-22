import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Stub every child panel so this suite exercises EpicSection's own routing,
// badge fetch and patient-detail logic in isolation. Each factory builds its
// own stub inline because vi.mock is hoisted above module-scope consts.
function makeStub(label: string) {
  return () => React.createElement('div', { 'data-testid': label }, label);
}

vi.mock('@/components/healthcare/EpicShell', () => ({
  EpicShell: ({ activeNav, onNavChange, badges, askBar, children }: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'epic-shell' },
      React.createElement('div', { 'data-testid': 'active-nav' }, String(activeNav)),
      React.createElement('div', { 'data-testid': 'badges' }, JSON.stringify(badges)),
      React.createElement('button', { onClick: () => (onNavChange as (n: string) => void)('patients') }, 'goto-patients'),
      React.createElement('button', { onClick: () => (onNavChange as (n: string) => void)('chart') }, 'goto-chart'),
      React.createElement('button', { onClick: () => (onNavChange as (n: string) => void)('orders') }, 'goto-orders'),
      React.createElement('button', { onClick: () => (onNavChange as (n: string) => void)('reports') }, 'goto-reports'),
      askBar as React.ReactNode,
      children as React.ReactNode,
    ),
}));
vi.mock('@/components/healthcare/EpicAskBar', () => ({ EpicAskBar: makeStub('EpicAskBar') }));
vi.mock('@/components/healthcare/HealthcareDashboard', () => ({
  HealthcareDashboard: ({ onJumpTo }: Record<string, unknown>) =>
    React.createElement('button', { 'data-testid': 'HealthcareDashboard', onClick: () => (onJumpTo as (n: string) => void)('inbox') }, 'HealthcareDashboard'),
}));
vi.mock('@/components/healthcare/PatientsPanel', () => ({
  PatientsPanel: ({ onSelect }: Record<string, unknown>) =>
    React.createElement('button', { 'data-testid': 'PatientsPanel', onClick: () => (onSelect as (id: string) => void)('p1') }, 'PatientsPanel'),
}));
vi.mock('@/components/healthcare/PatientChartPanel', () => ({ PatientChartPanel: makeStub('PatientChartPanel') }));
vi.mock('@/components/healthcare/EncountersPanel', () => ({ EncountersPanel: makeStub('EncountersPanel') }));
vi.mock('@/components/healthcare/OrdersPanel', () => ({ OrdersPanel: makeStub('OrdersPanel') }));
vi.mock('@/components/healthcare/CareManagementPanel', () => ({ CareManagementPanel: makeStub('CareManagementPanel') }));
vi.mock('@/components/healthcare/AIScribePanel', () => ({ AIScribePanel: makeStub('AIScribePanel') }));
vi.mock('@/components/healthcare/InboxPanel', () => ({ InboxPanel: makeStub('InboxPanel') }));
vi.mock('@/components/healthcare/RefillsPanel', () => ({ RefillsPanel: makeStub('RefillsPanel') }));
vi.mock('@/components/healthcare/SmartPhrasesPanel', () => ({ SmartPhrasesPanel: makeStub('SmartPhrasesPanel') }));
vi.mock('@/components/healthcare/CodeLookup', () => ({ CodeLookup: makeStub('CodeLookup') }));
vi.mock('@/components/healthcare/TelehealthPanel', () => ({ TelehealthPanel: makeStub('TelehealthPanel') }));
vi.mock('@/components/healthcare/ResultsReleasePanel', () => ({ ResultsReleasePanel: makeStub('ResultsReleasePanel') }));
vi.mock('@/components/healthcare/DeviceDataPanel', () => ({ DeviceDataPanel: makeStub('DeviceDataPanel') }));
vi.mock('@/components/healthcare/InsurancePanel', () => ({ InsurancePanel: makeStub('InsurancePanel') }));
vi.mock('@/components/healthcare/RecordSharingPanel', () => ({ RecordSharingPanel: makeStub('RecordSharingPanel') }));
vi.mock('@/components/healthcare/CdsOrderCheckPanel', () => ({ CdsOrderCheckPanel: makeStub('CdsOrderCheckPanel') }));

import { EpicSection } from '@/components/healthcare/EpicSection';

describe('EpicSection', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the dashboard by default and fetches badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {
      patientCount: 5, inboxUnread: 2, pendingRefills: 1, unsignedNotes: 3,
    } } });
    render(<EpicSection />);
    expect(screen.getByTestId('HealthcareDashboard')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('badges').textContent).toContain('"patients":5'));
  });

  it('navigates to the patients panel', () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<EpicSection />);
    fireEvent.click(screen.getByText('goto-patients'));
    expect(screen.getByTestId('PatientsPanel')).toBeInTheDocument();
  });

  it('shows the no-patient prompt for chart when no patient selected', () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<EpicSection />);
    fireEvent.click(screen.getByText('goto-chart'));
    expect(screen.getByText(/Pick a patient first/)).toBeInTheDocument();
  });

  it('selecting a patient routes to the chart and fetches patient detail', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'patients-detail') {
        return Promise.resolve({ data: { ok: true, result: { patient: { id: 'p1', firstName: 'Jane', lastName: 'Roe', mrn: 'MRN-1' } } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<EpicSection />);
    fireEvent.click(screen.getByText('goto-patients'));
    fireEvent.click(screen.getByTestId('PatientsPanel'));
    await waitFor(() => expect(screen.getByTestId('PatientChartPanel')).toBeInTheDocument());
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'patients-detail')).toBe(true));
  });

  it('jumps via the dashboard onJumpTo callback', () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<EpicSection />);
    fireEvent.click(screen.getByTestId('HealthcareDashboard'));
    expect(screen.getByTestId('InboxPanel')).toBeInTheDocument();
  });

  it('renders the reports hint tab', () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<EpicSection />);
    fireEvent.click(screen.getByText('goto-reports'));
    expect(screen.getByText(/Headline metrics live on the Dashboard/)).toBeInTheDocument();
  });

  it('tolerates a failed badge fetch', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<EpicSection />);
    // Component should still render; badges stay at the default {}.
    await waitFor(() => expect(screen.getByTestId('epic-shell')).toBeInTheDocument());
  });
});
