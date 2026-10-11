import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';

const persist = vi.fn();
const restore = vi.fn(() => null);
const deskProps = vi.fn();

vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore, persist }),
}));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/electrical/ElectricalDeskPanel', () => ({
  ElectricalDeskPanel: (props: { mode: string; createOnMount?: boolean }) => {
    deskProps(props);
    return <div data-testid={`desk-${props.mode}`} />;
  },
}));
vi.mock('@/components/electrical/PanelScheduleBuilder', () => ({ PanelScheduleBuilder: () => <div data-testid="panel-tool" /> }));
vi.mock('@/components/electrical/NecCalculators', () => ({ NecCalculators: () => <div data-testid="size-tool" /> }));
vi.mock('@/components/electrical/NecCodeCalc', () => ({ NecCodeCalc: () => <div data-testid="nec-tool" /> }));
vi.mock('@/components/electrical/EstimateInvoiceFlow', () => ({ EstimateInvoiceFlow: () => <div data-testid="estimate-tool" /> }));
vi.mock('@/components/electrical/OneLineDiagram', () => ({ OneLineDiagram: () => <div data-testid="diagram-tool" /> }));
vi.mock('@/components/electrical/InspectionChecklists', () => ({ InspectionChecklists: () => <div data-testid="inspect-tool" /> }));
vi.mock('@/components/electrical/MaterialPriceList', () => ({ MaterialPriceList: () => <div data-testid="materials-tool" /> }));
vi.mock('@/components/electrical/OpenHardwarePulse', () => ({ OpenHardwarePulse: () => <div data-testid="hardware-tool" /> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>,
  }),
}));

import ElectricalLensPage from '@/app/lenses/electrical/page';

beforeEach(() => {
  persist.mockReset();
  restore.mockReset();
  restore.mockReturnValue(null);
  deskProps.mockReset();
});

describe('Electrical north-star workspace', () => {
  it('matches the concept with one empty job and one primary action', () => {
    const { getByText, queryByRole } = render(<ElectricalLensPage />);
    expect(getByText('The job, Ramaj')).toBeInTheDocument();
    expect(getByText('No job open.')).toBeInTheDocument();
    expect(getByText('+ New job')).toBeInTheDocument();
    expect(queryByRole('navigation', { name: 'Electrical job tools' })).toBeNull();
  });

  it('opens NEC calculators from the empty desk without a job', () => {
    const { getByRole, getByTestId } = render(<ElectricalLensPage />);
    fireEvent.click(getByRole('button', { name: 'NEC Calculators' }));
    expect(getByTestId('size-tool')).toBeInTheDocument();
    expect(persist).toHaveBeenCalledWith({ opened: true, tool: 'calculators' });
  });

  it('opens the real Job editor from + New job and persists workspace state', () => {
    const { getByText, getByTestId } = render(<ElectricalLensPage />);
    fireEvent.click(getByText('+ New job'));
    expect(getByTestId('desk-jobs')).toBeInTheDocument();
    expect(deskProps).toHaveBeenLastCalledWith({ mode: 'jobs', createOnMount: true });
    expect(persist).toHaveBeenCalledWith({ opened: true, tool: 'jobs' });
  });

  it('restores the last tool without fabricating a new job', () => {
    restore.mockReturnValue({ opened: true, tool: 'panels' });
    const { getByTestId } = render(<ElectricalLensPage />);
    expect(getByTestId('panel-tool')).toBeInTheDocument();
    expect(deskProps).not.toHaveBeenCalled();
  });

  it('keeps every real product capability behind one tool navigation model', () => {
    restore.mockReturnValue({ opened: true, tool: 'jobs' });
    const { getByText, getByTestId } = render(<ElectricalLensPage />);

    const tools: [string, string][] = [
      ['Panel', 'panel-tool'],
      ['Size', 'size-tool'],
      ['NEC', 'nec-tool'],
      ['Estimate', 'estimate-tool'],
      ['One-line', 'diagram-tool'],
      ['Inspect', 'inspect-tool'],
      ['Materials', 'materials-tool'],
      ['Code notes', 'desk-codes'],
      ['CRM', 'desk-clients'],
      ['Certs', 'desk-certs'],
      ['Hardware', 'hardware-tool'],
    ];
    for (const [label, testId] of tools) {
      fireEvent.click(getByText(label));
      expect(getByTestId(testId)).toBeInTheDocument();
    }
    expect(persist).toHaveBeenLastCalledWith({ opened: true, tool: 'hardware' });
  });
});
