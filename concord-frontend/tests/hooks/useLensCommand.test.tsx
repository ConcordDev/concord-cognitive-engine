import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';

const registerShortcut = vi.fn();
const unregisterShortcut = vi.fn();
const useHotkeysSpy = vi.fn();

vi.mock('@/lib/keyboard', () => ({
  useKeyboard: () => ({ registerShortcut, unregisterShortcut, isShortcutEnabled: () => true }),
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: (...args: unknown[]) => useHotkeysSpy(...args),
}));

import { useLensCommand } from '@/hooks/useLensCommand';

describe('useLensCommand', () => {
  beforeEach(() => {
    registerShortcut.mockClear();
    unregisterShortcut.mockClear();
    useHotkeysSpy.mockClear();
  });

  it('registers each command with a lens-namespaced id', () => {
    renderHook(() =>
      useLensCommand(
        [
          { id: 'send', keys: 'mod+enter', description: 'Send', action: () => {} },
          { id: 'search', keys: '/', description: 'Search', action: () => {} },
        ],
        { lensId: 'chat' },
      ),
    );

    expect(registerShortcut).toHaveBeenCalledTimes(2);
    expect(registerShortcut.mock.calls[0][0]).toMatchObject({
      id: 'lens:chat:send',
      keys: 'mod+enter',
      description: 'Send',
    });
    expect(registerShortcut.mock.calls[1][0]).toMatchObject({
      id: 'lens:chat:search',
      keys: '/',
    });
  });

  it('unregisters each command id on unmount', () => {
    const { unmount } = renderHook(() =>
      useLensCommand(
        [{ id: 'send', keys: 'mod+enter', description: 'Send', action: () => {} }],
        { lensId: 'chat' },
      ),
    );

    expect(registerShortcut).toHaveBeenCalled();
    unmount();
    expect(unregisterShortcut).toHaveBeenCalledWith('lens:chat:send');
  });

  it('namespaces collisions across two lenses without crosstalk', () => {
    renderHook(() =>
      useLensCommand([{ id: 'send', keys: 'mod+enter', description: 'Send chat', action: () => {} }], {
        lensId: 'chat',
      }),
    );
    renderHook(() =>
      useLensCommand([{ id: 'send', keys: 'mod+enter', description: 'Send message', action: () => {} }], {
        lensId: 'message',
      }),
    );

    const ids = registerShortcut.mock.calls.map((c) => c[0].id);
    expect(ids).toContain('lens:chat:send');
    expect(ids).toContain('lens:message:send');
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('routes the registered action through a stable indirection so action identity changes don\'t re-register', () => {
    const action1 = vi.fn();
    const action2 = vi.fn();

    const { rerender } = renderHook(
      ({ action }: { action: () => void }) =>
        useLensCommand(
          [{ id: 'send', keys: 'mod+enter', description: 'Send', action }],
          { lensId: 'chat' },
        ),
      { initialProps: { action: action1 } },
    );

    const firstCall = registerShortcut.mock.calls[0][0];
    firstCall.action();
    expect(action1).toHaveBeenCalledTimes(1);
    expect(action2).not.toHaveBeenCalled();

    // Swap the action — registerShortcut count must NOT grow because shape didn't change.
    const callsBefore = registerShortcut.mock.calls.length;
    rerender({ action: action2 });
    expect(registerShortcut.mock.calls.length).toBe(callsBefore);

    // But the indirection should now route to the new action.
    firstCall.action();
    expect(action2).toHaveBeenCalledTimes(1);
  });
});
