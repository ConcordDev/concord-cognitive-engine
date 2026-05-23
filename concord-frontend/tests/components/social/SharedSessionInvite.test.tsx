import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const sharedSessionInviteDetails = vi.fn();
const joinSharedSession = vi.fn();
vi.mock('@/lib/api/client', () => ({
  sharedSessionInviteDetails: (...a: unknown[]) => sharedSessionInviteDetails(...a),
  joinSharedSession: (...a: unknown[]) => joinSharedSession(...a),
}));

import { SharedSessionInvite } from '@/components/social/SharedSessionInvite';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const DETAILS = {
  ok: true,
  sessionId: 's1',
  createdBy: 'host',
  message: 'Join my cognitive session',
  participants: [
    { name: 'Alice', sharingDomains: [], sharingLevel: 'full' },
    { name: 'Bob', sharingDomains: [], sharingLevel: 'query' },
    { name: 'Carol', sharingDomains: [], sharingLevel: 'none' },
  ],
  // options omitted → component falls back to its built-in sharing levels
  options: {} as { sharingLevels?: { id: 'query' | 'full' | 'none'; label: string; description: string }[] },
};

describe('SharedSessionInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinSharedSession.mockResolvedValue({ ok: true });
  });
  afterEach(() => cleanup());

  it('shows the not-found state when the session is missing', async () => {
    sharedSessionInviteDetails.mockResolvedValue({ ok: false });
    wrap(<SharedSessionInvite sessionId="s1" />);
    expect(
      await screen.findByText('Session not found or already ended.'),
    ).toBeInTheDocument();
  });

  it('renders invite details, participants and default sharing levels', async () => {
    sharedSessionInviteDetails.mockResolvedValue(DETAILS);
    wrap(<SharedSessionInvite sessionId="s1" />);
    expect(await screen.findByText('Shared Session Invite')).toBeInTheDocument();
    expect(screen.getByText('Join my cognitive session')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Full sharing')).toBeInTheDocument();
    expect(screen.getByText('AI access')).toBeInTheDocument();
    expect(screen.getByText('Chat only')).toBeInTheDocument();
    // default sharing-level options (options.sharingLevels empty → fallback)
    expect(screen.getByText('Full collaboration')).toBeInTheDocument();
    expect(screen.getByText('Just chat')).toBeInTheDocument();
  });

  it('hides domain picker when sharing level is "none"', async () => {
    sharedSessionInviteDetails.mockResolvedValue(DETAILS);
    wrap(<SharedSessionInvite sessionId="s1" />);
    await screen.findByText('Just chat');
    // domain picker visible at default 'query'
    expect(screen.getByText('healthcare')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Just chat'));
    await waitFor(() => expect(screen.queryByText('healthcare')).toBeNull());
  });

  it('toggles domain selection on and off', async () => {
    sharedSessionInviteDetails.mockResolvedValue(DETAILS);
    wrap(<SharedSessionInvite sessionId="s1" />);
    const finance = await screen.findByText('finance');
    fireEvent.click(finance);
    expect(finance.className).toContain('cyan');
    fireEvent.click(finance);
    expect(finance.className).not.toContain('bg-cyan-500/10');
  });

  it('joins the session with chosen domains and level', async () => {
    sharedSessionInviteDetails.mockResolvedValue(DETAILS);
    const onJoined = vi.fn();
    wrap(<SharedSessionInvite sessionId="s1" onJoined={onJoined} />);
    await screen.findByText('finance');
    fireEvent.click(screen.getByText('finance'));
    fireEvent.click(screen.getByText('Full collaboration'));
    fireEvent.click(screen.getByText('Join Session'));
    await waitFor(() =>
      expect(joinSharedSession).toHaveBeenCalledWith('s1', ['finance'], 'full'),
    );
    expect(onJoined).toHaveBeenCalledWith('s1');
  });

  it('keeps the button enabled again after a failed join', async () => {
    sharedSessionInviteDetails.mockResolvedValue(DETAILS);
    joinSharedSession.mockRejectedValue(new Error('nope'));
    wrap(<SharedSessionInvite sessionId="s1" />);
    await screen.findByText('Join Session');
    fireEvent.click(screen.getByText('Join Session'));
    await waitFor(() => expect(joinSharedSession).toHaveBeenCalled());
    expect(await screen.findByText('Join Session')).toBeInTheDocument();
  });

  it('invokes onDeclined when Decline is clicked', async () => {
    sharedSessionInviteDetails.mockResolvedValue(DETAILS);
    const onDeclined = vi.fn();
    wrap(<SharedSessionInvite sessionId="s1" onDeclined={onDeclined} />);
    fireEvent.click(await screen.findByText('Decline'));
    expect(onDeclined).toHaveBeenCalled();
  });

  it('uses server-provided sharing levels when present', async () => {
    sharedSessionInviteDetails.mockResolvedValue({
      ...DETAILS,
      participants: [],
      options: {
        sharingLevels: [
          { id: 'query' as const, label: 'Server Query', description: 'desc' },
        ],
      },
    });
    wrap(<SharedSessionInvite sessionId="s1" />);
    expect(await screen.findByText('Server Query')).toBeInTheDocument();
  });
});
