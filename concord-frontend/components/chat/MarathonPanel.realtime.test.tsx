/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Pins the DET-C batch 5 fix for MarathonPanel: the server already emits a
 * real, correctly room-scoped 'marathon:status' socket event
 * (server/lib/agent-marathon.js's terminal-status hook passes { userId }
 * as of this fix), but no frontend code ever subscribed to it — a
 * completed/paused marathon only reflected in the UI on the next 15s list
 * poll (or 10s detail poll, if that session's detail view was open). The
 * component now subscribes via lib/realtime/socket#subscribe and refreshes
 * immediately on the real event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    subscribe: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

import MarathonPanel from '@/components/chat/MarathonPanel';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('MarathonPanel — marathon:status realtime wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, sessions: [] }),
    } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('refetches the session list on a real marathon:status socket event', async () => {
    render(<MarathonPanel />);

    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0),
    );
    const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    emitSocket('marathon:status', { session_id: 'marathon_1', status: 'completed' });

    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });
});
