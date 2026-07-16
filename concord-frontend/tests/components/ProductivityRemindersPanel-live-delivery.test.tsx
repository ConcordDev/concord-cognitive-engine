import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// ── Capturing socket mock — lets a test simulate the server pushing a
// `productivity:reminder-fired` event onto whichever handler the panel
// actually registered via useSocket().on(...). ──────────────────────
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
type LensRunResult = { data: { ok: boolean; result: unknown; error: string | null } };
const lensRunMock = vi.fn<(...args: unknown[]) => Promise<LensRunResult>>();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ProductivityRemindersPanel } from '@/components/productivity/ProductivityRemindersPanel';

const REMINDER = {
  id: 'rem_1',
  taskId: 'tsk_1',
  kind: 'time' as const,
  remindAt: '2026-07-15T09:00',
  location: null,
  note: 'ring me',
  fired: false,
  task: 'Stand up',
};

function mockReminderList(reminders: unknown[]) {
  lensRunMock.mockImplementation(async (...args: unknown[]) => {
    const [domain, action] = args as [string, string];
    if (domain === 'productivity' && action === 'reminder-list') {
      return { data: { ok: true, result: { reminders, count: reminders.length }, error: null } };
    }
    if (domain === 'productivity' && action === 'task-list') {
      return { data: { ok: true, result: { tasks: [], count: 0 }, error: null } };
    }
    if (domain === 'productivity' && action === 'reminders-due') {
      return { data: { ok: true, result: { due: [], count: 0 }, error: null } };
    }
    return { data: { ok: true, result: null, error: null } };
  });
}

describe('ProductivityRemindersPanel — live delivery', () => {
  beforeEach(() => {
    for (const k of Object.keys(listeners)) delete listeners[k];
    mockOn.mockClear();
    mockOff.mockClear();
    addToastMock.mockClear();
    lensRunMock.mockClear();
    mockIsConnected = true;
    mockReminderList([REMINDER]);
  });

  it('subscribes to productivity:reminder-fired on mount', async () => {
    render(<ProductivityRemindersPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText(/No reminders yet/i)).not.toBeInTheDocument());
    expect(mockOn).toHaveBeenCalledWith('productivity:reminder-fired', expect.any(Function));
  });

  it('renders a real live notification the instant the socket event fires, and calls onChange', async () => {
    const onChange = vi.fn();
    render(<ProductivityRemindersPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Stand up')).toBeInTheDocument());

    act(() => {
      emitSocketEvent('productivity:reminder-fired', {
        userId: 'user_a',
        reminder: { id: 'rem_1', taskId: 'tsk_1', task: 'Stand up', remindAt: '2026-07-15T09:00', note: 'ring me', kind: 'time' },
        ts: Date.now(),
      });
    });

    // A real in-app notification renders — both the panel's own live banner
    // and the global toast — never a fabricated "delivered" state with no
    // visible change.
    await waitFor(() => expect(screen.getByText(/Live — delivered just now/i)).toBeInTheDocument());
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', message: expect.stringContaining('Stand up') }),
    );
    expect(onChange).toHaveBeenCalled();
  });

  it('ignores a malformed event payload without crashing (no reminder field)', async () => {
    render(<ProductivityRemindersPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Stand up')).toBeInTheDocument());

    expect(() => act(() => { emitSocketEvent('productivity:reminder-fired', {}); })).not.toThrow();
    expect(screen.queryByText(/Live — delivered just now/i)).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = render(<ProductivityRemindersPanel onChange={vi.fn()} />);
    await waitFor(() => expect(mockOn).toHaveBeenCalled());
    unmount();
    expect(mockOff).toHaveBeenCalledWith('productivity:reminder-fired', expect.any(Function));
  });

  it('honestly labels live delivery as tab-scoped — never implies OS-level push when connected', async () => {
    mockIsConnected = true;
    render(<ProductivityRemindersPanel onChange={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Live reminders — while this tab is open, reminders notify you instantly\./i)).toBeInTheDocument(),
    );
    // No wording anywhere claims desktop/OS-level notification delivery.
    expect(screen.queryByText(/desktop notification/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/push notification/i)).not.toBeInTheDocument();
  });

  it('honestly labels the disconnected state as relying on the manual fallback', async () => {
    mockIsConnected = false;
    render(<ProductivityRemindersPanel onChange={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Live delivery is offline right now/i)).toBeInTheDocument(),
    );
  });

  it('the manual "Check what is due now" button still works exactly as before', async () => {
    lensRunMock.mockImplementation(async (...args: unknown[]) => {
      const [domain, action] = args as [string, string, Record<string, unknown>];
      if (domain === 'productivity' && action === 'reminder-list') {
        return { data: { ok: true, result: { reminders: [REMINDER], count: 1 }, error: null } };
      }
      if (domain === 'productivity' && action === 'task-list') {
        return { data: { ok: true, result: { tasks: [], count: 0 }, error: null } };
      }
      if (domain === 'productivity' && action === 'reminders-due') {
        return {
          data: {
            ok: true,
            result: { due: [{ ...REMINDER, fired: true }], count: 1 },
            error: null,
          },
        };
      }
      return { data: { ok: true, result: null, error: null } };
    });

    render(<ProductivityRemindersPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Stand up')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Check what is due now/i }));

    await waitFor(() => expect(screen.getByText(/Fired reminders/i)).toBeInTheDocument());
    expect(
      lensRunMock.mock.calls.some(
        (c) => c[0] === 'productivity' && c[1] === 'reminders-due' && (c[2] as Record<string, unknown>)?.markFired === true,
      ),
    ).toBe(true);
  });
});
