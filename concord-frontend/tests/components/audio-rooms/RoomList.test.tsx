/**
 * Live Rooms card (job oc-social-3afix item 6, part a+b).
 *
 * Real defects:
 *  - the roster header read "Spaces · live now" — "Spaces" is a banned
 *    trademarked feature name. It now says "Live rooms".
 *  - the card rendered an operator footer ("WebRTC is peer-to-peer.
 *    Strict-NAT clients need a TURN server (set CONCORD_TURN_URL).") to
 *    every user — server config instructions in end-user UI. The footer is
 *    gone; TURN/STUN handling is RoomStage's job via
 *    /api/webrtc/ice-servers.
 *
 * Harness: the real RoomList against a mocked HTTP layer (@/lib/api/client
 * only — the component talks to the spaces macros through /api/lens/run).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: {
    post: vi.fn(async (_url: string, body: Record<string, unknown>) => {
      const macro = `${(body as { domain?: string })?.domain}.${(body as { name?: string })?.name}`;
      if (macro === 'spaces.list_active') {
        return {
          data: {
            ok: true,
            rooms: [
              {
                id: 'r1',
                hostUserId: 'u2',
                title: 'Late night synthesis',
                description: null,
                startedAt: Date.now(),
                endedAt: null,
                speakers: [{ user_id: 'u2', role: 'host', joined_at: Date.now() }],
                listenerCount: 3,
                handsRaised: [{ user_id: 'u3' }],
                isRecording: false,
              },
            ],
          },
        };
      }
      if (macro === 'spaces.join_listener') return { data: { ok: true } };
      return { data: { ok: true } };
    }),
  },
}));

// UserLink does its own profile lookups — not under test here.
vi.mock('@/components/social/UserLink', () => ({
  UserLink: ({ userId }: { userId: string }) => React.createElement('span', null, `@${userId}`),
}));

import { RoomList } from '@/components/audio-rooms/RoomList';

function renderRoomList(props: React.ComponentProps<typeof RoomList>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoomList {...props} />
    </QueryClientProvider>,
  );
}

describe('RoomList (live audio rooms roster)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is headed "Live rooms" — no banned trademarked feature name anywhere', async () => {
    renderRoomList({ currentUserId: 'u1' });
    expect(await screen.findByText('Late night synthesis')).toBeInTheDocument();
    expect(screen.getByText('Live rooms')).toBeInTheDocument();
    expect(screen.queryByText(/Spaces/)).toBeNull();
  });

  it('shows no operator footer — TURN/NAT config instructions are not user UI', async () => {
    renderRoomList({ currentUserId: 'u1' });
    await screen.findByText('Late night synthesis');
    expect(screen.queryByText(/WebRTC is peer-to-peer/i)).toBeNull();
    expect(screen.queryByText(/TURN server/i)).toBeNull();
    expect(screen.queryByText(/CONCORD_TURN_URL/i)).toBeNull();
  });

  it('renders real roster data from the spaces.list_active macro and Join works', async () => {
    const onJoin = vi.fn();
    renderRoomList({ currentUserId: 'u1', onJoin });
    await screen.findByText('Late night synthesis');
    // Honest listener/hands counts from the macro response.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/✋/)).toBeInTheDocument();
    const join = screen.getByRole('button', { name: 'Join' });
    fireEvent.click(join);
    await waitFor(() => expect(onJoin).toHaveBeenCalledWith('r1'));
  });

  it('the empty state stays honest (no fake rooms)', async () => {
    const { api } = await import('@/lib/api/client');
    (api.post as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ data: { ok: true, rooms: [] } }));
    renderRoomList({ currentUserId: 'u1' });
    expect(await screen.findByText('No live rooms right now')).toBeInTheDocument();
  });
});