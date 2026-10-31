/**
 * /lenses/analytics — Lever reads the agent's actual answer field
 * (Review 4 F4 / A13; remainder slice R5).
 *
 * chat_agent.do returns runAgentLoop's envelope { ok, answer, toolCalls }
 * (server/lib/chat-agent.js — the field AgentModePanel reads). The
 * panel's Lever action used to read result.reply / summary / output —
 * never `answer` — so every successful run displayed "Agent returned
 * empty.", and a macro-level failure ({ ok:false, reason }) collapsed
 * into the same message. These tests pin:
 *   ANSWER  — a successful run renders result.answer as the lever.
 *   REASON  — a failed run surfaces its specific reason, not "empty".
 *
 * Backend mocked at '@/lib/api/client' in the envelope /api/lens/run
 * returns ({ data: { ok, result } }).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } }));
const apiPost = vi.fn();
const apiDelete = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('@/lib/api/client', () => ({
  api: {
    post: (...a: unknown[]) => apiPost(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
    get: vi.fn(() => Promise.resolve({ data: {} })),
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  runDomain.mockResolvedValue({ data: { ok: true, result: {} } });
});

describe('Lever (chat_agent) terminal states (R5)', () => {
  it('renders result.answer from a successful agent run', async () => {
    apiPost.mockResolvedValue({
      data: { ok: true, result: { ok: true, answer: 'Fix the Signup to Buy drop: it is the biggest lever.', toolCalls: [] } },
    });
    render(<AnalyticsActionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /lever/i }));
    await waitFor(() =>
      expect(screen.getByText('Fix the Signup to Buy drop: it is the biggest lever.')).toBeTruthy(),
    );
    expect(screen.queryByText('Agent returned empty.')).toBeNull();
  });

  it('surfaces the specific reason on a macro-level failure, not "empty"', async () => {
    apiPost.mockResolvedValue({
      data: { ok: true, result: { ok: false, reason: 'no_actor' } },
    });
    render(<AnalyticsActionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /lever/i }));
    await waitFor(() => expect(screen.getByText('Agent unavailable: no_actor.')).toBeTruthy());
    expect(screen.queryByText('Agent returned empty.')).toBeNull();
  });
});
