/**
 * Lens dock — one channel between the lens header toolbar and the lens-wide
 * tools (capture, assistant, connections, agent, panels, activity).
 *
 * Each tool used to float its own trigger button over the lens, which stacked
 * six-plus buttons down the right edge of every page. The tools now render no
 * trigger of their own: they register here, and the toolbar renders one button
 * per REGISTERED tool — so a button only exists when something will actually
 * open (the chat lens, which opts out of the agent FAB, gets no Agent button).
 */
import { useEffect, useSyncExternalStore } from 'react';

export type LensTool = 'capture' | 'assistant' | 'connections' | 'agent' | 'panels' | 'activity';

const EVT = 'concord:lens-tool';
const counts = new Map<LensTool, number>();
const subscribers = new Set<() => void>();
let snapshot: ReadonlySet<LensTool> = new Set();

function publish() {
  snapshot = new Set([...counts].filter(([, n]) => n > 0).map(([t]) => t));
  subscribers.forEach((fn) => fn());
}

/** Open (toggle) a lens tool. Returns true when a mounted tool handled it. */
export function openLensTool(tool: LensTool): boolean {
  if (typeof window === 'undefined') return false;
  const e = new CustomEvent(EVT, { detail: { tool }, cancelable: true });
  return !window.dispatchEvent(e);
}

/** Register a tool and run `onOpen` whenever the toolbar asks for it. */
export function useLensTool(tool: LensTool, onOpen: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tool?: LensTool }>).detail;
      // First mounted handler wins — a lens that mounts its own copy of a tool
      // must not open two panels on one click.
      if (detail?.tool !== tool || e.defaultPrevented) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener(EVT, handler);
    counts.set(tool, (counts.get(tool) ?? 0) + 1);
    publish();
    return () => {
      window.removeEventListener(EVT, handler);
      counts.set(tool, Math.max(0, (counts.get(tool) ?? 1) - 1));
      publish();
    };
  }, [tool, onOpen, enabled]);
}

const EMPTY: ReadonlySet<LensTool> = new Set();

/** The set of tools currently mounted and able to open. */
export function useAvailableLensTools(): ReadonlySet<LensTool> {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => snapshot,
    () => EMPTY,
  );
}
