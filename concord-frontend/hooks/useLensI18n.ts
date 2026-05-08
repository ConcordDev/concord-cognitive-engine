'use client';

/**
 * useLensI18n — namespaced i18n consumer for a lens.
 *
 * Thin wrapper over `useTranslation` that scopes keys under
 * `lens.<lensId>.…` so each lens owns its own translation tree without
 * collisions. Falls back to the global key when no namespaced match
 * exists (inherited from useTranslation behaviour).
 */

import { useTranslation } from '@/lib/i18n/useTranslation';

export function useLensI18n(lensId: string) {
  // useTranslation already supports namespace fallback: if `lens.foo.bar`
  // is missing it tries `bar`, so callers can ship lens-specific keys
  // without duplicating common strings.
  return useTranslation(`lens.${lensId}`);
}

export default useLensI18n;
