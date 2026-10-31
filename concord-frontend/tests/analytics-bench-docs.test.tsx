/**
 * /lenses/analytics — the analyst bench documents its own input formats
 * (Review 4 F3 / remainder slice R4).
 *
 * The bench's four calculators each expect a specific JSON shape, but the
 * textareas documented none of it — the format existed only in test
 * files, and the review's natural-shape attempts were rejected or
 * silently misread. These tests pin that each bench textarea now carries
 * its exact expected shape as its placeholder (the funnel and cohort
 * shapes verbatim; the series shape plus the accepted bare-number form).
 *
 * The panel is rendered with its backend channel mocked, as in
 * analytics-lens-states.test.tsx; only the documentation is asserted.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } }));
const apiPost = vi.fn(() => Promise.resolve({ data: {} }));
const apiDelete = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a), get: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn(), label: '' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { AnalyticsActionPanel } from '@/components/analytics/AnalyticsActionPanel';

describe('Analyst bench input documentation (R4-slice)', () => {
  it('every bench textarea carries its exact expected shape as placeholder', () => {
    render(<AnalyticsActionPanel />);
    const areas = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    const placeholders = areas.map((el) => el.getAttribute('placeholder') || '');
    expect(placeholders.some((p) => p.includes('"stages"') && p.includes('"count"'))).toBe(true);
    expect(placeholders.some((p) => p.includes('"cohorts"') && p.includes('"initialUsers"') && p.includes('"retention"'))).toBe(true);
    expect(placeholders.some((p) => p.includes('"dataPoints"') && p.includes('"value"'))).toBe(true);
    // The series placeholder also documents the accepted bare-number form.
    expect(placeholders.some((p) => p.includes('[100,102,98]'))).toBe(true);
  });
});
