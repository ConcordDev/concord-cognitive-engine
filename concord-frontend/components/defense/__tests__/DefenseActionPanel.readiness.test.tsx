// FIX-defense-005 — the readiness card explains itself and never goes stale.
//
// The card showed an overall (79% for 8/10, 9/10, 80, 60) with no
// formula, and a blank recalculation left the previous result standing
// beside the "All 6 readiness metrics required" error. Now the card
// renders the weighting the server publishes with the result, editing
// any readiness input clears the old result, and a failed recalculation
// clears it too.

import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const READY = {
  personnelReadiness: 80, equipmentReadiness: 90, trainingCompletion: 80, supplyLevel: 60,
  overallReadiness: 79, weights: { personnel: 0.3, equipment: 0.3, training: 0.2, supplies: 0.2 },
  status: 'operationally-ready', gaps: ['Supplies'],
};
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {
    lens: {
      runDomain: vi.fn(async (_domain: string, action: string) =>
        action === 'readinessScore'
          ? { data: { ok: true, result: { ok: true, result: READY } } }
          : { data: { ok: true, result: { ok: true, result: {} } } }),
    },
  },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({}),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));
vi.mock('@/lib/agent-reply', () => ({ readAgentReply: () => null }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DefenseActionPanel } from '../DefenseActionPanel';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const input = (placeholder: string) => screen.getByPlaceholderText(placeholder) as HTMLInputElement;
const setField = async (placeholder: string, value: string) => {
  fireEvent.change(input(placeholder), { target: { value } });
  await settle();
};
const clickCalculate = async () => {
  const btn = screen.queryAllByRole('button').find((b) => (b.textContent || '').includes('Calculate readiness'));
  if (btn) fireEvent.click(btn);
  await settle();
};
const fillWalkerSample = async () => {
  await setField('P ready', '8');
  await setField('P total', '10');
  await setField('E ready', '9');
  await setField('E total', '10');
  await setField('Training %', '80');
  await setField('Supply %', '60');
};

afterEach(() => cleanup());

describe('DefenseActionPanel readiness (FIX-defense-005)', () => {
  it('shows the weighting beside the overall it produced', async () => {
    const view = render(<DefenseActionPanel />);
    await fillWalkerSample();
    await clickCalculate();
    expect(view.container.textContent).toContain('79%');
    expect(view.container.textContent).toContain('Overall = Personnel ×30% + Equipment ×30% + Training ×20% + Supply ×20%');
  });

  it('editing an input after a result clears the now-stale card', async () => {
    const view = render(<DefenseActionPanel />);
    await fillWalkerSample();
    await clickCalculate();
    // The card marker is its header + formula line (the transient
    // success feedback also names the percentage and is not the card).
    expect(view.container.textContent).toContain('Readiness · operationally-ready');
    await setField('Training %', '85');
    expect(view.container.textContent).not.toContain('Readiness · operationally-ready');
    expect(view.container.textContent).not.toContain('Overall = Personnel');
  });

  it('a blank recalculation errors and leaves no stale result', async () => {
    const view = render(<DefenseActionPanel />);
    await fillWalkerSample();
    await clickCalculate();
    expect(view.container.textContent).toContain('Readiness · operationally-ready');
    await setField('Supply %', '');
    await clickCalculate();
    expect(view.container.textContent).toContain('All 6 readiness metrics required.');
    expect(view.container.textContent).not.toContain('Readiness · operationally-ready');
    expect(view.container.textContent).not.toContain('Overall = Personnel');
  });
});
