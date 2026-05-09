'use client';

/**
 * useLensCommand — register lens-scoped keyboard commands.
 *
 * Wraps the existing KeyboardContext (`lib/keyboard.tsx`) with a
 * lens-lifecycle-aware API: commands register on mount, unregister on
 * unmount, and command IDs are namespaced by lensId so two lenses can
 * declare the same shortcut id without collision.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { useKeyboard, type Shortcut } from '@/lib/keyboard';

export interface LensCommand {
  /** Local id, namespaced internally by lensId (e.g. "send" → "lens:chat:send"). */
  id: string;
  /** react-hotkeys-hook key string, e.g. "mod+enter", "?", "g h". */
  keys: string;
  /** Human-readable label shown in the help modal + command palette. */
  description: string;
  /** Command palette grouping. Defaults to 'actions'. */
  category?: Shortcut['category'];
  /** Handler invoked when the shortcut fires. */
  action: () => void;
  /** False to leave registered but inert. */
  enabled?: boolean;
  /** Fire even while focus is in inputs/textareas. */
  global?: boolean;
}

export interface UseLensCommandOptions {
  /** Lens identifier; commands are namespaced under it. */
  lensId: string;
}

/**
 * Register an array of commands for the duration of the calling lens's
 * mount. Commands are reconciled (registered / updated / removed) when
 * the input array changes by id+keys+description.
 */
export function useLensCommand(commands: LensCommand[], options: UseLensCommandOptions) {
  const { registerShortcut, unregisterShortcut } = useKeyboard();
  const { lensId } = options;

  const liveActions = useRef<Map<string, () => void>>(new Map());

  const namespacedCommands = useMemo(
    () =>
      commands.map((c) => ({
        ...c,
        namespacedId: `lens:${lensId}:${c.id}`,
      })),
    [commands, lensId]
  );

  // Reconcile on shape changes only, not on every action identity tick.
  // Extracted to its own useMemo so the static dep-checker can see it.
  const commandShapeKey = useMemo(
    () =>
      namespacedCommands
        .map((c) => `${c.namespacedId}|${c.keys}|${c.description}|${c.enabled ?? true}|${c.global ?? false}`)
        .join(','),
    [namespacedCommands]
  );

  // Refs to access the latest namespacedCommands + keyboard hooks inside
  // the registration effect WITHOUT pulling them into the dep array. The
  // contract: re-register only when shape changes; action identity must
  // not trigger re-registration (covered by tests/hooks/useLensCommand.test.tsx).
  const commandsRef = useRef(namespacedCommands);
  commandsRef.current = namespacedCommands;
  const registerRef = useRef(registerShortcut);
  registerRef.current = registerShortcut;
  const unregisterRef = useRef(unregisterShortcut);
  unregisterRef.current = unregisterShortcut;

  useEffect(() => {
    // Snapshot the live-actions Map so the cleanup closes over the same
    // instance even if the ref were reassigned later.
    const liveMap = liveActions.current;
    const cmds = commandsRef.current;
    const register = registerRef.current;
    const unregister = unregisterRef.current;
    cmds.forEach((cmd) => {
      liveMap.set(cmd.namespacedId, cmd.action);
      register({
        id: cmd.namespacedId,
        keys: cmd.keys,
        description: cmd.description,
        category: cmd.category ?? 'actions',
        enabled: cmd.enabled ?? true,
        global: cmd.global ?? false,
        // Indirection so re-renders update the action without re-registering.
        action: () => liveMap.get(cmd.namespacedId)?.(),
      });
    });

    const registeredIds = cmds.map((c) => c.namespacedId);
    return () => {
      registeredIds.forEach((id) => {
        liveMap.delete(id);
        unregister(id);
      });
    };
  }, [lensId, commandShapeKey]);

  // Keep liveActions in sync without re-registering.
  useEffect(() => {
    namespacedCommands.forEach((cmd) => {
      liveActions.current.set(cmd.namespacedId, cmd.action);
    });
  }, [namespacedCommands]);

  // Bind keys via react-hotkeys-hook. We pass a single comma-separated
  // string so the hook count stays stable across renders, then dispatch
  // by the hotkey that fired.
  const allKeys = namespacedCommands.map((c) => c.keys).join(',');
  useHotkeys(
    allKeys || 'f24', // dummy when empty so hook is stable
    (event, handler) => {
      if (!namespacedCommands.length) return;
      const fired = (handler as { hotkey?: string; keys?: string[] }).hotkey
        ?? (handler as { keys?: string[] }).keys?.join('+');
      const matched = namespacedCommands.find((c) =>
        c.keys === fired || c.keys.replace(/\s+/g, '') === fired
      );
      if (matched && (matched.enabled ?? true)) {
        event.preventDefault();
        liveActions.current.get(matched.namespacedId)?.();
      }
    },
    {
      enableOnFormTags: namespacedCommands.some((c) => c.global)
        ? ['INPUT', 'TEXTAREA', 'SELECT']
        : false,
      preventDefault: false,
    },
    [allKeys]
  );

  return useCallback(
    (id: string) => {
      const ns = `lens:${lensId}:${id}`;
      return liveActions.current.get(ns);
    },
    [lensId]
  );
}
