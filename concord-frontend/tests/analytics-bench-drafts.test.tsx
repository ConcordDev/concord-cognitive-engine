/**
 * /lenses/analytics — bench drafts survive tab switches (A23 / F8).
 *
 * Review 4's formal A23 protocol: three drafts typed into the bench's
 * three fields were ALL lost on a tab switch alone. Mechanism: the
 * bench (AnalyticsActionPanel) mounts only in DeskPanel's actions
 * mode, so any tab switch unmounted it and its useState drafts died
 * with the component.
 *
 * The fix rides the repo's lens state store: drafts restore on mount
 * and persist on change under a benchDrafts key. These tests pin the
 * component-level equivalent of the protocol — unmount IS what a tab
 * switch does to this panel:
 *   SURVIVAL — type into all three textareas, unmount, remount: every
 *     draft is back, character for character.
 *   FRESH    — with nothing persisted, the fields start empty (no
 *     phantom drafts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ slot: null, pending: false, run: vi.fn(), undo: vi.fn() }),
  RecallSlot: () => null,
  PipingProvider: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) =>
      React.createElement('div', props, props.children as React.ReactNode),
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { AnalyticsActionPanel } from '@/components/analytics/AnalyticsActionPanel';

const FUNNEL = '{"stages":[{"name":"Visit","count":10}]}';
const COHORT = '{"cohorts":[{"name":"2024-01","initialUsers":5,"retention":[80]}]}';
const SERIES = '{"dataPoints":[100,102,98]}';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('bench drafts (A23/F8)', () => {
  it('three drafts typed before a tab switch are all restored after it', () => {
    const first = render(<AnalyticsActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/"stages"/), { target: { value: FUNNEL } });
    fireEvent.change(screen.getByPlaceholderText(/"cohorts"/), { target: { value: COHORT } });
    fireEvent.change(screen.getByPlaceholderText(/"dataPoints"/), { target: { value: SERIES } });
    first.unmount(); // the tab switch
    render(<AnalyticsActionPanel />);
    expect((screen.getByPlaceholderText(/"stages"/) as HTMLTextAreaElement).value).toBe(FUNNEL);
    expect((screen.getByPlaceholderText(/"cohorts"/) as HTMLTextAreaElement).value).toBe(COHORT);
    expect((screen.getByPlaceholderText(/"dataPoints"/) as HTMLTextAreaElement).value).toBe(SERIES);
  });

  it('with nothing persisted the fields start empty', () => {
    render(<AnalyticsActionPanel />);
    expect((screen.getByPlaceholderText(/"stages"/) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByPlaceholderText(/"cohorts"/) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByPlaceholderText(/"dataPoints"/) as HTMLTextAreaElement).value).toBe('');
  });
});
