/**
 * MU1 (V1.1 R6 multi-user collaboration) — useYjsAwareness pins:
 *   1. collaborators starts empty (`[]`), never a demo/fake entry.
 *   2. a real peer's Awareness update (real y-protocols encode/apply,
 *      only the Socket.IO transport is mocked) surfaces them in
 *      `collaborators` with the right shape.
 *   3. a malformed/field-less remote state (no `userId`) is filtered
 *      out — never rendered as a fabricated collaborator.
 *   4. setCursor publishes a real, decodable awareness update carrying
 *      this client's own identity + cursor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';

type Handler = (payload: unknown) => void;

const { handlers, onMock, offMock, emitMock, connectMock, socketState } = vi.hoisted(() => {
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
  return { handlers, onMock, offMock, emitMock, connectMock, socketState };
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

import { useYjsAwareness, colorForCollaborator } from '@/hooks/useYjsAwareness';

function triggerSocketEvent(event: string, payload: unknown) {
  const set = handlers.get(event);
  set?.forEach((cb) => cb(payload));
}

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

describe('useYjsAwareness', () => {
  beforeEach(() => {
    handlers.clear();
    onMock.mockClear();
    offMock.mockClear();
    emitMock.mockClear();
    connectMock.mockClear();
    socketState.connected = true;
  });

  it('starts with an empty collaborators list — never a fabricated demo cursor', () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: 'doc-1', doc, userId: 'user_me', displayName: 'Me' })
    );
    expect(result.current.collaborators).toEqual([]);
  });

  it('joins the room and requests the current awareness snapshot on mount', () => {
    const doc = new Y.Doc();
    renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: 'doc-1', doc, userId: 'user_me', displayName: 'Me' })
    );
    expect(emitMock).toHaveBeenCalledWith('room:join', { room: 'code:liveshare:doc-1' });
    expect(emitMock).toHaveBeenCalledWith('yjs:awareness-request', { scope: 'code:liveshare', docId: 'doc-1' });
  });

  it('surfaces a real remote peer announced via yjs:awareness-update', async () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: 'doc-1', doc, userId: 'user_me', displayName: 'Me' })
    );
    expect(result.current.collaborators).toEqual([]);

    // A real peer, driven through the real Yjs Awareness protocol —
    // only the socket transport around it is mocked.
    const bobDoc = new Y.Doc();
    const bobAwareness = new Awareness(bobDoc);
    const bobState = {
      userId: 'user_bob',
      displayName: 'Bob',
      color: 'hsl(200, 70%, 55%)',
      cursor: { path: 'main.js', anchor: 42, head: 47 },
      lastSeen: Date.now(),
    };
    bobAwareness.setLocalState(bobState);
    const update = encodeAwarenessUpdate(bobAwareness, [bobAwareness.clientID]);

    act(() => {
      triggerSocketEvent('yjs:awareness-update', {
        scope: 'code:liveshare', docId: 'doc-1', update: b64(update),
      });
    });

    await waitFor(() => expect(result.current.collaborators.length).toBe(1));
    expect(result.current.collaborators[0]).toMatchObject(bobState);

    bobAwareness.destroy();
  });

  it('never surfaces a remote state missing userId — filtered, not fabricated', async () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: 'doc-1', doc, userId: 'user_me', displayName: 'Me' })
    );

    const strangerDoc = new Y.Doc();
    const strangerAwareness = new Awareness(strangerDoc);
    // Malformed / field-less state — no userId at all.
    strangerAwareness.setLocalState({ foo: 'bar' });
    const update = encodeAwarenessUpdate(strangerAwareness, [strangerAwareness.clientID]);

    act(() => {
      triggerSocketEvent('yjs:awareness-update', {
        scope: 'code:liveshare', docId: 'doc-1', update: b64(update),
      });
    });

    // Give the effect a tick to process, then assert nothing fabricated appeared.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.collaborators).toEqual([]);

    strangerAwareness.destroy();
  });

  it('ignores an awareness-update for a different scope/docId', async () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: 'doc-1', doc, userId: 'user_me', displayName: 'Me' })
    );

    const otherDoc = new Y.Doc();
    const otherAwareness = new Awareness(otherDoc);
    otherAwareness.setLocalState({ userId: 'user_other', displayName: 'Other', color: '#000', cursor: null, lastSeen: Date.now() });
    const update = encodeAwarenessUpdate(otherAwareness, [otherAwareness.clientID]);

    act(() => {
      triggerSocketEvent('yjs:awareness-update', {
        scope: 'collab:doc', docId: 'doc-1', update: b64(update), // wrong scope
      });
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.collaborators).toEqual([]);

    otherAwareness.destroy();
  });

  it('setCursor publishes a real, decodable awareness update carrying this client identity + cursor', () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: 'doc-1', doc, userId: 'user_me', displayName: 'Me', color: '#123456' })
    );
    emitMock.mockClear();

    act(() => { result.current.setCursor({ path: 'app.tsx', anchor: 10, head: 12 }); });

    const call = emitMock.mock.calls.find((c) => c[0] === 'yjs:awareness-update');
    expect(call).toBeTruthy();
    const payload = call![1] as { scope: string; docId: string; update: string };
    expect(payload.scope).toBe('code:liveshare');
    expect(payload.docId).toBe('doc-1');

    // Decode the real bytes into a fresh Awareness and confirm the
    // published state really carries our identity + cursor — not a
    // re-derived or reshaped payload.
    const checkDoc = new Y.Doc();
    const checkAwareness = new Awareness(checkDoc);
    const decodeBytes = Uint8Array.from(atob(payload.update), (c) => c.charCodeAt(0));
    applyAwarenessUpdate(checkAwareness, decodeBytes, 'remote');
    const states = Array.from(checkAwareness.getStates().values());
    const mine = states.find((s: unknown) => (s as Record<string, unknown>)?.userId === 'user_me');
    expect(mine).toMatchObject({
      userId: 'user_me', displayName: 'Me', color: '#123456',
      cursor: { path: 'app.tsx', anchor: 10, head: 12 },
    });

    checkAwareness.destroy();
  });

  it('never fabricates when disabled or docId is null', () => {
    const doc = new Y.Doc();
    const { result: r1 } = renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: null, doc, userId: 'user_me', displayName: 'Me' })
    );
    expect(r1.current.collaborators).toEqual([]);

    const { result: r2 } = renderHook(() =>
      useYjsAwareness({ scope: 'code:liveshare', docId: 'doc-1', doc: null, userId: 'user_me', displayName: 'Me' })
    );
    expect(r2.current.collaborators).toEqual([]);
  });

  it('colorForCollaborator is deterministic per userId', () => {
    expect(colorForCollaborator('user_alice')).toBe(colorForCollaborator('user_alice'));
    expect(colorForCollaborator('user_alice')).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
  });
});
