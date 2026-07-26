/**
 * WorkspaceRoomsPanel — V1.2 Wave A (Society & Presence), capability 3.
 *
 * Pins the discovery surface wired to the three real `workspace.*` macros
 * (server/domains/workspace-rooms.js): the create form submits a real
 * lensRun('workspace', 'create-room', ...) call, the district-scoped list
 * renders exactly what `workspace.list-in-district` returns (no fabricated
 * rows), the "My rooms" tab renders what `workspace.list-mine` returns, and
 * selecting a room mounts the real <SharedWorkspaceRoom> (mocked here only
 * because its own test file already proves it against the real Yjs API —
 * this test's job is the discovery layer around it, not re-proving Yjs
 * sync).
 *
 * lensRun resolves to `{ data: { ok, result, error } }` per
 * lib/api/client.ts's envelope-unwrap contract — same mock shape used by
 * tests/society-lens-states.test.tsx.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user_me', username: 'Me' }, isLoading: false, isAuthenticated: true }),
}));

// The real SharedWorkspaceRoom is proven against the actual Yjs API in its
// own test file (tests/components/SharedWorkspaceRoom.test.tsx). Here we
// only need to know the panel hands it the right roomId/userId/displayName
// once a room is selected — stub it to a simple probe.
vi.mock('@/components/workspace/SharedWorkspaceRoom', () => ({
  SharedWorkspaceRoom: (props: { roomId: string; userId: string; displayName: string }) => (
    <div data-testid="shared-workspace-room">
      room={props.roomId} user={props.userId} name={props.displayName}
    </div>
  ),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { WorkspaceRoomsPanel } from '@/components/workspace/WorkspaceRoomsPanel';

const ROOM_A = { id: 'wr_aaa', name: 'Roadmap sync', owner_id: 'user_me', world_id: 'concordia-hub', district_id: 'concordia-hub', created_at: 1000 };
const ROOM_B = { id: 'wr_bbb', name: "Bob's notes", owner_id: 'user_bob', world_id: 'concordia-hub', district_id: 'concordia-hub', created_at: 900 };

function mockLensRun(opts: {
  nearby?: unknown[];
  mine?: unknown[];
  onCreate?: (input: Record<string, unknown>) => { ok: boolean; room?: unknown };
}) {
  lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
    if (domain === 'workspace' && action === 'list-in-district') {
      return Promise.resolve({ data: { ok: true, result: { ok: true, rooms: opts.nearby || [] }, error: null } });
    }
    if (domain === 'workspace' && action === 'list-mine') {
      return Promise.resolve({ data: { ok: true, result: { ok: true, rooms: opts.mine || [] }, error: null } });
    }
    if (domain === 'workspace' && action === 'create-room') {
      const r = opts.onCreate ? opts.onCreate(input) : { ok: true, room: ROOM_A };
      if (r.ok) return Promise.resolve({ data: { ok: true, result: { ok: true, room: r.room }, error: null } });
      return Promise.resolve({ data: { ok: false, result: null, error: 'lens error' } });
    }
    return Promise.resolve({ data: { ok: false, result: null, error: 'unhandled in test' } });
  });
}

describe('WorkspaceRoomsPanel', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders an honest empty state for both tabs when no rooms exist', async () => {
    mockLensRun({ nearby: [], mine: [] });
    render(<WorkspaceRoomsPanel />);

    expect(await screen.findByText(/No rooms in this district yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'My rooms' }));
    expect(await screen.findByText(/haven.t created a room yet/)).toBeInTheDocument();
  });

  it('renders the real rooms list-in-district returns — no fabricated rows', async () => {
    mockLensRun({ nearby: [ROOM_A, ROOM_B], mine: [] });
    render(<WorkspaceRoomsPanel />);

    expect(await screen.findByText('Roadmap sync')).toBeInTheDocument();
    expect(screen.getByText("Bob's notes")).toBeInTheDocument();
  });

  it('"My rooms" tab renders exactly what list-mine returns, distinct from the district list', async () => {
    mockLensRun({ nearby: [ROOM_B], mine: [ROOM_A] });
    render(<WorkspaceRoomsPanel />);

    expect(await screen.findByText("Bob's notes")).toBeInTheDocument();
    expect(screen.queryByText('Roadmap sync')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'My rooms' }));
    expect(await screen.findByText('Roadmap sync')).toBeInTheDocument();
    expect(screen.queryByText("Bob's notes")).not.toBeInTheDocument();
  });

  it('the create form calls workspace.create-room with the typed name + district, then mounts the room', async () => {
    mockLensRun({ nearby: [], mine: [], onCreate: (input) => {
      expect(input.name).toBe('Sprint planning');
      expect(input.worldId).toBe('concordia-hub');
      expect(input.districtId).toBe('plaza');
      return { ok: true, room: { ...ROOM_A, id: 'wr_new', name: 'Sprint planning', district_id: 'plaza' } };
    } });
    render(<WorkspaceRoomsPanel worldId="concordia-hub" districtId="concordia-hub" />);

    await screen.findByText(/No rooms in this district yet/);

    fireEvent.change(screen.getByPlaceholderText('Room name'), { target: { value: 'Sprint planning' } });
    fireEvent.change(screen.getByPlaceholderText('District (optional)'), { target: { value: 'plaza' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    const mounted = await screen.findByTestId('shared-workspace-room');
    expect(mounted).toHaveTextContent('room=wr_new');
    expect(mounted).toHaveTextContent('user=user_me');
    expect(mounted).toHaveTextContent('name=Me');
  });

  it('surfaces a real error and does not mount a room when create-room fails', async () => {
    mockLensRun({ nearby: [], mine: [], onCreate: () => ({ ok: false }) });
    render(<WorkspaceRoomsPanel />);
    await screen.findByText(/No rooms in this district yet/);

    fireEvent.change(screen.getByPlaceholderText('Room name'), { target: { value: 'Will fail' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    expect(await screen.findByText(/Could not create room|lens error/)).toBeInTheDocument();
    expect(screen.queryByTestId('shared-workspace-room')).not.toBeInTheDocument();
  });

  it('selecting a room from the list mounts SharedWorkspaceRoom with that room id, then Back returns to the list', async () => {
    mockLensRun({ nearby: [ROOM_A], mine: [] });
    render(<WorkspaceRoomsPanel />);

    fireEvent.click(await screen.findByText('Roadmap sync'));
    const mounted = await screen.findByTestId('shared-workspace-room');
    expect(mounted).toHaveTextContent('room=wr_aaa');

    fireEvent.click(screen.getByRole('button', { name: /Back to rooms/ }));
    await waitFor(() => expect(screen.queryByTestId('shared-workspace-room')).not.toBeInTheDocument());
    expect(await screen.findByText('Roadmap sync')).toBeInTheDocument();
  });

  it('the Create button is disabled until a room name is typed', async () => {
    mockLensRun({ nearby: [], mine: [] });
    render(<WorkspaceRoomsPanel />);
    await screen.findByText(/No rooms in this district yet/);

    const createBtn = screen.getByRole('button', { name: /Create/ });
    expect(createBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Room name'), { target: { value: 'X' } });
    expect(createBtn).not.toBeDisabled();
  });
});
