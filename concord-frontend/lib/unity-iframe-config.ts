/**
 * Unity WebGL kernel URL — one function for the iframe parent and the
 * /unity-client HTML route.
 *
 * Production (concord-os.org, etc.): same-origin `/unity-ws`. nginx,
 * cloudflared, and `server-proxy.js` upgrade that path to the kernel on
 * :5050. Do not hardcode :5050 there — that would skip TLS / the tunnel.
 *
 * Loopback `next dev` / local website: Next's HTTP rewrites do not
 * forward WebSocket upgrades, so the player would die at
 * `ws://127.0.0.1:3000/unity-ws`. Pin the kitchen kernel instead.
 */

export function isLoopbackHttpOrigin(origin: string): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = u.hostname.replace(/^\[(.*)\]$/, '$1');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function wsOriginFromHttp(origin: string): string {
  if (origin.startsWith('https://')) return `wss://${origin.slice('https://'.length)}`;
  if (origin.startsWith('http://')) return `ws://${origin.slice('http://'.length)}`;
  return origin;
}

/** Kernel gateway the Unity player should open. Query param wins at the HTML route. */
export function unityKernelGatewayUrl(pageOrigin: string): string {
  if (isLoopbackHttpOrigin(pageOrigin)) return 'ws://127.0.0.1:5050/unity-ws';
  if (!pageOrigin) return '';
  return `${wsOriginFromHttp(pageOrigin)}/unity-ws`;
}

export function buildUnityIframeSearch(opts: {
  worldId: string;
  token?: string | null;
  pageOrigin?: string;
}): URLSearchParams {
  const params = new URLSearchParams({ CONCORD_WORLD_ID: opts.worldId });
  if (opts.token) params.set('CONCORD_AUTH_TOKEN', opts.token);
  const origin =
    opts.pageOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const gateway = unityKernelGatewayUrl(origin);
  if (gateway) params.set('CONCORD_GATEWAY_URL', gateway);
  return params;
}
