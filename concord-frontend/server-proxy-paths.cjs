/**
 * Paths the production custom server (server-proxy.js) must upgrade to
 * BACKEND_URL instead of handing to Next.js. Next rewrites proxy HTTP
 * but not WebSocket upgrades — /socket.io, /unity-ws, and /godot-ws
 * would otherwise die at the frontend process.
 */
'use strict';

function backendWsProxyPathname(reqUrl) {
  if (!reqUrl) return '';
  try {
    return new URL(reqUrl, 'http://localhost').pathname;
  } catch {
    return '';
  }
}

function isBackendWsProxyPath(reqUrl) {
  const pathname = backendWsProxyPathname(reqUrl);
  if (!pathname) return false;
  return (
    pathname === '/unity-ws' ||
    pathname === '/godot-ws' ||
    pathname === '/socket.io' ||
    pathname.startsWith('/socket.io/')
  );
}

module.exports = { backendWsProxyPathname, isBackendWsProxyPath };
