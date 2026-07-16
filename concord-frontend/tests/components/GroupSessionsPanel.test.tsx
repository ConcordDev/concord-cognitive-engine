/**
 * GroupSessionsPanel — the many-mentees/one-mentor surface (Wave-4
 * gap-closure for mentorship-capability-map.md checklist item #4). Talks to
 * the backend exclusively through lensRun('mentorship', 'group-session-*',
 * input) — group-session-create / -list / -join / -leave / -update
 * (server/domains/mentorship.js). This file exercises render, create,
 * join/leave (including the honest capacity-full and already-joined error
 * paths), and the host-only vs attendee-only detail controls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user_host', username: 'HostMentor', email: 'h@test.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { GroupSessionsPanel } from '@/components/mentorship/GroupSessionsPanel';

const HOSTED_SESSION = {
  id: 'gses_1',
  hostId: 'user_host',
  hostName: 'HostMentor',
  title: 'Resume Review Workshop',
  topic: 'resumes',
  description: 'Bring a draft',
  startAt: '2099-01-01T10:00:00.000Z',
  durationMin: 45,
  capacity: 4,
  videoLink: 'https://meet.example/room',
  agenda: 'Round-robin feedback',
  attendees: ['user_mentee_1'],
  status: 'scheduled',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ATTENDING_SESSION = {
  ...HOSTED_SESSION,
  id: 'gses_2',
  hostId: 'user_other_mentor',
  hostName: 'OtherMentor',
  title: 'Mock Interview Circle',
  attendees: ['user_host'],
};

function installMock(overrides: Partial<Record<string, (input: Record<string, unknown>) => unknown>> = {}) {
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain !== 'mentorship') return { data: { ok: true, result: null, error: null } };
    if (overrides[action]) return { data: overrides[action]!(input) };
    switch (action) {
      case 'group-session-list':
        return { data: { ok: true, result: { sessions: [HOSTED_SESSION, ATTENDING_SESSION], hostingCount: 1, attendingCount: 1 }, error: null } };
      case 'group-session-create':
        return { data: { ok: true, result: { session: { ...HOSTED_SESSION, id: 'gses_new' } }, error: null } };
      case 'group-session-join':
        return { data: { ok: true, result: { session: HOSTED_SESSION, spotsRemaining: 2 }, error: null } };
      case 'group-session-leave':
        return { data: { ok: true, result: { session: ATTENDING_SESSION }, error: null } };
      case 'group-session-update':
        return { data: { ok: true, result: { session: { ...HOSTED_SESSION, status: 'completed' } }, error: null } };
      default:
        return { data: { ok: true, result: null, error: null } };
    }
  });
}

describe('GroupSessionsPanel', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    // Fresh clipboard stub per test — jsdom doesn't implement navigator.clipboard.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('loads and renders sessions with real hosting/attending counts (not fabricated)', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    expect(await screen.findByText('Resume Review Workshop')).toBeInTheDocument();
    expect(screen.getByText('Mock Interview Circle')).toBeInTheDocument();
    // "Hosting"/"Attending" also label the filter chips below, so disambiguate
    // by tag: the KPI tile renders its label in a <p>, the filter chip is a <button>.
    const hostingTile = screen.getAllByText('Hosting').find((el) => el.tagName === 'P')?.closest('div');
    const attendingTile = screen.getAllByText('Attending').find((el) => el.tagName === 'P')?.closest('div');
    expect(within(hostingTile as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(attendingTile as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(lensRunMock).toHaveBeenCalledWith('mentorship', 'group-session-list', {});
  });

  it('shows "You are hosting" for the session the current user hosts, and "Hosted by X" for the one they attend', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');
    expect(screen.getByText(/You are hosting/)).toBeInTheDocument();
    expect(screen.getByText(/Hosted by OtherMentor/)).toBeInTheDocument();
  });

  it('renders an honest empty state when there are no group sessions', async () => {
    installMock({ 'group-session-list': () => ({ ok: true, result: { sessions: [], hostingCount: 0, attendingCount: 0 }, error: null }) });
    render(<GroupSessionsPanel />);
    expect(await screen.findByText(/No group sessions yet/)).toBeInTheDocument();
  });

  it('switching a filter chip re-dispatches group-session-list with that filter', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');
    lensRunMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Attending' }));
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('mentorship', 'group-session-list', { filter: 'attending' });
    });
  });

  it('create flow: fills the form and calls group-session-create with the entered fields', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');

    fireEvent.click(screen.getByText('Host a group session'));
    fireEvent.change(screen.getByPlaceholderText('Session title *'), { target: { value: 'Career Panel' } });
    const startInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2099-05-01T10:00' } });
    fireEvent.change(screen.getByPlaceholderText('Capacity *'), { target: { value: '10' } });

    fireEvent.click(screen.getByText('Host session'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith(
        'mentorship',
        'group-session-create',
        expect.objectContaining({ title: 'Career Panel', capacity: 10 }),
      );
    });
  });

  it('create flow: blocks submission client-side when capacity < 2 (no macro call, error shown)', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');

    fireEvent.click(screen.getByText('Host a group session'));
    fireEvent.change(screen.getByPlaceholderText('Session title *'), { target: { value: 'Solo Session' } });
    const startInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2099-05-01T10:00' } });
    fireEvent.change(screen.getByPlaceholderText('Capacity *'), { target: { value: '1' } });

    lensRunMock.mockClear();
    fireEvent.click(screen.getByText('Host session'));

    expect(await screen.findByText(/Capacity must be a whole number of at least 2/)).toBeInTheDocument();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'group-session-create')).toBe(false);
  });

  it('create flow: blocks submission client-side when title/startAt are missing', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');

    fireEvent.click(screen.getByText('Host a group session'));
    lensRunMock.mockClear();
    fireEvent.click(screen.getByText('Host session'));

    expect(await screen.findByText(/Title and start time are required/)).toBeInTheDocument();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'group-session-create')).toBe(false);
  });

  it('join flow: pasting a Session ID and clicking Join calls group-session-join and clears the input on success', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');

    const input = screen.getByPlaceholderText('Session ID');
    fireEvent.change(input, { target: { value: 'gses_3' } });
    fireEvent.click(screen.getByText('Join'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('mentorship', 'group-session-join', { sessionId: 'gses_3' });
    });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  });

  it('join flow: surfaces "session is full" inline without crashing or clearing the input', async () => {
    installMock({ 'group-session-join': () => ({ ok: false, result: null, error: 'session is full' }) });
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');

    const input = screen.getByPlaceholderText('Session ID');
    fireEvent.change(input, { target: { value: 'gses_full' } });
    fireEvent.click(screen.getByText('Join'));

    expect(await screen.findByText('session is full')).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('gses_full');
  });

  it('join flow: surfaces "already joined" inline', async () => {
    installMock({ 'group-session-join': () => ({ ok: false, result: null, error: 'already joined' }) });
    render(<GroupSessionsPanel />);
    await screen.findByText('Resume Review Workshop');

    fireEvent.change(screen.getByPlaceholderText('Session ID'), { target: { value: 'gses_1' } });
    fireEvent.click(screen.getByText('Join'));

    expect(await screen.findByText('already joined')).toBeInTheDocument();
  });

  it('opens a session detail view on click, showing capacity progress', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    const card = await screen.findByText('Resume Review Workshop');
    fireEvent.click(card);

    expect(await screen.findByText('Back to group sessions')).toBeInTheDocument();
    expect(screen.getByText(/1\/4 joined/)).toBeInTheDocument();
  });

  it('host-only controls (Mark complete / Cancel / Copy Session ID) show for the session the current user hosts', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    fireEvent.click(await screen.findByText('Resume Review Workshop'));

    expect(await screen.findByText(/Mark complete/)).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Copy Session ID')).toBeInTheDocument();
    // not the attendee-only affordance
    expect(screen.queryByText(/Leave session/)).not.toBeInTheDocument();
  });

  it('attendee-only "Leave session" control shows (not host controls) for a session the current user only attends', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    fireEvent.click(await screen.findByText('Mock Interview Circle'));

    expect(await screen.findByText(/Leave session/)).toBeInTheDocument();
    expect(screen.queryByText(/Mark complete/)).not.toBeInTheDocument();
    expect(screen.queryByText('Copy Session ID')).not.toBeInTheDocument();
  });

  it('clicking Leave session calls group-session-leave with the session id', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    fireEvent.click(await screen.findByText('Mock Interview Circle'));
    fireEvent.click(await screen.findByText(/Leave session/));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('mentorship', 'group-session-leave', { sessionId: 'gses_2' });
    });
  });

  it('clicking Mark complete calls group-session-update with status "completed"', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    fireEvent.click(await screen.findByText('Resume Review Workshop'));
    fireEvent.click(await screen.findByText(/Mark complete/));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('mentorship', 'group-session-update', { sessionId: 'gses_1', status: 'completed' });
    });
  });

  it('Copy Session ID writes the session id to the clipboard', async () => {
    installMock();
    render(<GroupSessionsPanel />);
    fireEvent.click(await screen.findByText('Resume Review Workshop'));
    fireEvent.click(await screen.findByText('Copy Session ID'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('gses_1');
    });
  });
});
