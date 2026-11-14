/**
 * FIX-collab-001 C1 + the FE half of C2/C3.
 *
 * C1: the Collab lens page mounts the floor — the Documents and
 * Sessions substrate components (CollabDocWorkspace, CollabHub) were
 * built and tested but imported by no production surface; the lens's
 * only route was the rooms page. These pins prove the views are
 * reachable from the lens entry.
 *
 * C2/C3 FE: a room shared with the signed-in user rides room-list
 * marked shared (no Delete — close is the owner's), the sharing panel
 * renders the roster/presence/discussion, the owner's invite form
 * posts room-invite at the chosen tier, and a pending room invitation
 * can be accepted from the lens.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/collab/CollabDocWorkspace', () => ({
  CollabDocWorkspace: () => React.createElement('div', { 'data-testid': 'doc-workspace-marker' }, 'DOC WORKSPACE'),
}));
vi.mock('@/components/collab/CollabHub', () => ({
  CollabHub: () => React.createElement('div', { 'data-testid': 'hub-marker' }, 'SESSIONS HUB'),
}));

import CollabLensPage from '@/app/lenses/collab/page';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

interface MockState {
  rooms: { id: string; title: string; shared?: boolean; myTier?: string }[];
  invites: { id: string; roomId: string; roomTitle: string; tier: string; status: string }[];
  calls: { name: string; input: Record<string, unknown> }[];
}

function installMock(state: MockState) {
  lensRun.mockImplementation(async (_domain: string, name: string, input: Record<string, unknown>) => {
    state.calls.push({ name, input });
    switch (name) {
      case 'room-list':
        return ok({ rooms: state.rooms, count: state.rooms.length });
      case 'room-detail':
        return ok({ room: { id: input.id, title: 'Jam room', note: 'shared note' } });
      case 'room-invite-list':
        return ok({ invitations: state.invites, scope: 'received', total: state.invites.length });
      case 'room-invite-respond':
        return ok({ invite: { id: input.inviteId, status: input.accept ? 'accepted' : 'declined' }, room: { id: 'r1', title: 'Jam room' } });
      case 'room-members':
        return ok({
          owner: { displayName: 'Owner', isOwner: false },
          members: [{ userId: 'user_member', displayName: 'Member', tier: 'comment', status: 'accepted', isMine: false }],
          myTier: 'edit',
          isOwner: true,
          memberCount: 1,
        });
      case 'room-invite':
        return ok({ invite: { id: 'rinv_1', status: 'pending' } });
      case 'room-comment-list':
        return ok({ comments: [{ id: 'c1', authorName: 'Member', text: 'hello room', createdAt: 1 }], total: 1 });
      case 'room-comment-add':
        return ok({ comment: { id: 'c2', authorName: 'Owner', text: String(input.text), createdAt: 2 } });
      case 'room-presence-update':
        return ok({ presence: [] });
      case 'room-presence-state':
        return ok({ presence: [{ userId: 'user_owner', name: 'Owner', isOwner: true }, { userId: 'user_member', name: 'Member', isOwner: false }], online: 2 });
      default:
        return ok({});
    }
  });
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('collab floor mount + room sharing (FIX-collab-001)', () => {
  it('C1: Documents and Sessions views are reachable from the lens entry', async () => {
    const state: MockState = { rooms: [], invites: [], calls: [] };
    installMock(state);
    const view = render(<CollabLensPage />);
    expect(await view.findByText('No room open.')).toBeInTheDocument();
    fireEvent.click(view.getByTestId('cb-view-documents'));
    expect(await view.findByTestId('doc-workspace-marker')).toBeInTheDocument();
    fireEvent.click(view.getByTestId('cb-view-sessions'));
    expect(await view.findByTestId('hub-marker')).toBeInTheDocument();
    fireEvent.click(view.getByTestId('cb-view-rooms'));
    expect(await view.findByText('No room open.')).toBeInTheDocument();
  });

  it('C2 FE: the owner panel invites at a tier, lists members, and posts to the discussion', async () => {
    const state: MockState = { rooms: [{ id: 'r1', title: 'Jam room' }], invites: [], calls: [] };
    installMock(state);
    const view = render(<CollabLensPage />);
    expect(await view.findByTestId('cb-room-members')).toBeInTheDocument();
    expect(view.getByTestId('cb-room-presence')).toHaveTextContent('Here now: Owner, Member');
    expect(view.getByTestId('cb-room-comments')).toHaveTextContent('hello room');

    fireEvent.change(view.getByTestId('cb-invite-id'), { target: { value: 'user_new' } });
    fireEvent.change(view.getByTestId('cb-invite-tier'), { target: { value: 'comment' } });
    fireEvent.click(view.getByRole('button', { name: 'Invite' }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.name === 'room-invite'
        && c.input.inviteeId === 'user_new' && c.input.tier === 'comment')).toBe(true);
    });

    fireEvent.change(view.getByTestId('cb-comment-input'), { target: { value: 'second thought' } });
    fireEvent.click(view.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.name === 'room-comment-add' && c.input.text === 'second thought')).toBe(true);
    });
  });

  it('C2 FE: a shared room is marked, carries no Delete, and a pending invite can be accepted', async () => {
    const state: MockState = {
      rooms: [{ id: 'r1', title: 'Jam room', shared: true, myTier: 'view' }],
      invites: [{ id: 'rinv_9', roomId: 'r2', roomTitle: 'Other room', tier: 'view', status: 'pending' }],
      calls: [],
    };
    installMock(state);
    const view = render(<CollabLensPage />);
    const roomButton = await view.findByRole('button', { name: /Jam room/ });
    expect(roomButton).toHaveTextContent('shared');
    expect(view.queryByRole('button', { name: 'Delete room' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Edit room' })).not.toBeInTheDocument();

    expect(await view.findByTestId('cb-room-invites')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Accept' }));
    await waitFor(() => {
      expect(state.calls.some((c) => c.name === 'room-invite-respond'
        && c.input.inviteId === 'rinv_9' && c.input.accept === true)).toBe(true);
    });
  });
});
