/* global self, importScripts */
/**
 * Legacy worker URL. Scope "/" has one registration.
 *
 * Existing installs update this script in place. Importing /sw.js keeps
 * push and the offline shell on that registration. The page then calls
 * register('/sw.js'); the browser changes this registration's script URL
 * and the push subscription stays attached.
 *
 * If the unified worker cannot load, drop this registration so it does
 * not keep evicting /sw.js.
 */
try {
  importScripts('/sw.js');
} catch {
  self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
  });
  self.addEventListener('activate', function (event) {
    event.waitUntil(self.registration.unregister());
  });
}
