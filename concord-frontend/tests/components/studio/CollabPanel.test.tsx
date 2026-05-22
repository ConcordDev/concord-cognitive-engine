import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CollabPanel } from '@/components/studio/CollabPanel';

const SESSION = {
  id: 'sess1', projectId: 'p1', projectName: 'Demo', hostUserId: 'u1',
  collaborators: [
    { userId: 'u1', displayName: 'Alice', role: 'host', colour: '#f00', cursorBeats: 4, selectionTrackId: null },
  ],
  editLog: [{ seq: 1, userId: 'u1', op: 'add_clip', target: 'c1', at: '' }],
  startedAt: '',
};

beforeEach(() => { lensRun.mockReset(); });

describe('CollabPanel', () => {
  it('shows the no-project state', async () => {
    render(<CollabPanel />);
    await waitFor(() => expect(screen.getByText(/Open a project to start a collaboration/)).toBeInTheDocument());
  });

  it('shows start/join controls when no session exists', async () => {
    lensRun.mockResolvedValue(okResult({ session: null }));
    render(<CollabPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Start session')).toBeInTheDocument());
    expect(screen.getByText(/No active session/)).toBeInTheDocument();
    // join is disabled
    expect(screen.getByText('Join session').closest('button')).toBeDisabled();
  });

  it('renders an existing session with collaborators and edit log', async () => {
    lensRun.mockResolvedValue(okResult({ session: SESSION }));
    render(<CollabPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText(/Collaborators \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/add_clip/)).toBeInTheDocument();
  });

  it('starts a session', async () => {
    lensRun.mockResolvedValueOnce(okResult({ session: null }));
    render(<CollabPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Start session')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Your display name'), { target: { value: 'Bob' } });
    lensRun.mockResolvedValueOnce(okResult({ session: SESSION }));
    fireEvent.click(screen.getByText('Start session'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'collab-session-start', { projectId: 'p1', displayName: 'Bob' },
    ));
    await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
  });

  it('joins an existing session and leaves it', async () => {
    lensRun.mockResolvedValueOnce(okResult({ session: SESSION }));
    render(<CollabPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(okResult({ session: SESSION }));
    fireEvent.click(screen.getByText('Join session'));
    await waitFor(() => expect(screen.getByText('Leave session')).toBeInTheDocument());

    lensRun.mockResolvedValueOnce(okResult({}));        // collab-leave
    lensRun.mockResolvedValueOnce(okResult({ session: SESSION })); // loadSession
    fireEvent.click(screen.getByText('Leave session'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'collab-leave', { projectId: 'p1' },
    ));
  });

  it('start with an error envelope does not flip to live', async () => {
    lensRun.mockResolvedValueOnce(okResult({ session: null }));
    render(<CollabPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Start session')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(errResult());
    fireEvent.click(screen.getByText('Start session'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('survives a session-load exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<CollabPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Start session')).toBeInTheDocument());
  });
});
