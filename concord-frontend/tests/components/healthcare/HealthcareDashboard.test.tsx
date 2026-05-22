import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { HealthcareDashboard } from '@/components/healthcare/HealthcareDashboard';

const fullSummary = {
  patientCount: 42, todaysVisits: 7, unsignedNotes: 3, inboxUnread: 2,
  pendingRefills: 1, criticalLabs: 4, activeProblems: 18, allergiesCount: 9,
};

describe('HealthcareDashboard', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<HealthcareDashboard />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows "No data yet" when the macro returns no result', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<HealthcareDashboard />);
    await waitFor(() => expect(screen.getByText(/No data yet/)).toBeInTheDocument());
  });

  it('renders all tiles and alert cards when data is populated', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: fullSummary } });
    render(<HealthcareDashboard />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/2 unread messages/)).toBeInTheDocument();
    expect(screen.getByText(/1 refill request/)).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('uses singular wording for a count of one', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...fullSummary, inboxUnread: 1, pendingRefills: 1 } } });
    render(<HealthcareDashboard />);
    await waitFor(() => expect(screen.getByText(/1 unread message$/)).toBeInTheDocument());
    expect(screen.getByText(/1 refill request$/)).toBeInTheDocument();
  });

  it('hides the inbox/refill alert row when both counts are zero', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...fullSummary, inboxUnread: 0, pendingRefills: 0 } } });
    render(<HealthcareDashboard />);
    await waitFor(() => screen.getByText('42'));
    expect(screen.queryByText(/unread message/)).not.toBeInTheDocument();
  });

  it('invokes onJumpTo when a tile is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: fullSummary } });
    const onJump = vi.fn();
    render(<HealthcareDashboard onJumpTo={onJump} />);
    await waitFor(() => screen.getByText('42'));
    fireEvent.click(screen.getByText('Patients').closest('button')!);
    expect(onJump).toHaveBeenCalledWith('patients');
    fireEvent.click(screen.getByText(/2 unread messages/).closest('button')!);
    expect(onJump).toHaveBeenCalledWith('inbox');
  });

  it('does not throw when a tile is clicked without onJumpTo', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: fullSummary } });
    render(<HealthcareDashboard />);
    await waitFor(() => screen.getByText('42'));
    expect(() => fireEvent.click(screen.getByText("Today's visits").closest('button')!)).not.toThrow();
  });

  it('handles a macro error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('down'));
    render(<HealthcareDashboard />);
    await waitFor(() => expect(screen.getByText(/No data yet/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
