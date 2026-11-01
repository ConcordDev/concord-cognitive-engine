// S14 follow-up — share-dialog membership wiring (PR #1714): invite
// by name at a chosen level calls board-grant, the access list
// renders the model's grants, Revoke calls board-revoke, and boards
// shared with the user list with their level. The domain macros are
// mocked at the client boundary; their real behaviour is pinned by
// server/tests/whiteboard-acl-sharing.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({
  grants: [] as Array<{ granteeId: string; username: string; level: string; grantedAt: string }>,
  calls: [] as Array<{ action: string; input: Record<string, unknown> }>,
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async () => ({ data: { users: [{ id: 'u-eddie', username: 'eddie' }] } })),
    delete: vi.fn(async () => ({})),
  },
  apiHelpers: {
    lens: {
      runDomain: vi.fn(async (_domain: string, action: string, payload: { input: Record<string, unknown> }) => {
        const input = payload.input;
        h.calls.push({ action, input });
        switch (action) {
          case 'templates-list': return { data: { ok: true, result: { templates: [] } } };
          case 'board-list': return { data: { ok: true, result: { boards: [] } } };
          case 'board-shared-with-me': return { data: { ok: true, result: { boards: [{ id: 'board_9', title: 'Olga board', ownerName: 'olga', level: 'view' }] } } };
          case 'board-save': return { data: { ok: true, result: { board: { id: 'board_1' } } } };
          case 'board-access': return { data: { ok: true, result: { level: 'owner', grants: [...h.grants] } } };
          case 'board-grant': {
            const existing = h.grants.findIndex(g => g.granteeId === input.granteeId);
            const row = { granteeId: String(input.granteeId), username: 'eddie', level: String(input.level), grantedAt: '2026-10-29T00:00:00Z' };
            if (existing >= 0) h.grants[existing] = row; else h.grants.push(row);
            return { data: { ok: true, result: { grant: row } } };
          }
          case 'board-revoke': {
            h.grants = h.grants.filter(g => g.granteeId !== input.granteeId);
            return { data: { ok: true, result: { revoked: true } } };
          }
          default: return { data: { ok: true, result: {} } };
        }
      }),
    },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({}),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: (props: { children: React.ReactNode }) => React.createElement(React.Fragment, null, props.children),
}));

import { WhiteboardActionPanel } from '@/components/whiteboard/WhiteboardActionPanel';

beforeEach(() => {
  h.grants = [{ granteeId: 'u-vera', username: 'vera', level: 'view', grantedAt: '2026-10-28T00:00:00Z' }];
  h.calls = [];
});

async function saveABoard(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText('Board name'), { target: { value: 'Roadmap' } });
  const snapshot = container.querySelector('textarea[rows="6"]') as HTMLTextAreaElement;
  fireEvent.change(snapshot, { target: { value: '{"elements":[]}' } });
  fireEvent.click(screen.getByText('Save', { selector: 'div' }).closest('button') as HTMLButtonElement);
  expect(await screen.findByText('People with access')).toBeTruthy();
}

describe('whiteboard share membership (S14 follow-up)', () => {
  it('lists boards shared with the user, with their level', async () => {
    render(<WhiteboardActionPanel />);
    expect(await screen.findByText('Shared with you')).toBeTruthy();
    expect(screen.getByText(/shared by olga · can view/)).toBeTruthy();
  });

  it('renders the access list for the saved board and revokes in one click', async () => {
    const { container } = render(<WhiteboardActionPanel />);
    await saveABoard(container);
    expect(await screen.findByText('vera')).toBeTruthy();
    fireEvent.click(screen.getByText('Revoke'));
    const revoke = h.calls.find(c => c.action === 'board-revoke');
    expect(revoke?.input).toMatchObject({ boardId: 'board_1', granteeId: 'u-vera' });
    expect(await screen.findByText(/Only you/)).toBeTruthy();
  });

  it('invites by name at the chosen level', async () => {
    const { container } = render(<WhiteboardActionPanel />);
    await saveABoard(container);
    fireEvent.change(screen.getByLabelText('Invite by name'), { target: { value: 'ed' } });
    fireEvent.click(await screen.findByText(/Invite/));
    const grant = h.calls.find(c => c.action === 'board-grant');
    expect(grant?.input).toMatchObject({ boardId: 'board_1', granteeId: 'u-eddie', level: 'view' });
    expect(await screen.findByText(/eddie can now view this board/)).toBeTruthy();
  });
});
