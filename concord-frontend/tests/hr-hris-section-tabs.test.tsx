/**
 * HrHrisSection — tab-bar micro-interactions (Frontend UX Premium Pass, wave 5).
 *
 * Pins three real, state-grounded additions to the 11-tab People Hub shell:
 *   1. Per-tab badges are DERIVED from the real `hr-dashboard` macro result
 *      (pendingTimeoff → Time Off, openOnboarding → People, openJobs →
 *      Recruiting, openGoals → Performance) — never invented counts, and
 *      absent entirely when the underlying count is zero.
 *   2. Clicking a tab actually swaps the mounted panel (no dead click).
 *   3. `[` / `]` keyboard shortcuts cycle through the same tab order the
 *      mouse does, registered via the real `useLensCommand` channel.
 *
 * All 11 child panels are mocked as inert (each has its own macro coverage
 * elsewhere) so this file isolates the shell's own tab/badge behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Capture registered commands so the keyboard-cycle contract is testable
// without a real DOM keyboard event pipeline.
const registeredCommands: Array<{ id: string; keys: string; action: () => void }> = [];
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: Array<{ id: string; keys: string; action: () => void }>) => {
    registeredCommands.length = 0;
    registeredCommands.push(...commands);
  },
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { layoutId: _layoutId, transition: _transition, initial: _initial, animate: _animate, exit: _exit, ...domProps } = props;
      return React.createElement('div', domProps, props.children as React.ReactNode);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

function stubPanel(name: string) {
  const Comp = () => React.createElement('div', { 'data-testid': `panel-${name}` }, name);
  Comp.displayName = name;
  return Comp;
}
vi.mock('@/components/hr/HrPeoplePanel', () => ({ HrPeoplePanel: stubPanel('people') }));
vi.mock('@/components/hr/HrTimeOffPanel', () => ({ HrTimeOffPanel: stubPanel('timeoff') }));
vi.mock('@/components/hr/HrPerformancePanel', () => ({ HrPerformancePanel: stubPanel('performance') }));
vi.mock('@/components/hr/HrRecruitingPanel', () => ({ HrRecruitingPanel: stubPanel('recruiting') }));
vi.mock('@/components/hr/HrPayrollPanel', () => ({ HrPayrollPanel: stubPanel('payroll') }));
vi.mock('@/components/hr/HrBenefitsPanel', () => ({ HrBenefitsPanel: stubPanel('benefits') }));
vi.mock('@/components/hr/HrClockPanel', () => ({ HrClockPanel: stubPanel('clock') }));
vi.mock('@/components/hr/HrLearningPanel', () => ({ HrLearningPanel: stubPanel('training') }));
vi.mock('@/components/hr/HrCompliancePanel', () => ({ HrCompliancePanel: stubPanel('compliance') }));
vi.mock('@/components/hr/HrAnalyticsPanel', () => ({ HrAnalyticsPanel: stubPanel('analytics') }));
vi.mock('@/components/hr/HrSelfServicePanel', () => ({ HrSelfServicePanel: stubPanel('self') }));

import { HrHrisSection } from '@/components/hr/HrHrisSection';

const DASH_WITH_COUNTS = {
  headcount: 42, departments: 5, pendingTimeoff: 3,
  openOnboarding: 2, openJobs: 4, applicants: 9, openGoals: 1,
};
const DASH_ZERO = {
  headcount: 42, departments: 5, pendingTimeoff: 0,
  openOnboarding: 0, openJobs: 0, applicants: 0, openGoals: 0,
};

beforeEach(() => {
  lensRunMock.mockReset();
  registeredCommands.length = 0;
});

describe('HrHrisSection — tab badges + keyboard cycling', () => {
  it('BADGES: real nonzero dashboard counts render as badges on their matching tab', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: DASH_WITH_COUNTS } });
    const { getByText, container } = render(<HrHrisSection />);
    await waitFor(() => expect(getByText('42')).toBeInTheDocument()); // headcount stat loaded

    const nav = container.querySelector('nav[aria-label="HRIS sections"]') as HTMLElement;
    const badgeTextsByTab = (label: string) => {
      const btn = Array.from(nav.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
      return btn?.querySelector('.rounded-full')?.textContent ?? null;
    };
    // Badge counts traced to the exact dashboard fields, one per gated tab.
    expect(badgeTextsByTab('Time Off')).toBe('3');       // pendingTimeoff
    expect(badgeTextsByTab('People')).toBe('2');          // openOnboarding
    expect(badgeTextsByTab('Recruiting')).toBe('4');      // openJobs
    expect(badgeTextsByTab('Performance')).toBe('1');     // openGoals
  });

  it('NO FABRICATION: zero counts render no badge at all (absence, not a fake "0")', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: DASH_ZERO } });
    const { container, getByText } = render(<HrHrisSection />);
    await waitFor(() => expect(getByText('42')).toBeInTheDocument());
    // No badge pill anywhere in the tab nav when every gated count is 0.
    const nav = container.querySelector('nav[aria-label="HRIS sections"]');
    expect(nav?.querySelector('.rounded-full')).toBeNull();
  });

  it('TAB SWITCH: clicking a tab mounts that tab\'s real panel and unmounts the previous one', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: DASH_ZERO } });
    const { getByText, getByTestId, queryByTestId } = render(<HrHrisSection />);
    await waitFor(() => expect(getByTestId('panel-people')).toBeInTheDocument());
    expect(queryByTestId('panel-timeoff')).toBeNull();

    await act(async () => { fireEvent.click(getByText('Time Off')); });
    await waitFor(() => expect(getByTestId('panel-timeoff')).toBeInTheDocument());
    expect(queryByTestId('panel-people')).toBeNull();
  });

  it('KEYBOARD: "]" / "[" are registered and cycle the active tab forward/backward like the mouse does', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: DASH_ZERO } });
    const { getByTestId, queryByTestId } = render(<HrHrisSection />);
    await waitFor(() => expect(getByTestId('panel-people')).toBeInTheDocument());

    const next = registeredCommands.find((c) => c.keys === ']');
    const prev = registeredCommands.find((c) => c.keys === '[');
    expect(next).toBeTruthy();
    expect(prev).toBeTruthy();

    await act(async () => { next!.action(); }); // people -> timeoff
    await waitFor(() => expect(getByTestId('panel-timeoff')).toBeInTheDocument());
    expect(queryByTestId('panel-people')).toBeNull();

    await act(async () => { prev!.action(); }); // timeoff -> people
    await waitFor(() => expect(getByTestId('panel-people')).toBeInTheDocument());
  });
});
