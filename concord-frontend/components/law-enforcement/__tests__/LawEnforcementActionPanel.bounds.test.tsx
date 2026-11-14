/**
 * Quick Analysis numeric bounds (FIX-law-enforcement-006).
 *
 * Patrol zone numbers and the suspect evidence-links count used to
 * flow unvalidated: negatives produced "Patrol -1/-1", a 1e9 crime
 * rate "needed 100000000 units", and the links count was expanded
 * into a real array of that length in the browser. The panel now
 * refuses out-of-range values by name before anything is sent (the
 * server refuses them too), and valid input still runs.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn(), items: [] }),
  useRecallableAction: () => ({ run: vi.fn(async (fn: () => Promise<unknown>) => fn()), recall: vi.fn(), state: null, armed: false, slot: null }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));

import { LawEnforcementActionPanel } from '../LawEnforcementActionPanel';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const macroCalls = () => runDomainMock.mock.calls.map((c) => c[1]);

beforeEach(() => {
  lensRunMock.mockReset(); runDomainMock.mockReset(); apiPost.mockReset();
  lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { ok: true }, error: null } }));
  runDomainMock.mockImplementation(async (_d: string, name: string) => ({
    data: { ok: true, result: { ok: true, result: name === 'patrolOptimize'
      ? { zones: [{ zone: 'North', crimeRate: 80, population: 1000, currentPatrols: 1, recommended: 8 }], totalUnitsNeeded: 8, totalCurrentUnits: 1, hotspots: ['North'] }
      : { caseStrength: 40, status: 'developing', evidenceCount: 1, witnessCount: 0, suspectCount: 1, prosecutable: false, nextSteps: [] } } },
  }));
  apiPost.mockImplementation(async () => ({ data: { ok: true, result: {} } }));
});
afterEach(() => cleanup());

async function clickAction(desc: string) {
  // The action buttons render label + macro name; match on the macro name.
  const b = screen.getAllByRole('button').find((x) => (x.textContent || '').includes(desc));
  await act(async () => { fireEvent.click(b as Element); await new Promise((r) => setTimeout(r, 30)); });
}

describe('LawEnforcementActionPanel bounds (FIX-law-enforcement-006)', () => {
  it('refuses a negative crime rate by name and sends nothing', async () => {
    render(<LawEnforcementActionPanel />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText('Zone name'), { target: { value: 'South' } });
    fireEvent.change(screen.getByPlaceholderText('Crime rate'), { target: { value: '-15' } });
    fireEvent.change(screen.getByPlaceholderText('Population'), { target: { value: '1000' } });
    fireEvent.change(screen.getByPlaceholderText('Patrols'), { target: { value: '-1' } });
    await clickAction('patrolOptimize');
    expect(screen.getByText('Zone "South": crime rate must be a number between 0 and 10,000.')).toBeInTheDocument();
    expect(macroCalls()).not.toContain('patrolOptimize');
  });

  it('refuses a huge evidence-links count by name and sends nothing', async () => {
    render(<LawEnforcementActionPanel />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText('9mm shell casing'), { target: { value: 'photo' } });
    fireEvent.change(screen.getByPlaceholderText('Suspect name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('# links'), { target: { value: '100000000' } });
    await clickAction('caseAnalysis');
    expect(screen.getByText('Suspect "X": evidence links must be a whole number between 0 and 1,000.')).toBeInTheDocument();
    expect(macroCalls()).not.toContain('caseAnalysis');
  });

  it('a valid zone still runs the patrol optimization', async () => {
    render(<LawEnforcementActionPanel />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText('Zone name'), { target: { value: 'North' } });
    fireEvent.change(screen.getByPlaceholderText('Crime rate'), { target: { value: '80' } });
    fireEvent.change(screen.getByPlaceholderText('Population'), { target: { value: '1000' } });
    fireEvent.change(screen.getByPlaceholderText('Patrols'), { target: { value: '1' } });
    await clickAction('patrolOptimize');
    expect(macroCalls()).toContain('patrolOptimize');
    expect(screen.getByText(/1 high-rate staged zone\(s\) · need 8 units\./)).toBeInTheDocument();
  });
});
