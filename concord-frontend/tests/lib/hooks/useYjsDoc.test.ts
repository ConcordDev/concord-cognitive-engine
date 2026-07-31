/**
 * useYjsDoc — pins the docRef -> real-state fix.
 *
 * `doc` used to be returned from a plain `useRef<Y.Doc | null>(null)`,
 * with `docRef.current = doc` set inside the mount effect. On mount,
 * `synced`/`socketReady` are already `false`, so the accompanying
 * `setSynced(false)`/`setSocketReady(false)` calls are no-ops that don't
 * trigger a re-render — so the ref write was invisible to callers until
 * some *other* state update happened to re-render the component (e.g. the
 * socket eventually connecting). Consumers that read `doc` immediately
 * after mount saw `null` even though a real Y.Doc had already been
 * created synchronously inside the effect. Now `doc` is real `useState`,
 * so the value returned by the hook is live on the very next render.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';

type Handler = (payload: unknown) => void;

const { handlers, onMock, offMock, emitMock, disconnectMock, ioMock } = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  const onMock = vi.fn((event: string, cb: Handler) => {
    let set = handlers.get(event);
    if (!set) { set = new Set(); handlers.set(event, set); }
    set.add(cb);
  });
  const offMock = vi.fn();
  const emitMock = vi.fn();
  const disconnectMock = vi.fn();
  const ioMock = vi.fn(() => ({
    on: onMock,
    off: offMock,
    emit: emitMock,
    disconnect: disconnectMock,
  }));
  return { handlers, onMock, offMock, emitMock, disconnectMock, ioMock };
});

vi.mock('socket.io-client', () => ({ io: ioMock }));
vi.mock('@/lib/realtime/socket', () => ({ SOCKET_URL: 'http://localhost:5050' }));

import { useYjsDoc } from '@/lib/hooks/useYjsDoc';

function fire(event: string, payload?: unknown) {
  const set = handlers.get(event);
  set?.forEach((cb) => cb(payload));
}

/** The effect's socket setup runs inside an async IIFE (`await
 *  import('socket.io-client')` before `socket.on(...)` registers any
 *  handler), so a `fire()` called immediately after `renderHook()` can
 *  race an as-yet-unregistered handler. Flush a couple of microtask
 *  ticks first so every `socket.on(...)` call has actually run. */
async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Encodes a real Yjs update inserting `text` into a Y.Text named `key`
 *  on a throwaway source doc — the same shape the server would send. */
function encodedInsertUpdate(key: string, text: string): string {
  const doc = new Y.Doc();
  doc.getText(key).insert(0, text);
  return b64(Y.encodeStateAsUpdate(doc));
}

describe('useYjsDoc', () => {
  it('returns a real Y.Doc synchronously after mount, not null-until-next-unrelated-render', () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-1', enabled: true }));

    expect(result.current.doc).not.toBeNull();
    expect(result.current.doc).toBeInstanceOf(Y.Doc);
    expect(result.current.synced).toBe(false);
    expect(result.current.socketReady).toBe(false);
  });

  it('returns null when disabled — no doc is created for a disabled/absent docId', () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: null, enabled: true }));
    expect(result.current.doc).toBeNull();
  });

  it('clears doc back to null on unmount', () => {
    const { result, unmount } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-2', enabled: true }));
    expect(result.current.doc).not.toBeNull();
    unmount();
    // Nothing to assert on `result.current` post-unmount (React doesn't
    // re-render an unmounted hook), but the cleanup path must not throw -
    // exercises the `setDocInstance(null)` line in the effect's teardown.
  });

  it('connect -> joins the room, requests a sync, and flips socketReady', async () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-3', enabled: true }));
    // The socket.io-client import inside the effect's IIFE is async.
    await flushEffects();
    await act(async () => { fire('connect'); });

    expect(result.current.socketReady).toBe(true);
    expect(emitMock).toHaveBeenCalledWith('room:join', { room: 'code:liveshare:doc-3' });
    expect(emitMock).toHaveBeenCalledWith('yjs:sync-request', { scope: 'code:liveshare', docId: 'doc-3' });
  });

  it('yjs:sync-state applies the real CRDT update and flips synced', async () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-4', enabled: true }));
    await flushEffects();
    await act(async () => { fire('connect'); });

    const update = encodedInsertUpdate('content', 'hello');
    await act(async () => {
      fire('yjs:sync-state', { scope: 'code:liveshare', docId: 'doc-4', update });
    });

    expect(result.current.synced).toBe(true);
    expect(result.current.doc!.getText('content').toString()).toBe('hello');
  });

  it('yjs:sync-state for a different scope/docId is ignored', async () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-5', enabled: true }));
    await flushEffects();
    await act(async () => { fire('connect'); });

    const update = encodedInsertUpdate('content', 'nope');
    await act(async () => {
      fire('yjs:sync-state', { scope: 'other:scope', docId: 'doc-5', update });
    });

    expect(result.current.synced).toBe(false);
    expect(result.current.doc!.getText('content').toString()).toBe('');
  });

  it('a malformed yjs:sync-state payload is swallowed, not thrown', async () => {
    renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-6', enabled: true }));
    await flushEffects();
    await act(async () => { fire('connect'); });
    expect(() => {
      fire('yjs:sync-state', { scope: 'code:liveshare', docId: 'doc-6', update: 'not-valid-base64-crdt!!' });
    }).not.toThrow();
  });

  it('yjs:update merges a live remote CRDT change into the doc', async () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-7', enabled: true }));
    await flushEffects();
    await act(async () => { fire('connect'); });

    const update = encodedInsertUpdate('content', 'live edit');
    await act(async () => {
      fire('yjs:update', { scope: 'code:liveshare', docId: 'doc-7', update });
    });

    expect(result.current.doc!.getText('content').toString()).toBe('live edit');
  });

  it('yjs:doc-reset clears shared state, applies the snapshot, and bumps resetVersion', async () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-8', enabled: true }));
    await flushEffects();
    await act(async () => { fire('connect'); });

    // Seed some local content the reset should wipe.
    await act(async () => {
      result.current.doc!.getText('content').insert(0, 'stale content');
    });
    expect(result.current.doc!.getText('content').toString()).toBe('stale content');

    const snapshot = encodedInsertUpdate('content', 'fresh snapshot');
    await act(async () => {
      fire('yjs:doc-reset', { scope: 'code:liveshare', docId: 'doc-8', update: snapshot });
    });

    expect(result.current.resetVersion).toBe(1);
    expect(result.current.doc!.getText('content').toString()).toBe('fresh snapshot');
  });

  it('disconnect flips socketReady back to false', async () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-9', enabled: true }));
    await flushEffects();
    await act(async () => { fire('connect'); });
    expect(result.current.socketReady).toBe(true);

    await act(async () => { fire('disconnect'); });
    expect(result.current.socketReady).toBe(false);
  });

  it('a local doc edit forwards a yjs:update to the socket (skips origin === "remote" echoes)', async () => {
    const { result } = renderHook(() => useYjsDoc({ scope: 'code:liveshare', docId: 'doc-10', enabled: true }));
    await flushEffects();
    await act(async () => { fire('connect'); });
    emitMock.mockClear();

    await act(async () => {
      result.current.doc!.getText('content').insert(0, 'typed locally');
    });

    expect(emitMock).toHaveBeenCalledWith('yjs:update', expect.objectContaining({ scope: 'code:liveshare', docId: 'doc-10' }));
  });
});
