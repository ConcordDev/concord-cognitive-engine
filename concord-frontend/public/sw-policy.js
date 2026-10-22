/* global self */
/**
 * Routing rules for the Concord service worker.
 *
 * Loaded with importScripts from /sw.js (classic script, no ESM).
 * Tests load the same file and read `module.exports` / `self.concordSwPolicy`.
 *
 * Decisions:
 *   passthrough — do not intercept (API, non-GET, anything that is not shell)
 *   navigation  — network, and on failure the precached offline page
 *   static      — cache-first, and only store a response that canStore() allows
 */
(function (root) {
  var CACHE_NAME = 'concord-shell-v2';
  var OFFLINE_URL = '/offline.html';
  var PRECACHE_URLS = [
    '/offline.html',
    '/favicon.ico',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/icons/icon-512x512-maskable.png',
    '/apple-touch-icon.png',
  ];

  function parseUrl(raw) {
    try {
      return new URL(raw, 'https://concord-os.org');
    } catch {
      return null;
    }
  }

  function isApiPath(pathname) {
    return pathname === '/api' || pathname.indexOf('/api/') === 0;
  }

  function isStaticShell(url, request) {
    var pathname = url.pathname;
    if (pathname.indexOf('/_next/static/') === 0) return true;
    if (pathname.indexOf('/icons/') === 0) return true;
    if (
      pathname === '/favicon.ico' ||
      pathname === '/favicon.svg' ||
      pathname === '/apple-touch-icon.png' ||
      pathname === '/offline.html' ||
      pathname === '/manifest.json'
    ) {
      return true;
    }
    // Same-origin font files (next/font emits these under /_next/static,
    // already matched). A bare font destination is still shell, not account data.
    if (request && request.destination === 'font') return true;
    return false;
  }

  /**
   * @param {{ url?: string, method?: string, mode?: string, destination?: string }} request
   * @returns {'passthrough' | 'navigation' | 'static'}
   */
  function decide(request) {
    if (!request) return 'passthrough';
    var method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET') return 'passthrough';
    var url = parseUrl(request.url || '');
    if (!url) return 'passthrough';
    if (isApiPath(url.pathname)) return 'passthrough';
    if (request.mode === 'navigate') return 'navigation';
    if (isStaticShell(url, request)) return 'static';
    return 'passthrough';
  }

  function readHeader(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') {
      var fromGet = headers.get(name);
      return fromGet ? String(fromGet) : null;
    }
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).toLowerCase() === name) {
        var value = headers[keys[i]];
        if (Array.isArray(value)) value = value.filter(Boolean).join(', ');
        if (value == null || value === '') return null;
        return String(value);
      }
    }
    return null;
  }

  /**
   * cache.put throws on non-GET and must never store private or unusable bodies.
   * Set-Cookie is a forbidden response header in some browsers (it reads as
   * absent); /api/ is still excluded in decide() so those responses are never
   * candidates. When the header is visible, refuse the store.
   */
  function canStore(request, response) {
    if (!request || String(request.method || 'GET').toUpperCase() !== 'GET') return false;
    var url = parseUrl(request.url || '');
    if (!url || isApiPath(url.pathname)) return false;
    if (!response || response.status !== 200) return false;
    var type = response.type || 'basic';
    if (type !== 'basic' && type !== 'cors' && type !== 'default') return false;
    if (readHeader(response.headers, 'set-cookie')) return false;
    return true;
  }

  /** Drop previous Concord shell caches (v1 held /api/ responses). Leave other names alone. */
  function isRetiredCache(name) {
    return typeof name === 'string' && name.indexOf('concord-') === 0 && name !== CACHE_NAME;
  }

  var policy = {
    CACHE_NAME: CACHE_NAME,
    OFFLINE_URL: OFFLINE_URL,
    PRECACHE_URLS: PRECACHE_URLS,
    decide: decide,
    canStore: canStore,
    isRetiredCache: isRetiredCache,
  };

  root.concordSwPolicy = policy;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = policy;
  }
})(typeof self !== 'undefined' ? self : this);
