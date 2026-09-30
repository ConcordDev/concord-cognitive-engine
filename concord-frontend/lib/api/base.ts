/**
 * Browser API origin. Prefer same-origin `/api` so Next rewrites proxy to
 * :5050 and cookies stay first-party. NEXT_PUBLIC_API_URL is kept for SSR
 * and leftover absolute fetch sites.
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') return '';
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://127.0.0.1:5050'
  );
}
