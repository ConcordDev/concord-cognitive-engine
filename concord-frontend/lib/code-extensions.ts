/**
 * Installed-extension state for the Code editors (S15, PR #1707).
 *
 * Install/toggle state lives server-side (extensions-list). The
 * Extensions tab and the Monaco editors are separate subtrees, so this
 * module is the shared cache: editors read the enabled set, the tab
 * notifies after any change, and open editors re-apply their effects.
 * Only extensions with a real editor effect consume this (today:
 * todo-highlight's decorations). The catalog states each extension's
 * actual effect in its `effect` note — nothing is listed as producing
 * an effect the editor cannot produce.
 */
import { lensRun } from '@/lib/api/client';

export interface InstalledExtension { id: string; enabled?: boolean }

let cache: InstalledExtension[] | null = null;
let inflight: Promise<InstalledExtension[]> | null = null;
const listeners = new Set<() => void>();

export async function fetchInstalledExtensions(): Promise<InstalledExtension[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const r = await lensRun({ domain: 'code', action: 'extensions-list', input: {} });
        const list = (r.data?.result as { extensions?: InstalledExtension[] } | undefined)?.extensions;
        cache = Array.isArray(list) ? list : [];
      } catch {
        cache = [];
      }
      inflight = null;
      return cache;
    })();
  }
  return inflight;
}

export function extensionEnabled(id: string): boolean {
  return !!cache?.some((e) => e.id === id && e.enabled !== false);
}

/** Called by the Extensions tab after install/toggle/uninstall. */
export function notifyExtensionsChanged(next?: InstalledExtension[]): void {
  if (next) cache = next;
  else cache = null;
  listeners.forEach((fn) => { try { fn(); } catch { /* listener errors are non-fatal */ } });
}

export function subscribeExtensionsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
