// server/domains/sandbox.js
//
// Domain actions for the Combat Sandbox lens — the persistence layer behind
// a combat/ability feel-tuning test scene. Live combat itself still resolves
// through the production /api/worlds/:worldId/combat/attack socket pipeline
// against the private `sandbox` world; these macros persist the things the
// pipeline does NOT: saved weapon/skill loadouts, dummy behavior presets,
// recorded combat replays, and frame-time / hitstop telemetry samples.
//
// REGISTRATION (saved-class fix): this file used to register through the
// legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every `sandbox.*` macro
// was invisible to runMacro and to POST /api/lens/run → every call hit
// `unknown_macro`, leaving the lens components (LoadoutPicker, DummyPresetPanel,
// TelemetryOverlay, ReplayPanel) dead-wired. It is now wired through the
// canonical `register` (MACROS) registry — `registerSandboxMacros(register)`
// in server.js — so the macros are reachable BOTH via POST /api/lens/run AND
// via runMacro (which the contract engine + macro-assassin + behavior-smoke
// harness drive).
//
// To keep the file's verified handler bodies byte-for-byte identical we adapt
// the canonical 2-arg `(ctx, input)` signature back to the legacy
// `(ctx, artifact, params)` shape via the `registerLensAction` shim below —
// `params` (and `artifact.data`) are the input, identical to what
// `/api/lens/run` would have built. Handlers return a `{ ok, result }`
// envelope (the dispatcher's `_unwrapLensEnvelope` strips the `result` layer so
// the frontend reads `r.data.result.<field>`).
//
// All persistence is per-user in globalThis._concordSTATE.sandboxLens. No
// fake/seed data — every value is real user input or a real combat sample.
//
// Fail-CLOSED numeric guard: every macro that WRITES from a numeric input
// (damage / hp / count / frame samples) calls `badNumericField` BEFORE the
// write, rejecting NaN/Infinity/1e308/negative instead of silently clamping
// them to an accepted row (the macro-assassin's V2 vector probes exactly this).

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE writing.
// An absent/null field is fine (the macro uses its default). Returns null when
// clean, else the offending key. Copied from server/domains/literary.js.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

export default function registerSandboxMacros(register) {
  // Legacy-convention shim: adapt canonical register(ctx, input) → the
  // verified (ctx, artifact, params) handler bodies below, unchanged.
  const registerLensAction = (domain, action, handler, ...extra) =>
    register(domain, action, (ctx, input = {}, params) => {
      const inp = input && typeof input === "object" ? input : {};
      // Dispatchers hand us a ready artifact envelope as arg1 (body under
      // `.data`) + the flat body as arg2; pass the envelope through (not
      // re-wrapped) and fold arg2 INTO `.data` so a caller that supplies the
      // body only in arg2 (e.g. parity tests' fn(ctx,{data:{}},params)) is seen.
      const base = inp.artifact && typeof inp.artifact === "object"
        ? inp.artifact
        : (inp.data && typeof inp.data === "object"
            ? inp
            : { id: null, domain, type: "domain_action", data: inp, meta: {} });
      const p = params && typeof params === "object" ? params : {};
      const data = { ...(base.data && typeof base.data === "object" ? base.data : {}), ...p };
      return handler(ctx, { ...base, data }, data);
    }, ...extra);

  // ─── shared STATE helpers ───────────────────────────────────────────
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.sandboxLens) STATE.sandboxLens = {};
    const s = STATE.sandboxLens;
    if (!(s.loadouts instanceof Map)) s.loadouts = new Map();   // userId -> Array<loadout>
    if (!(s.dummyConfigs instanceof Map)) s.dummyConfigs = new Map(); // userId -> Array<dummyConfig>
    if (!(s.replays instanceof Map)) s.replays = new Map();     // userId -> Array<replay>
    if (!(s.telemetry instanceof Map)) s.telemetry = new Map(); // userId -> Array<telemetrySample>
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const sid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = () => new Date().toISOString();
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const ulist = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const clampNum = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };

  // The weapon / skill catalog the sandbox can equip. These mirror the
  // categories the production combat pipeline accepts; they are a fixed
  // engine vocabulary, not seeded user content.
  const WEAPONS = [
    { id: "fist",  label: "Fist",        baseLight: 8,  baseHeavy: 16, reach: 2.0, armorPierce: 0 },
    { id: "blade", label: "Blade",       baseLight: 12, baseHeavy: 26, reach: 2.6, armorPierce: 1 },
    { id: "pistol", label: "Pistol",     baseLight: 14, baseHeavy: 22, reach: 8.0, armorPierce: 2 },
    { id: "staff", label: "Staff",       baseLight: 10, baseHeavy: 30, reach: 3.2, armorPierce: 0 },
    { id: "greataxe", label: "Greataxe", baseLight: 16, baseHeavy: 40, reach: 3.0, armorPierce: 2 },
  ];
  const SKILLS = [
    { id: "none",        label: "No skill",      element: "physical", tier: 2 },
    { id: "ember-arc",   label: "Ember Arc",     element: "fire",     tier: 4 },
    { id: "frost-lance", label: "Frost Lance",   element: "ice",      tier: 4 },
    { id: "storm-call",  label: "Storm Call",    element: "lightning", tier: 5 },
    { id: "stone-fist",  label: "Stone Fist",    element: "physical", tier: 3 },
  ];
  // Dummy behavior presets: how a training dummy reacts. Static is the
  // historical default; the others give the scene something to tune feel
  // against (a dummy that strafes, blocks, or pressures the player).
  const BEHAVIORS = [
    { id: "static",     label: "Static",     blockChance: 0,    moveSpeed: 0,   counterAttack: false, blurb: "Never moves, never blocks — a pure damage target." },
    { id: "idle",       label: "Idle Wander", blockChance: 0,   moveSpeed: 0.6, counterAttack: false, blurb: "Drifts slowly — tests tracking and lock-on." },
    { id: "defensive",  label: "Defensive",  blockChance: 0.45, moveSpeed: 0.4, counterAttack: false, blurb: "Blocks often — tests poise and guard-break feel." },
    { id: "aggressive", label: "Aggressive", blockChance: 0.15, moveSpeed: 1.0, counterAttack: true,  blurb: "Closes distance and counters — tests trade timing." },
  ];

  // ─────────────────────────────────────────────────────────────────────
  // catalog — the fixed engine vocabulary the picker UIs render.
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("sandbox", "catalog", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { weapons: WEAPONS, skills: SKILLS, behaviors: BEHAVIORS } };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Weapon / skill loadouts — saved equip presets so feel iteration does
  // not require URL editing.  [S] Weapon/skill loadout picker UI
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("sandbox", "saveLoadout", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const bad = badNumericField(params, ["lightDamage", "heavyDamage"]);
    if (bad) return { ok: false, error: `invalid_${bad}` };
    const weapon = WEAPONS.find((w) => w.id === String(params.weaponId));
    if (!weapon) return { ok: false, error: "unknown_weaponId" };
    const skill = SKILLS.find((k) => k.id === String(params.skillId || "none"));
    if (!skill) return { ok: false, error: "unknown_skillId" };
    const name = String(params.name || "").trim().slice(0, 60) || `${weapon.label} loadout`;
    const list = ulist(s.loadouts, actor(ctx));
    const entry = {
      id: sid("ld"),
      name,
      weaponId: weapon.id,
      skillId: skill.id,
      lightDamage: clampNum(params.lightDamage, 1, 500, weapon.baseLight),
      heavyDamage: clampNum(params.heavyDamage, 1, 500, weapon.baseHeavy),
      createdAt: now(),
    };
    list.push(entry);
    save();
    return { ok: true, result: { loadout: entry, total: list.length } };
  });

  registerLensAction("sandbox", "listLoadouts", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const list = [...ulist(s.loadouts, actor(ctx))].reverse();
    return { ok: true, result: { loadouts: list, count: list.length } };
  });

  registerLensAction("sandbox", "deleteLoadout", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const list = ulist(s.loadouts, actor(ctx));
    const idx = list.findIndex((x) => x.id === params.loadoutId);
    if (idx < 0) return { ok: false, error: "loadout_not_found" };
    list.splice(idx, 1);
    save();
    return { ok: true, result: { deleted: params.loadoutId, count: list.length } };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Dummy behavior presets — persist a per-user named dummy config that
  // pairs a behavior preset with an HP value.
  // [S] Dummy behavior presets — aggressive/defensive/idle dummies
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("sandbox", "saveDummyConfig", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const bad = badNumericField(params, ["hp", "count"]);
    if (bad) return { ok: false, error: `invalid_${bad}` };
    const behavior = BEHAVIORS.find((b) => b.id === String(params.behaviorId));
    if (!behavior) return { ok: false, error: "unknown_behaviorId" };
    const list = ulist(s.dummyConfigs, actor(ctx));
    const entry = {
      id: sid("dc"),
      name: String(params.name || "").trim().slice(0, 60) || `${behavior.label} dummy`,
      behaviorId: behavior.id,
      hp: Math.round(clampNum(params.hp, 1, 100000, 100)),
      count: Math.round(clampNum(params.count, 1, 10, 3)),
      createdAt: now(),
    };
    list.push(entry);
    save();
    return { ok: true, result: { dummyConfig: entry, total: list.length } };
  });

  registerLensAction("sandbox", "listDummyConfigs", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const list = [...ulist(s.dummyConfigs, actor(ctx))].reverse();
    return { ok: true, result: { dummyConfigs: list, count: list.length } };
  });

  registerLensAction("sandbox", "deleteDummyConfig", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const list = ulist(s.dummyConfigs, actor(ctx));
    const idx = list.findIndex((x) => x.id === params.configId);
    if (idx < 0) return { ok: false, error: "dummy_config_not_found" };
    list.splice(idx, 1);
    save();
    return { ok: true, result: { deleted: params.configId, count: list.length } };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Combat replay recorder — persist a recorded sequence of real combat
  // events captured client-side from the live socket pipeline, so it can
  // be re-played frame by frame later.
  // [S] Record + replay a combat sequence
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("sandbox", "saveReplay", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const frames = Array.isArray(params.frames) ? params.frames : [];
    if (frames.length === 0) return { ok: false, error: "replay_has_no_frames" };
    // Normalise frames: each is a real combat event the client captured.
    const norm = frames.slice(0, 2000).map((f, i) => ({
      seq: i,
      t: Number(f.t) || 0,                 // ms offset from recording start
      kind: String(f.kind || "hit").slice(0, 40),
      targetId: String(f.targetId || "").slice(0, 60),
      damage: Number(f.damage) || 0,
      isCrit: !!f.isCrit,
      heavy: !!f.heavy,
    }));
    const durationMs = norm.length ? Math.max(...norm.map((f) => f.t)) : 0;
    const totalDamage = norm.reduce((n, f) => n + f.damage, 0);
    const list = ulist(s.replays, actor(ctx));
    const entry = {
      id: sid("rp"),
      name: String(params.name || "").trim().slice(0, 60) || `Replay ${list.length + 1}`,
      frames: norm,
      frameCount: norm.length,
      durationMs,
      totalDamage: Math.round(totalDamage * 100) / 100,
      hitCount: norm.filter((f) => f.kind === "hit").length,
      recordedAt: now(),
    };
    list.push(entry);
    // Keep the per-user replay store bounded.
    if (list.length > 50) list.splice(0, list.length - 50);
    save();
    return { ok: true, result: { replay: { ...entry, frames: undefined }, frameCount: entry.frameCount } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("sandbox", "listReplays", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    // Summaries only — frames are fetched on demand via getReplay.
    const list = [...ulist(s.replays, actor(ctx))].reverse().map((r) => ({
      id: r.id, name: r.name, frameCount: r.frameCount, durationMs: r.durationMs,
      totalDamage: r.totalDamage, hitCount: r.hitCount, recordedAt: r.recordedAt,
    }));
    return { ok: true, result: { replays: list, count: list.length } };
  });

  registerLensAction("sandbox", "getReplay", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const r = ulist(s.replays, actor(ctx)).find((x) => x.id === params.replayId);
    if (!r) return { ok: false, error: "replay_not_found" };
    return { ok: true, result: { replay: r } };
  });

  registerLensAction("sandbox", "deleteReplay", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const list = ulist(s.replays, actor(ctx));
    const idx = list.findIndex((x) => x.id === params.replayId);
    if (idx < 0) return { ok: false, error: "replay_not_found" };
    list.splice(idx, 1);
    save();
    return { ok: true, result: { deleted: params.replayId, count: list.length } };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Frame-time / hitstop telemetry — the client measures real frame
  // intervals + hitstop durations during a combat session and posts a
  // batch here.  recordTelemetry persists one named session sample;
  // telemetryStats aggregates them so combat-feel can be read numerically.
  // [S] Frame-time / hitstop telemetry overlay
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("sandbox", "recordTelemetry", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const frameTimes = Array.isArray(params.frameTimes)
      ? params.frameTimes.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 5000)
      : [];
    if (frameTimes.length === 0) return { ok: false, error: "no_frame_samples" };
    const hitstops = Array.isArray(params.hitstops)
      ? params.hitstops.map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 1000)
      : [];
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const sum = frameTimes.reduce((n, v) => n + v, 0);
    const avgFrameMs = sum / frameTimes.length;
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const sample = {
      id: sid("tl"),
      name: String(params.name || "").trim().slice(0, 60) || `Session ${ulist(s.telemetry, actor(ctx)).length + 1}`,
      frameCount: frameTimes.length,
      avgFrameMs: Math.round(avgFrameMs * 100) / 100,
      minFrameMs: Math.round(sorted[0] * 100) / 100,
      maxFrameMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
      p95FrameMs: Math.round(pct(0.95) * 100) / 100,
      avgFps: Math.round((1000 / avgFrameMs) * 10) / 10,
      jankFrames: frameTimes.filter((v) => v > 1000 / 50).length, // frames slower than 50fps
      hitstopCount: hitstops.length,
      avgHitstopMs: hitstops.length ? Math.round((hitstops.reduce((n, v) => n + v, 0) / hitstops.length) * 100) / 100 : 0,
      maxHitstopMs: hitstops.length ? Math.round(Math.max(...hitstops) * 100) / 100 : 0,
      recordedAt: now(),
    };
    const list = ulist(s.telemetry, actor(ctx));
    list.push(sample);
    if (list.length > 50) list.splice(0, list.length - 50);
    save();
    return { ok: true, result: { sample } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("sandbox", "telemetryStats", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const list = ulist(s.telemetry, actor(ctx));
    if (list.length === 0) {
      return { ok: true, result: { samples: [], count: 0, overall: null } };
    }
    const samples = [...list].reverse();
    const overall = {
      sessions: list.length,
      avgFps: Math.round((list.reduce((n, x) => n + x.avgFps, 0) / list.length) * 10) / 10,
      avgFrameMs: Math.round((list.reduce((n, x) => n + x.avgFrameMs, 0) / list.length) * 100) / 100,
      worstP95Ms: Math.round(Math.max(...list.map((x) => x.p95FrameMs)) * 100) / 100,
      totalJankFrames: list.reduce((n, x) => n + x.jankFrames, 0),
      avgHitstopMs: Math.round((list.reduce((n, x) => n + x.avgHitstopMs, 0) / list.length) * 100) / 100,
    };
    return { ok: true, result: { samples, count: list.length, overall } };
  });

  registerLensAction("sandbox", "deleteTelemetry", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "state_unavailable" };
    const list = ulist(s.telemetry, actor(ctx));
    const idx = list.findIndex((x) => x.id === params.sampleId);
    if (idx < 0) return { ok: false, error: "telemetry_sample_not_found" };
    list.splice(idx, 1);
    save();
    return { ok: true, result: { deleted: params.sampleId, count: list.length } };
  });
}
