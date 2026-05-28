// Phase G4 — API base URL resolver.
//
// Single source of truth for the backend host. Override with
// EXPO_PUBLIC_API_URL at build time.

export function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5050';
}
