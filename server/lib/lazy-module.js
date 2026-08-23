// server/lib/lazy-module.js
//
// Sprint 32 — Boot latency fix (E5)
//
// Why this module exists
// ----------------------
// The server's `initGhostFleet()` in server.js imports + registers 28 emergent
// modules at boot. The `init({ STATE })` calls inside each one do heavy work
// (forgetting-engine scans 22k DTUs, attention-allocator scans state, etc.).
// Total boot: 8-9 minutes. The user-facing `/api/*` requests hang silently
// during the entire window because the event loop is in module-loading.
//
// The fix: defer the `init({ STATE })` call to first-use. The module file
// is still imported at boot (so `register(...)` calls succeed and the
// macro registry is wired), but the heavy init work happens when the
// heartbeat tick first needs the module — NOT during boot.
//
// Usage:
//   import { lazy } from "../lib/lazy-module.js";
//   const forgettingMod = await import("../emergent/forgetting-engine.js");
//   const forget = lazy(forgettingMod, "forgetting-engine");
//   // forget.runForgettingCycle(false) → calls forgettingMod.runForgettingCycle(false)
//   // On first call, before invoking, lazy() runs forgettingMod.init({ STATE })
//   // exactly once and caches the result.
//
//   // For modules that expose an `init` not requiring STATE:
//   const someMod = lazy(await import("../lib/foo.js"), "foo");
//   someMod.runThing()  → calls fooMod.runThing()
//
//   // You can also pass init options:
//   const mod = lazy(await import("../lib/foo.js"), "foo", { initOpts: { db, STATE } });
//
// Or — even simpler — just use it inline:
//   const forgettingLazy = lazy(forgettingMod, "forgetting", { initOpts: { STATE } });
//   register("forgetting", "run", (_ctx, input) => forgettingLazy.runForgettingCycle(input?.force));

// Map, not WeakMap: keyed by the module's string `name` (see ensureInited()
// below), and WeakMap keys must be objects — `initDone.set(name, ...)` threw
// "Invalid value used as weak map key" on every first real access to any
// lazily-wrapped ghost-fleet module (attention_alloc, etc.), unguarded by any
// try/catch, so it propagated all the way out as macro_uncaught_throw. A Map
// is also what getLazyInitReport() below actually needs, since (unlike a
// WeakMap) it can be iterated for the diagnostic report.
const initDone = new Map();

/**
 * Wrap a module so its `init(opts)` is deferred until first method access.
 *
 * @param {object} mod          - imported module namespace
 * @param {string} name         - module name (for log + dedup)
 * @param {object} [opts]
 * @param {object} [opts.initOpts]      - arguments to pass to mod.init(...)
 * @param {function} [opts.init]        - custom init function instead of mod.init
 * @param {boolean}  [opts.initSync=false] - whether to call init synchronously at boot anyway
 * @returns {Proxy<object>}     - proxy that triggers init on first access
 */
export function lazy(mod, name, opts = {}) {
  if (!mod || typeof mod !== "object") {
    throw new Error(`lazy(${name}): mod must be an object, got ${typeof mod}`);
  }
  const initOpts = opts.initOpts || {};
  const initFn = opts.init || (typeof mod.init === "function" ? mod.init.bind(mod) : null);
  const initSync = opts.initSync === true;

  // If explicit initSync, run immediately and return the raw module (no proxy).
  if (initSync) {
    if (initFn) {
      try { initFn(initOpts); }
      catch (e) { /* swallow — same as the in-line try/catch in server.js */ }
    }
    return mod;
  }

  // If no init function at all, just return the raw module.
  if (!initFn) return mod;

  // Otherwise, wrap in a Proxy that triggers init on first property access.
  let inited = false;
  const ensureInited = () => {
    if (inited) return;
    inited = true;
    initDone.set(name, Date.now());
    try {
      const t0 = Date.now();
      initFn(initOpts);
      const ms = Date.now() - t0;
      if (ms > 50) {
        // Only log if init was non-trivial (>50ms) — most are sub-ms so no noise
        // This log line is intentionally lazy because the operator dashboard
        // shows ghost_fleet_init_complete which already covers the boot-time cost.
        // We log here when init is deferred and pays for itself later.
        console.info(`[lazy-module] ${name}.init() took ${ms}ms on first use`);
      }
    } catch (e) {
      // Match the in-line try/catch behavior in server.js — never throw.
      console.warn(`[lazy-module] ${name}.init() failed: ${e?.message || e}`);
    }
  };

  return new Proxy(mod, {
    get(target, prop, receiver) {
      if (prop === "init") return target.init; // don't proxy-init
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      ensureInited();
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (prop === "init") return prop in target;
      ensureInited();
      return prop in target;
    },
  });
}

/**
 * Diagnostic helper: which modules have been initialized, in what order.
 * Returns [{ name, initializedAt }] for any module that has been touched.
 */
export function getLazyInitReport() {
  return Array.from(initDone.entries())
    .map(([name, initializedAt]) => ({ name, initializedAt }))
    .sort((a, b) => a.initializedAt - b.initializedAt);
}