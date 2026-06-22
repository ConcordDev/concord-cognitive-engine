// Phase G4 — API base URL resolver.
//
// Single source of truth for the backend host. Override with
// EXPO_PUBLIC_API_URL at build time (set per-profile in eas.json).
//
// The production default is the live tunnel domain so a release build
// without the env var still reaches a real backend instead of an
// unreachable localhost. Dev builds resolve to localhost via __DEV__.

const PRODUCTION_API_URL = 'https://concord-os.org';

export function getApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override && override.length > 0) return override;
  // __DEV__ is true under Metro dev builds, false in release binaries.
  if (typeof __DEV__ !== 'undefined' && __DEV__) return 'http://localhost:5050';
  return PRODUCTION_API_URL;
}
