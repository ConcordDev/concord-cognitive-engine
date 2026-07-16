import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// ── Capturing socket mock — lets a test simulate the server pushing a
// `forecast:alert-triggered` event onto whichever handler the panel
// actually registered via useSocket().on(...). Cloned from the
// ProductivityRemindersPanel-live-delivery.test.tsx precedent. ───────────
const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
const mockOn = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
  (listeners[event] ||= []).push(cb);
});
const mockOff = vi.fn((event: string, cb?: (...args: unknown[]) => void) => {
  if (!listeners[event]) return;
  listeners[event] = cb ? listeners[event].filter((h) => h !== cb) : [];
});
let mockIsConnected = true;

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: mockIsConnected,
    status: mockIsConnected ? 'connected' : 'connecting',
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: mockOn,
    off: mockOff,
  }),
}));

function emitSocketEvent(event: string, data: unknown) {
  (listeners[event] || []).forEach((h) => h(data));
}

// ── UI toast store mock ──────────────────────────────────────────────
const addToastMock = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { addToast: addToastMock, removeToast: vi.fn(), toasts: [] };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// ── lensRun mock — real macro names, fake network ────────────────────
type LensRunResult = { data: { ok: boolean; result: unknown; error?: string | null } };
const lensRunMock = vi.fn<(...args: unknown[]) => Promise<LensRunResult>>();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { AlertSubscriptions } from '@/components/forecast/AlertSubscriptions';

const WORLD = 'concordia-hub';

const SUB = {
  id: 'fas_1',
  worldId: WORLD,
  kind: 'severe_event' as const,
  minConfidence: 0.6,
  weatherKinds: [] as string[],
  createdAt: 1700000000,
  lastFiredAt: null as number | null,
};

function mockSubsList(subscriptions: unknown[]) {
  lensRunMock.mockImplementation(async (...args: unknown[]) => {
    const [domain, action] = args as [string, string];
    if (domain === 'forecast' && action === 'listAlerts') {
      return { data: { ok: true, result: { ok: true, subscriptions, count: subscriptions.length } } };
    }
    return { data: { ok: true, result: null } };
  });
}

describe('AlertSubscriptions — live delivery', () => {
  beforeEach(() => {
    for (const k of Object.keys(listeners)) delete listeners[k];
    mockOn.mockClear();
    mockOff.mockClear();
    addToastMock.mockClear();
    lensRunMock.mockClear();
    mockIsConnected = true;
    mockSubsList([SUB]);
  });

  it('subscribes to forecast:alert-triggered on mount', async () => {
    render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() => expect(screen.getByText(/Your subscriptions \(1\)/i)).toBeInTheDocument());
    expect(mockOn).toHaveBeenCalledWith('forecast:alert-triggered', expect.any(Function));
  });

  it('renders a real live notification the instant the socket event fires, highlights the tripped subscription, and toasts', async () => {
    render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() => expect(screen.getByText(/Your subscriptions \(1\)/i)).toBeInTheDocument());

    act(() => {
      emitSocketEvent('forecast:alert-triggered', {
        userId: 'user_a',
        worldId: WORLD,
        triggered: [{
          subscriptionId: 'fas_1',
          kind: 'severe_event',
          hits: [{ type: 'event', summary: 'A storm front gates the harvest.', confidence: 0.9, eta_hours: 2 }],
        }],
        forecastComposedAt: Date.now(),
        ts: Date.now(),
      });
    });

    // A real in-app notification renders — both the panel's own live banner
    // and the global toast — never a fabricated "delivered" state with no
    // visible change.
    await waitFor(() => expect(screen.getByText(/Live — delivered just now/i)).toBeInTheDocument());
    // The trip summary renders in both the live banner and the now-highlighted
    // subscription row — assert at least one real occurrence exists (not zero).
    expect(screen.getAllByText(/A storm front gates the harvest\./).length).toBeGreaterThan(0);
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', message: expect.stringContaining('storm front') }),
    );
  });

  it('ignores a live event for a different worldId than the one being viewed', async () => {
    render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() => expect(screen.getByText(/Your subscriptions \(1\)/i)).toBeInTheDocument());

    act(() => {
      emitSocketEvent('forecast:alert-triggered', {
        userId: 'user_a',
        worldId: 'some-other-world',
        triggered: [{ subscriptionId: 'fas_1', kind: 'severe_event', hits: [{ type: 'event', summary: 'Elsewhere' }] }],
      });
    });

    expect(screen.queryByText(/Live — delivered just now/i)).not.toBeInTheDocument();
    expect(addToastMock).not.toHaveBeenCalled();
  });

  it('ignores a malformed event payload without crashing (no triggered field)', async () => {
    render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() => expect(screen.getByText(/Your subscriptions \(1\)/i)).toBeInTheDocument());

    expect(() => act(() => { emitSocketEvent('forecast:alert-triggered', {}); })).not.toThrow();
    expect(screen.queryByText(/Live — delivered just now/i)).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() => expect(mockOn).toHaveBeenCalled());
    unmount();
    expect(mockOff).toHaveBeenCalledWith('forecast:alert-triggered', expect.any(Function));
  });

  it('honestly labels live delivery as tab-scoped — never implies OS-level push when connected', async () => {
    mockIsConnected = true;
    render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() =>
      expect(screen.getByText(/Live alerts — while this tab is open/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/desktop notification/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/push notification/i)).not.toBeInTheDocument();
  });

  it('honestly labels the disconnected state as relying on the manual fallback', async () => {
    mockIsConnected = false;
    render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() =>
      expect(screen.getByText(/Live delivery is offline right now/i)).toBeInTheDocument(),
    );
  });

  it('the manual "Check against fresh forecast" button still works exactly as before', async () => {
    lensRunMock.mockImplementation(async (...args: unknown[]) => {
      const [domain, action] = args as [string, string];
      if (domain === 'forecast' && action === 'listAlerts') {
        return { data: { ok: true, result: { ok: true, subscriptions: [SUB], count: 1 } } };
      }
      if (domain === 'forecast' && action === 'checkAlerts') {
        return {
          data: {
            ok: true,
            result: {
              ok: true,
              triggered: [{ subscriptionId: 'fas_1', kind: 'severe_event', hits: [{ type: 'event', summary: 'Manual hit' }] }],
            },
          },
        };
      }
      return { data: { ok: true, result: null } };
    });

    render(<AlertSubscriptions worldId={WORLD} />);
    await waitFor(() => expect(screen.getByText(/Your subscriptions \(1\)/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Check against fresh forecast/i }));

    await waitFor(() => expect(screen.getByText(/Manual hit/)).toBeInTheDocument());
    expect(
      lensRunMock.mock.calls.some((c) => c[0] === 'forecast' && c[1] === 'checkAlerts'),
    ).toBe(true);
  });
});
