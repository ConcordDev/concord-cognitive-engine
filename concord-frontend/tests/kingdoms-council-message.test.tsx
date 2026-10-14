/**
 * F3 — Realm Council posts chat_agent.do with input.message (not task-only),
 * and renders the reply.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

const apiPost = vi.hoisted(() => vi.fn());
const apiDelete = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  api: {
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...a: unknown[]) => a.filter(Boolean).join(' '),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({}),
  useRecallableAction: () => ({ canUndo: false }),
  RecallSlot: () => null,
}));

vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

vi.mock('framer-motion', () => ({
  motion: { div: (p: { children?: React.ReactNode }) => <div>{p.children}</div> },
  AnimatePresence: (p: { children?: React.ReactNode }) => <>{p.children}</>,
}));

import { RealmActionPanel } from '@/components/kingdoms/RealmActionPanel';

describe('kingdoms F3 council message contract', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockImplementation(async (url: string, body?: { domain?: string; name?: string }) => {
      if (url === '/api/lens/run' && body?.domain === 'kingdoms') {
        return { data: { ok: true, result: { ok: true, kingdoms: [], realm: null } } };
      }
      if (url === '/api/lens/run' && body?.domain === 'chat_agent') {
        return {
          data: {
            ok: true,
            result: { ok: true, reply: 'Hold the ford and mint a festival.' },
          },
        };
      }
      return { data: { ok: true, result: { ok: true } } };
    });
  });
  afterEach(() => cleanup());

  it('Council sends message and renders the suggestion', async () => {
    render(<RealmActionPanel />);
    const council = await screen.findByRole('button', { name: /council/i });
    fireEvent.click(council);
    await waitFor(() => {
      const chatCalls = apiPost.mock.calls.filter(
        (c) => c[0] === '/api/lens/run' && c[1]?.domain === 'chat_agent',
      );
      expect(chatCalls.length).toBeGreaterThanOrEqual(1);
      const input = chatCalls[0][1].input;
      expect(input.message).toBeTruthy();
      expect(input.task).toBeUndefined();
    });
    await waitFor(() => {
      expect(screen.getByText(/Hold the ford and mint a festival/i)).toBeTruthy();
    });
  });
});
