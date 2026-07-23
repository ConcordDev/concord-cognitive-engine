/**
 * MU2 (V1.1 R6 multi-user collaboration) — SharedWorkspaceRoom pins:
 *   1. An empty room renders an honest empty state (no fabricated
 *      collaborators or DTUs).
 *   2. The rendered DTU list reflects the real `Y.Array` content —
 *      pushing directly onto the array (as a remote peer's sync would)
 *      updates the UI via the real `.observe()` wiring.
 *   3. Clicking "Add" from the Workspace Bus performs a real `.push()`
 *      CRDT operation on the shared doc (not a client-only list).
 *   4. Clicking the remove (×) button performs a real `.delete()` CRDT
 *      operation on the shared doc.
 *   5. Live presence surfaces a REAL remote collaborator driven through
 *      the actual y-protocols Awareness encode/apply path (only the
 *      Socket.IO transport is mocked, mirroring
 *      tests/hooks/useYjsAwareness.test.ts) — never a fabricated name.
 *
 * `useYjsDoc` is mocked to hand the component a real, locally-constructed
 * `Y.Doc` (it otherwise opens its own private socket.io-client connection
 * outside the app's shared `useSocket` layer, which has no server to
 * dial in a unit test) — but every operation performed ON that doc below
 * is the real Yjs API, and `useYjsAwareness` itself is NOT mocked: it
 * runs for real against a mocked `useSocket`, exactly like its own test
 * file does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';

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

type Handler = (payload: unknown) => void;

const { handlers, onMock, offMock, emitMock, connectMock, socketState, mockUseYjsDoc } = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  const onMock = vi.fn((event: string, cb: Handler) => {
    let set = handlers.get(event);
    if (!set) { set = new Set(); handlers.set(event, set); }
    set.add(cb);
  });
  const offMock = vi.fn((event: string, cb?: Handler) => {
    const set = handlers.get(event);
    if (!set) return;
    if (cb) set.delete(cb); else set.clear();
  });
  const emitMock = vi.fn();
  const connectMock = vi.fn();
  const socketState = { connected: true };
  const mockUseYjsDoc = vi.fn();
  return { handlers, onMock, offMock, emitMock, connectMock, socketState, mockUseYjsDoc };
});

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({
    socket: socketState,
    isConnected: socketState.connected,
    status: socketState.connected ? 'connected' : 'connecting',
    connect: connectMock,
    disconnect: vi.fn(),
    emit: emitMock,
    on: onMock,
    off: offMock,
  }),
}));

vi.mock('@/lib/hooks/useYjsDoc', () => ({
  useYjsDoc: mockUseYjsDoc,
}));

import { KeyboardProvider } from '@/lib/keyboard';
import {
  WorkspaceBusProvider,
  useWorkspaceBus,
  type WorkspaceBusApi,
  type WorkspaceBusDTU,
} from '@/components/workspace-bus';
import { SharedWorkspaceRoom, SHARED_WORKSPACE_ARRAY_KEY } from '@/components/workspace/SharedWorkspaceRoom';

function triggerSocketEvent(event: string, payload: unknown) {
  const set = handlers.get(event);
  set?.forEach((cb) => cb(payload));
}

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function BusHarness({ onApi, children }: { onApi: (api: WorkspaceBusApi) => void; children: React.ReactNode }) {
  const api = useWorkspaceBus();
  onApi(api);
  return <>{children}</>;
}

function renderRoom(props: Partial<React.ComponentProps<typeof SharedWorkspaceRoom>> = {}) {
  let busApi!: WorkspaceBusApi;
  const utils = render(
    <KeyboardProvider>
      <WorkspaceBusProvider>
        <BusHarness onApi={(api) => { busApi = api; }}>
          <SharedWorkspaceRoom
            roomId="room-1"
            userId="user_me"
            displayName="Me"
            {...props}
          />
        </BusHarness>
      </WorkspaceBusProvider>
    </KeyboardProvider>
  );
  return { ...utils, getBusApi: () => busApi };
}

const sampleDTU: WorkspaceBusDTU = {
  id: 'dtu-shared-1',
  kind: 'regular',
  title: 'Q3 Revenue Forecast',
  summary: 'A forecast DTU.',
  domain: 'finance',
  citation: { allowCitation: true, visibility: 'public' },
};

describe('SharedWorkspaceRoom', () => {
  let testDoc: Y.Doc;

  beforeEach(() => {
    handlers.clear();
    onMock.mockClear();
    offMock.mockClear();
    emitMock.mockClear();
    connectMock.mockClear();
    socketState.connected = true;
    testDoc = new Y.Doc();
    mockUseYjsDoc.mockReturnValue({ doc: testDoc, synced: true, socketReady: true, resetVersion: 0 });
  });

  it('renders an honest empty state — no fabricated DTUs or collaborators', () => {
    renderRoom();
    expect(screen.getByText(/No DTUs shared here yet/)).toBeInTheDocument();
    expect(screen.getByText(/Only you here right now/)).toBeInTheDocument();
  });

  it('reflects the real Y.Array content, including a remote-style push applied directly to the doc', () => {
    renderRoom();
    expect(screen.queryByText('Q3 Revenue Forecast')).not.toBeInTheDocument();

    act(() => {
      testDoc.getArray(SHARED_WORKSPACE_ARRAY_KEY).push([{
        id: 'dtu-remote-1', title: 'Remote-added DTU', kind: 'regular',
        addedBy: 'user_bob', addedByName: 'Bob', addedAt: Date.now(),
      }]);
    });

    expect(screen.getByText('Remote-added DTU')).toBeInTheDocument();
    expect(screen.getByText(/added by Bob/)).toBeInTheDocument();
  });

  it('"Add" from the Workspace Bus performs a real Y.Array push, not a client-only list append', () => {
    const { getBusApi } = renderRoom();
    act(() => { getBusApi().publish(sampleDTU); });

    const addBtn = screen.getByRole('button', { name: /Add/ });
    fireEvent.click(addBtn);

    const arr = testDoc.getArray(SHARED_WORKSPACE_ARRAY_KEY).toArray() as Array<{ id: string; addedBy: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe('dtu-shared-1');
    expect(arr[0].addedBy).toBe('user_me');
    expect(screen.getByText('Q3 Revenue Forecast')).toBeInTheDocument();
  });

  it('does not double-add the same DTU id when clicked twice', () => {
    const { getBusApi } = renderRoom();
    act(() => { getBusApi().publish(sampleDTU); });

    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    // After the first add, the bus-side "Add" row for this DTU disappears
    // (it's already shared) — confirms the UI derives from the real array,
    // and there is nothing left to double-click.
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
    expect(testDoc.getArray(SHARED_WORKSPACE_ARRAY_KEY).toArray()).toHaveLength(1);
  });

  it('the remove (×) button performs a real Y.Array delete', () => {
    act(() => {
      testDoc.getArray(SHARED_WORKSPACE_ARRAY_KEY).push([{
        id: 'dtu-x', title: 'Removable DTU', kind: 'regular',
        addedBy: 'user_me', addedByName: 'Me', addedAt: 42,
      }]);
    });
    renderRoom();
    expect(screen.getByText('Removable DTU')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Remove Removable DTU from this room/ }));

    expect(testDoc.getArray(SHARED_WORKSPACE_ARRAY_KEY).toArray()).toHaveLength(0);
    expect(screen.queryByText('Removable DTU')).not.toBeInTheDocument();
    expect(screen.getByText(/No DTUs shared here yet/)).toBeInTheDocument();
  });

  it('surfaces a real remote collaborator via the actual Awareness protocol (only transport mocked)', async () => {
    renderRoom();
    expect(screen.getByText(/Only you here right now/)).toBeInTheDocument();

    const bobDoc = new Y.Doc();
    const bobAwareness = new Awareness(bobDoc);
    const bobState = { userId: 'user_bob', displayName: 'Bob', color: 'hsl(10, 70%, 55%)', cursor: null, lastSeen: Date.now() };
    bobAwareness.setLocalState(bobState);
    const update = encodeAwarenessUpdate(bobAwareness, [bobAwareness.clientID]);

    act(() => {
      triggerSocketEvent('yjs:awareness-update', { scope: 'workspace:room', docId: 'room-1', update: b64(update) });
    });

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText(/Only you here right now/)).not.toBeInTheDocument();

    bobAwareness.destroy();
  });

  it('the "appear offline" toggle flips to a visibly distinct pressed state', () => {
    renderRoom();
    const toggle = screen.getByRole('button', { name: /Visible in room/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    const toggled = screen.getByRole('button', { name: /Appearing offline/ });
    expect(toggled).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an honest message when the Workspace Bus is empty', () => {
    renderRoom();
    expect(within(screen.getByText(/Add from your Workspace Bus/).closest('div')!).getByText(/Your Workspace Bus is empty/)).toBeInTheDocument();
  });
});
