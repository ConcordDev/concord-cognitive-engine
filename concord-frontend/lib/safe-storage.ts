/**
 * Fail-safe wrappers around the Web Storage API (`sessionStorage`/`localStorage`).
 *
 * Why this exists: Safari private-mode, "block all cookies" browser settings,
 * and some locked-down corporate/WebView environments throw `SecurityError` or
 * `QuotaExceededError` when `Storage.getItem`/`setItem` is merely ACCESSED —
 * not just when it fails to find a key. An uncaught throw from a raw
 * `sessionStorage.getItem(...)` call once froze the app's branded splash
 * screen forever, because it happened inside a `useEffect` in `Providers.tsx`
 * with no error boundary above it to catch it (React error boundaries can't
 * catch errors thrown in a component's own hooks/effects — only in their
 * children's render). These helpers make storage access fail-safe everywhere
 * it's used, matching the codebase's existing "never let a non-critical
 * failure block the critical path" philosophy (the same spirit as the
 * best-effort try/catch patterns used elsewhere in this codebase).
 */

export function safeGetItem(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
