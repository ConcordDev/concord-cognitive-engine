// server/lib/scene-live-reload.js
//
// Godot live-reload bridge — when REAL world geometry mutates (a building
// spawns, is removed, or transitions standing→damaged→collapsed), re-run
// exportScene for that world and push a `scene:reload` frame into the
// world's room. Godot clients already treat a full scene payload as
// idempotent (`world/scene_bootstrap.gd#apply_scene` clears + rebuilds),
// so the honest move is to ship the same concord-scene/v2 snapshot the
// existing `scene:request` → `scene:data` path produces, not invent a
// parallel delta protocol.
//
// Why a bridge module (and not inline emits at every mutation site):
//   * Debounce. Combat can collapse several buildings in one burst; a
//     design-mode publish can spawn then immediately tweak. One re-export
//     per quiet window is enough — exportScene walks every world_buildings
//     row + districts + vegetation scatter, and we do not want that on the
//     hot path of every single hit.
//   * One fan-out surface. Callers just say `notifySceneChanged(worldId,
//     reason)`. The bridge owns "when / what / how" and routes through the
//     injected `emitToWorld` so the frame reaches BOTH socket.io web
//     clients AND the Godot gateway mirror (server.js#emitToWorld →
//     `_godotGatewayEmitter.emitToRoom`). Bare `io.to(...).emit(...)` is
//     intentionally NOT used here — that path is what left Godot dark on
//     combat:polish / world:building-state historically
//     (docs/GODOT_PROTOCOL.md).
//   * Testable without booting server.js. deps are injected; the clock and
//     timers are injectable so debounce is deterministic in unit tests.
//
// Honesty contract:
//   * Never fabricates geometry. The payload IS whatever exportScene
//     returns, including honest `{ok:false, reason}` failures.
//   * A missing exportScene/db/emitToWorld degrades to a no-op (or an
//     honest unavailable payload if we can still address a room) — never
//     throws into the mutation site.
//   * `reason` / `causes` name the REAL trigger(s) that scheduled the
//     reload ("building_spawned", "building_removed", "building_state",
//     …). A debounced batch with multiple triggers reports `reason:"batch"`
//     plus the full `causes` set — never a guessed single cause.

export const SCENE_RELOAD_EVT = "scene:reload";

/** Default quiet-window before a scheduled reload flushes. */
export const DEFAULT_DEBOUNCE_MS = Number(process.env.CONCORD_SCENE_RELOAD_DEBOUNCE_MS) || 250;

/**
 * @typedef {object} SceneLiveReload
 * @property {(worldId:string, reason?:string, meta?:object) => {ok:boolean, scheduled?:boolean, reason?:string, worldId?:string, debounceMs?:number}} notifySceneChanged
 * @property {(worldId:string) => object|null} flushNow
 * @property {() => void} close
 * @property {() => string[]} pendingWorlds
 */

/**
 * Build a per-process scene live-reload controller.
 *
 * @param {object} deps
 * @param {(db:any, worldId:string, opts?:object) => object} [deps.exportScene]
 *   Same function the gateway's `scene:request` handler calls. Required for
 *   a successful reload; omit → honest `scene_export_unavailable`.
 * @param {any} [deps.db]  Passed verbatim to exportScene.
 * @param {(worldId:string, evt:string, payload:object) => any} [deps.emitToWorld]
 *   server.js#emitToWorld (or a test fake). Required to actually deliver;
 *   omit → flush still runs exportScene (for tests) but skips fan-out.
 * @param {number} [deps.debounceMs]
 * @param {() => number} [deps.now]  Injectable clock (ms).
 * @param {(fn:Function, ms:number) => any} [deps.setTimer]
 * @param {(id:any) => void} [deps.clearTimer]
 * @returns {SceneLiveReload}
 */
export function createSceneLiveReload(deps = {}) {
  const {
    exportScene = null,
    db = null,
    emitToWorld = null,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  } = deps;

  /** @type {Map<string, { timer:any, reasons:Set<string>, lastMeta:object, scheduledAt:number }>} */
  const pending = new Map();

  function flush(worldId) {
    const entry = pending.get(worldId);
    pending.delete(worldId);
    if (!entry) return null;

    const causes = [...entry.reasons];
    const reason = causes.length === 1 ? causes[0] : "batch";

    let scene;
    if (typeof exportScene !== "function" || !db) {
      scene = { ok: false, reason: "scene_export_unavailable", worldId };
    } else {
      try {
        scene = exportScene(db, worldId);
      } catch (e) {
        scene = {
          ok: false,
          reason: "scene_export_failed",
          worldId,
          error: String(e?.message || e),
        };
      }
    }

    // Spread the exportScene result first so an honest failure shape wins
    // over any defaults; then stamp the live-reload envelope fields. Never
    // overwrite exportScene's own `reason` on failure — surface it as
    // `exportReason` and keep the reload trigger in `reason`/`causes`.
    const exportReason = scene && scene.ok === false ? scene.reason : undefined;
    const payload = {
      ...scene,
      worldId,
      reload: true,
      reason,
      causes,
      flushedAt: now(),
    };
    if (exportReason && exportReason !== reason) {
      payload.exportReason = exportReason;
      // Keep a single top-level `reason` naming the TRIGGER (what the
      // client/ops care about for "why did I just rebuild"). The export
      // failure detail lives in exportReason + scene.ok=false, which
      // apply_scene already branches on.
      payload.reason = reason;
    }

    if (typeof emitToWorld === "function") {
      try {
        emitToWorld(worldId, SCENE_RELOAD_EVT, payload);
      } catch {
        // Fan-out must never throw into a mutation site (spawn/combat).
      }
    }

    return payload;
  }

  /**
   * Schedule a debounced re-export + `scene:reload` for `worldId`.
   * Safe to call from any mutation site; never throws.
   *
   * @param {string} worldId
   * @param {string} [reason="geometry_changed"]
   * @param {object} [meta]  Optional diagnostic context (buildingId, etc.)
   *                         — retained only for the most recent notify of
   *                         this quiet window; not currently put on the
   *                         wire (the full scene snapshot is the source of
   *                           truth). Accepted so call sites can pass it
   *                         without a second code path later.
   */
  function notifySceneChanged(worldId, reason = "geometry_changed", meta = {}) {
    if (!worldId || typeof worldId !== "string") {
      return { ok: false, reason: "missing_world" };
    }
    const trigger = typeof reason === "string" && reason ? reason : "geometry_changed";

    let entry = pending.get(worldId);
    if (!entry) {
      entry = { timer: null, reasons: new Set(), lastMeta: {}, scheduledAt: now() };
      pending.set(worldId, entry);
    }
    entry.reasons.add(trigger);
    if (meta && typeof meta === "object") entry.lastMeta = meta;

    if (entry.timer != null) {
      try { clearTimer(entry.timer); } catch { /* survive */ }
      entry.timer = null;
    }

    const wait = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : DEFAULT_DEBOUNCE_MS;
    entry.timer = setTimer(() => {
      entry.timer = null;
      try { flush(worldId); } catch { /* survive */ }
    }, wait);
    // Don't keep a pure-idle process alive for a pending reload.
    if (entry.timer && typeof entry.timer.unref === "function") {
      try { entry.timer.unref(); } catch { /* survive */ }
    }

    return { ok: true, scheduled: true, worldId, debounceMs: wait };
  }

  /** Cancel debounce and flush immediately. Useful for tests + shutdown. */
  function flushNow(worldId) {
    if (!worldId || typeof worldId !== "string") return null;
    const entry = pending.get(worldId);
    if (entry?.timer != null) {
      try { clearTimer(entry.timer); } catch { /* survive */ }
      entry.timer = null;
    }
    // If nothing was pending, still allow an explicit flush to push a
    // fresh snapshot (ops / admin path). Seed a synthetic entry so flush
    // has a reason set.
    if (!pending.has(worldId)) {
      pending.set(worldId, {
        timer: null,
        reasons: new Set(["flush_now"]),
        lastMeta: {},
        scheduledAt: now(),
      });
    }
    return flush(worldId);
  }

  function close() {
    for (const entry of pending.values()) {
      if (entry.timer != null) {
        try { clearTimer(entry.timer); } catch { /* survive */ }
      }
    }
    pending.clear();
  }

  function pendingWorlds() {
    return [...pending.keys()];
  }

  return {
    notifySceneChanged,
    flushNow,
    close,
    pendingWorlds,
    // Exposed for tests — not part of the public call-site surface.
    _flush: flush,
    _pending: pending,
  };
}

/**
 * Convenience helper for mutation sites that only have globalThis access
 * (lib modules that can't import server.js without a circular edge).
 * Resolves `globalThis._concordNotifySceneChanged` — installed by
 * server.js at boot once the live-reload controller is constructed.
 * No-ops honestly when the controller isn't mounted (unit tests, bare
 * lib use).
 */
export function notifySceneChanged(worldId, reason, meta) {
  const fn = globalThis._concordNotifySceneChanged;
  if (typeof fn !== "function") return { ok: false, reason: "live_reload_unmounted" };
  try {
    return fn(worldId, reason, meta);
  } catch (e) {
    return { ok: false, reason: "live_reload_error", error: String(e?.message || e) };
  }
}

export default {
  createSceneLiveReload,
  notifySceneChanged,
  SCENE_RELOAD_EVT,
  DEFAULT_DEBOUNCE_MS,
};
