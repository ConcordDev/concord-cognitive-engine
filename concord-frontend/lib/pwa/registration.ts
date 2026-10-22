/**
 * One service worker for scope "/".
 *
 * A scope can have only one active worker, so the shell cache, the offline
 * navigation fallback, and Web Push all live in `/sw.js`. `/service-worker.js`
 * remains as a shim that importScripts that file so an already-installed
 * push worker updates in place; the page then registers `/sw.js` and the
 * browser swaps the script URL on the same registration (the push
 * subscription stays).
 */
export const PWA_SERVICE_WORKER_URL = '/sw.js';
export const PWA_SERVICE_WORKER_SCOPE = '/';
