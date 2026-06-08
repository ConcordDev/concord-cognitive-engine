// server/domains/digital-twin.js
//
// Digital-twin lens-action domain — backs the DigitalTwinDashboard panel with
// REAL, per-user, STATE-backed twins (no migrations, no DB tables, no fabricated
// rows). A twin is a named mirror of some source entity (a DTU/building/sensor
// source) holding a mutable state snapshot. `twin-sync` computes drift between
// the twin's recorded state and a freshly-supplied source snapshot.
//
// Handlers are `(ctx, artifact, params)`; they read `artifact.data` + `params`,
// scope per-user via `ctx?.actor?.userId` (fallback "anon"), and return
// `{ ok:true, result }` or `{ ok:false, error }`. STATE is in-memory:
//   const STATE = globalThis._concordSTATE; STATE.digitalTwins ??= new Map()
// keyed by userId → Map(twinId → twin). Empty until the user creates twins.

export default function registerDigitalTwinActions(registerLensAction) {
  // ── helpers ──────────────────────────────────────────────────────────────
  function twinStore() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    STATE.digitalTwins ??= new Map();
    return STATE.digitalTwins;
  }
  function userTwins(userId) {
    const store = twinStore();
    if (!store) return null;
    if (!store.has(userId)) store.set(userId, new Map());
    return store.get(userId);
  }
  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const dtuid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dtnow = () => new Date().toISOString();
  const dtaid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const dtclean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

  // Public shape returned to callers (the panel maps this onto its DigitalTwin type).
  function shape(twin) {
    return {
      id: twin.id,
      name: twin.name,
      sourceId: twin.sourceId,
      state: twin.state,
      version: twin.version,
      status: twin.status,
      createdAt: twin.createdAt,
      updatedAt: twin.updatedAt,
      lastSyncAt: twin.lastSyncAt,
      lastDriftScore: twin.lastDriftScore,
    };
  }

  // ── twin-create ──────────────────────────────────────────────────────────
  // name + sourceId required. Optional initial state snapshot via
  // params.state or artifact.data.state.
  registerLensAction("digital-twin", "twin-create", (ctx, artifact, params = {}) => {
    const map = userTwins(dtaid(ctx));
    if (!map) return { ok: false, error: "STATE unavailable" };
    const name = dtclean(params.name ?? artifact?.data?.name, 160);
    const sourceId = dtclean(params.sourceId ?? artifact?.data?.sourceId, 200);
    if (!name) return { ok: false, error: "name required" };
    if (!sourceId) return { ok: false, error: "sourceId required" };
    const initState = isObj(params.state) ? params.state
      : isObj(artifact?.data?.state) ? artifact.data.state : {};
    const twin = {
      id: dtuid("twin"),
      name,
      sourceId,
      state: { ...initState },
      version: 1,
      status: "active",
      createdAt: dtnow(),
      updatedAt: dtnow(),
      lastSyncAt: null,
      lastDriftScore: null,
    };
    map.set(twin.id, twin);
    saveState();
    return { ok: true, result: { twin: shape(twin) } };
  });

  // ── twin-list ────────────────────────────────────────────────────────────
  // Per-user list. Empty until the user creates a twin — never fabricated.
  registerLensAction("digital-twin", "twin-list", (ctx, _artifact, _params = {}) => {
    const map = userTwins(dtaid(ctx));
    if (!map) return { ok: false, error: "STATE unavailable" };
    const twins = [...map.values()]
      .map(shape)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { ok: true, result: { twins, count: twins.length } };
  });

  // ── twin-get ─────────────────────────────────────────────────────────────
  registerLensAction("digital-twin", "twin-get", (ctx, artifact, params = {}) => {
    const map = userTwins(dtaid(ctx));
    if (!map) return { ok: false, error: "STATE unavailable" };
    const id = dtclean(params.id ?? artifact?.data?.id, 200);
    if (!id) return { ok: false, error: "id required" };
    const twin = map.get(id);
    if (!twin) return { ok: false, error: "twin not found" };
    return { ok: true, result: { twin: shape(twin) } };
  });

  // ── twin-update-state ────────────────────────────────────────────────────
  // Merge a partial state snapshot into the twin's recorded state, bump version.
  registerLensAction("digital-twin", "twin-update-state", (ctx, artifact, params = {}) => {
    const map = userTwins(dtaid(ctx));
    if (!map) return { ok: false, error: "STATE unavailable" };
    const id = dtclean(params.id ?? artifact?.data?.id, 200);
    if (!id) return { ok: false, error: "id required" };
    const twin = map.get(id);
    if (!twin) return { ok: false, error: "twin not found" };
    const patch = isObj(params.state) ? params.state
      : isObj(artifact?.data?.state) ? artifact.data.state : null;
    if (!patch) return { ok: false, error: "state object required" };
    const changedFields = Object.keys(patch);
    twin.state = { ...twin.state, ...patch };
    twin.version += 1;
    twin.updatedAt = dtnow();
    if (params.status === "active" || params.status === "degraded" || params.status === "offline") {
      twin.status = params.status;
    }
    map.set(twin.id, twin);
    saveState();
    return { ok: true, result: { twin: shape(twin), changedFields, version: twin.version } };
  });

  // ── twin-delete ──────────────────────────────────────────────────────────
  registerLensAction("digital-twin", "twin-delete", (ctx, artifact, params = {}) => {
    const map = userTwins(dtaid(ctx));
    if (!map) return { ok: false, error: "STATE unavailable" };
    const id = dtclean(params.id ?? artifact?.data?.id, 200);
    if (!id) return { ok: false, error: "id required" };
    if (!map.has(id)) return { ok: false, error: "twin not found" };
    map.delete(id);
    saveState();
    return { ok: true, result: { deleted: true, id } };
  });

  // ── twin-sync ────────────────────────────────────────────────────────────
  // Compute drift: compare the twin's recorded state against a supplied source
  // snapshot. Returns the changed-field list + a driftScore in [0,1] = fraction
  // of compared fields that differ. Does NOT mutate the twin's state — sync
  // measures divergence; reconciliation is twin-update-state's job.
  registerLensAction("digital-twin", "twin-sync", (ctx, artifact, params = {}) => {
    const map = userTwins(dtaid(ctx));
    if (!map) return { ok: false, error: "STATE unavailable" };
    const id = dtclean(params.id ?? artifact?.data?.id, 200);
    if (!id) return { ok: false, error: "id required" };
    const twin = map.get(id);
    if (!twin) return { ok: false, error: "twin not found" };
    const source = isObj(params.source) ? params.source
      : isObj(artifact?.data?.source) ? artifact.data.source : null;
    if (!source) return { ok: false, error: "source snapshot required" };

    const twinState = isObj(twin.state) ? twin.state : {};
    // Compare over the union of keys present in either snapshot.
    const keys = [...new Set([...Object.keys(twinState), ...Object.keys(source)])];
    const changedFields = [];
    for (const k of keys) {
      const tv = twinState[k];
      const sv = source[k];
      // Deterministic structural comparison via canonical JSON.
      if (JSON.stringify(tv) !== JSON.stringify(sv)) {
        changedFields.push({ field: k, twinValue: tv ?? null, sourceValue: sv ?? null });
      }
    }
    const comparedCount = keys.length;
    const driftScore = comparedCount > 0
      ? Math.round((changedFields.length / comparedCount) * 1000) / 1000
      : 0;
    twin.lastSyncAt = dtnow();
    twin.lastDriftScore = driftScore;
    // Reflect drift onto status without overwriting an explicit offline marker.
    if (twin.status !== "offline") {
      twin.status = driftScore >= 0.5 ? "degraded" : driftScore > 0 ? "active" : "active";
    }
    map.set(twin.id, twin);
    saveState();
    return {
      ok: true,
      result: {
        twinId: twin.id,
        inSync: changedFields.length === 0,
        driftScore,
        changedCount: changedFields.length,
        comparedCount,
        changedFields,
        syncedAt: twin.lastSyncAt,
      },
    };
  });
}
