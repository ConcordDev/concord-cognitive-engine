// server/domains/expedition-journal.js
//
// Backend for the expedition-journal lens. Previously the lens was
// localStorage-only with no server backend; this domain provides real
// per-user server-side persistence for expedition progress, journal
// entries, photo/screenshot capture, completion rewards (XP / badges),
// richer per-world stage definitions, and a cross-world progress summary.
//
// Persistence: globalThis._concordSTATE Maps keyed by userId — same
// pattern as server/domains/agriculture.js. Handlers never throw; every
// path returns { ok: boolean, result?, error? }.
//
// REGISTRATION (saved-class fix): this file used to register through the
// legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every
// `expedition-journal.*` macro was invisible to runMacro and to
// POST /api/lens/run → every call hit `unknown_macro`, leaving the page's
// lensRun('expedition-journal', ...) calls dead-wired. It is now wired
// through the canonical `register` (MACROS) registry —
// `registerExpeditionJournalActions(register)` in server.js — so the macros
// are reachable BOTH via POST /api/lens/run AND via runMacro (which the
// contract engine + macro-assassin + behavior-smoke harness drive).
//
// To keep the file's verified handler bodies byte-for-byte identical we adapt
// the canonical 2-arg `(ctx, input)` signature back to the legacy
// `(ctx, artifact, params)` shape via the `registerLensAction` shim below —
// `params` (and `artifact.data`) are the input, identical to what
// `/api/lens/run` would have built. Handlers return a `{ ok, result }`
// envelope (the dispatcher's `_unwrapLensEnvelope` strips the `result` layer
// so the frontend reads `r.data.result.<field>`).
//
// Fail-CLOSED numeric guard: there are no numeric WRITE inputs (worldId /
// stageId / text / dataUrl / caption / mood are all strings, coerced via
// String()), so a poisoned numeric value can never reach an accepted row.
// `badNumericField` is wired defensively so any future numeric input is
// rejected (NaN/Infinity/1e308/negative) BEFORE a write rather than clamped —
// exactly what the macro-assassin's V2 vector probes.

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

/**
 * Richer stage definitions — varied objectives per canon world instead of
 * a fixed arrive→act→record triple. Each world has its own ordered stage
 * list; every stage carries an objective string + an XP reward.
 */
const WORLD_STAGES = {
  "concordia-hub": [
    { id: "arrive", title: "Make landfall", objective: "Reach Concordia Hub and register at the gate.", xp: 25 },
    { id: "commune", title: "Commune with Concordia", objective: "Speak with the goddess at the central spire.", xp: 40 },
    { id: "record", title: "Log the founding", objective: "Write a journal entry on what you found.", xp: 35 },
  ],
  "concord-link-frontier": [
    { id: "arrive", title: "Cross the frontier", objective: "Pass the Concord-Link checkpoint.", xp: 25 },
    { id: "survey", title: "Survey the link nodes", objective: "Scout three relay nodes on the frontier.", xp: 45 },
    { id: "trade", title: "Open a trade route", objective: "Complete one frontier marketplace deal.", xp: 50 },
    { id: "record", title: "File the dispatch", objective: "Record an expedition note for the archive.", xp: 35 },
  ],
  cyber: [
    { id: "arrive", title: "Jack in", objective: "Enter the Cyber world net interface.", xp: 25 },
    { id: "infiltrate", title: "Breach the grid", objective: "Bypass one ICE layer in the data district.", xp: 55 },
    { id: "extract", title: "Extract a payload", objective: "Recover a data artifact and bank it.", xp: 50 },
    { id: "record", title: "Wipe the trail / log", objective: "Write your run report.", xp: 35 },
  ],
  fantasy: [
    { id: "arrive", title: "Enter the realm", objective: "Step through the fae-gate into Fantasy.", xp: 25 },
    { id: "quest", title: "Take the oath-quest", objective: "Accept and begin a faction quest chain.", xp: 45 },
    { id: "slay", title: "Face the warden", objective: "Defeat or pacify the realm warden.", xp: 60 },
    { id: "record", title: "Pen the saga", objective: "Record the deed in your journal.", xp: 35 },
  ],
  "lattice-crucible": [
    { id: "arrive", title: "Descend the crucible", objective: "Reach the Lattice Crucible floor.", xp: 25 },
    { id: "calibrate", title: "Calibrate the lattice", objective: "Stabilise one drift node.", xp: 50 },
    { id: "synthesize", title: "Forge a breakthrough", objective: "Trigger a cross-domain synthesis.", xp: 60 },
    { id: "record", title: "Archive the proof", objective: "Log the breakthrough as a journal entry.", xp: 35 },
  ],
  "sovereign-ruins": [
    { id: "arrive", title: "Walk the ruins", objective: "Reach the Sovereign Ruins outer wall.", xp: 25 },
    { id: "decipher", title: "Decipher the archive", objective: "Read one Sovereign Refusal Archive glyph.", xp: 50 },
    { id: "honor", title: "Honor the refusal", objective: "Complete a refusal-field rite.", xp: 55 },
    { id: "record", title: "Carry the testimony", objective: "Record what the ruins told you.", xp: 35 },
  ],
};

const KNOWN_WORLDS = Object.keys(WORLD_STAGES);

/**
 * Badge tiers — awarded when an expedition (all stages for a world)
 * completes, and a meta-badge when every canon world is finished.
 */
const BADGES = {
  "world-complete": { title: "Expedition Complete", icon: "flag", desc: "Finished every stage of a world expedition." },
  pathfinder: { title: "Pathfinder", icon: "compass", desc: "Completed expeditions across 3 canon worlds." },
  "grand-explorer": { title: "Grand Explorer of Concord", icon: "globe", desc: "Completed every canon-world expedition." },
};

export default function registerExpeditionJournalActions(register) {
  // Legacy-convention shim: adapt the canonical register(ctx, input) signature
  // → the verified (ctx, artifact, params) handler bodies below, unchanged.
  // `params` (and `artifact.data`) carry the input the dispatcher built.
  const registerLensAction = (domain, action, handler) =>
    register(domain, action, (ctx, input = {}) => {
      const inp = input && typeof input === "object" ? input : {};
      const params = inp.artifact && typeof inp.artifact === "object" && inp.artifact.data
        && typeof inp.artifact.data === "object" && Object.keys(inp).length === 1
        ? inp.artifact.data
        : inp;
      const artifact = inp.artifact && typeof inp.artifact === "object"
        ? inp.artifact
        : { id: null, domain, type: "domain_action", data: params, meta: {} };
      return handler(ctx, artifact, params);
    });

  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.expeditionJournalLens) {
      STATE.expeditionJournalLens = {
        progress: new Map(), // userId -> Map<worldId, Map<stageId, { done, completedAt }>>
        entries: new Map(),  // userId -> Array<journalEntry>
        photos: new Map(),   // userId -> Array<photo>
        rewards: new Map(),  // userId -> { xp:number, badges:Array<badge>, log:Array<rewardEvent> }
      };
    }
    return STATE.expeditionJournalLens;
  }

  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  function actorOf(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nowIso() { return new Date().toISOString(); }
  function nextId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function stagesForWorld(worldId) {
    return WORLD_STAGES[worldId] || WORLD_STAGES["concordia-hub"];
  }

  function progressMapFor(s, userId) {
    let map = s.progress.get(userId);
    if (!map) { map = new Map(); s.progress.set(userId, map); }
    return map;
  }
  function worldProgressFor(s, userId, worldId) {
    const map = progressMapFor(s, userId);
    let wp = map.get(worldId);
    if (!wp) { wp = new Map(); map.set(worldId, wp); }
    return wp;
  }
  function rewardsFor(s, userId) {
    let r = s.rewards.get(userId);
    if (!r) { r = { xp: 0, badges: [], log: [] }; s.rewards.set(userId, r); }
    return r;
  }

  /** Build a serialisable progress view for one world. */
  function worldView(s, userId, worldId) {
    const defs = stagesForWorld(worldId);
    const wp = worldProgressFor(s, userId, worldId);
    const stages = defs.map((d) => {
      const st = wp.get(d.id);
      return {
        id: d.id,
        title: d.title,
        objective: d.objective,
        xp: d.xp,
        done: !!(st && st.done),
        completedAt: st ? st.completedAt || null : null,
      };
    });
    const completed = stages.filter((x) => x.done).length;
    return {
      worldId,
      stages,
      completed,
      total: stages.length,
      percent: stages.length ? Math.round((completed / stages.length) * 100) : 0,
      expeditionComplete: stages.length > 0 && completed === stages.length,
    };
  }

  function hasBadge(rewards, badgeId, worldId) {
    return rewards.badges.some((b) => b.id === badgeId && (b.worldId || null) === (worldId || null));
  }

  function grantBadge(rewards, badgeId, worldId) {
    if (hasBadge(rewards, badgeId, worldId)) return null;
    const def = BADGES[badgeId];
    if (!def) return null;
    const badge = {
      id: badgeId,
      worldId: worldId || null,
      title: def.title,
      icon: def.icon,
      desc: def.desc,
      awardedAt: nowIso(),
    };
    rewards.badges.push(badge);
    rewards.log.push({ kind: "badge", badgeId, worldId: worldId || null, at: badge.awardedAt });
    return badge;
  }

  // ── List canon worlds + their stage definitions (richer stage defs) ──
  registerLensAction("expedition-journal", "worlds", (_ctx, _artifact, _params = {}) => {
    try {
      const worlds = KNOWN_WORLDS.map((id) => ({
        worldId: id,
        stageCount: stagesForWorld(id).length,
        stages: stagesForWorld(id),
      }));
      return { ok: true, result: { worlds } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Server-side persistence: per-world progress view ──
  registerLensAction("expedition-journal", "progress", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const worldId = String(params.worldId || "concordia-hub");
      if (!KNOWN_WORLDS.includes(worldId)) {
        return { ok: false, error: `unknown world: ${worldId}` };
      }
      return { ok: true, result: worldView(s, userId, worldId) };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Mark / unmark a stage; awards stage XP + expedition/meta badges ──
  registerLensAction("expedition-journal", "mark-stage", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const worldId = String(params.worldId || "");
      const stageId = String(params.stageId || "");
      const done = params.done !== false; // default true
      if (!KNOWN_WORLDS.includes(worldId)) {
        return { ok: false, error: `unknown world: ${worldId}` };
      }
      const defs = stagesForWorld(worldId);
      const def = defs.find((d) => d.id === stageId);
      if (!def) return { ok: false, error: `unknown stage: ${stageId}` };

      const wp = worldProgressFor(s, userId, worldId);
      const prev = wp.get(stageId);
      const wasDone = !!(prev && prev.done);
      wp.set(stageId, { done, completedAt: done ? (prev?.completedAt || nowIso()) : null });

      const rewards = rewardsFor(s, userId);
      const awarded = [];
      // Award stage XP only on a fresh completion.
      if (done && !wasDone) {
        rewards.xp += def.xp;
        rewards.log.push({ kind: "stage-xp", worldId, stageId, xp: def.xp, at: nowIso() });
        awarded.push({ kind: "xp", amount: def.xp });
      }

      const view = worldView(s, userId, worldId);
      // Expedition-complete badge.
      if (view.expeditionComplete) {
        const b = grantBadge(rewards, "world-complete", worldId);
        if (b) awarded.push({ kind: "badge", badge: b });
      }
      // Meta badges across worlds.
      const completedWorlds = KNOWN_WORLDS.filter(
        (w) => worldView(s, userId, w).expeditionComplete,
      );
      if (completedWorlds.length >= 3) {
        const b = grantBadge(rewards, "pathfinder", null);
        if (b) awarded.push({ kind: "badge", badge: b });
      }
      if (completedWorlds.length === KNOWN_WORLDS.length) {
        const b = grantBadge(rewards, "grand-explorer", null);
        if (b) awarded.push({ kind: "badge", badge: b });
      }

      saveState();
      return {
        ok: true,
        result: { world: view, awarded, totalXp: rewards.xp, badges: rewards.badges },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Journal entries per stage: write a note/observation ──
  registerLensAction("expedition-journal", "entry-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const worldId = String(params.worldId || "");
      const stageId = params.stageId ? String(params.stageId) : null;
      const text = String(params.text || "").trim();
      if (!KNOWN_WORLDS.includes(worldId)) {
        return { ok: false, error: `unknown world: ${worldId}` };
      }
      if (!text) return { ok: false, error: "entry text required" };
      if (stageId && !stagesForWorld(worldId).some((d) => d.id === stageId)) {
        return { ok: false, error: `unknown stage: ${stageId}` };
      }
      let list = s.entries.get(userId);
      if (!list) { list = []; s.entries.set(userId, list); }
      const entry = {
        id: nextId("entry"),
        worldId,
        stageId,
        text: text.slice(0, 4000),
        mood: params.mood ? String(params.mood).slice(0, 32) : null,
        createdAt: nowIso(),
      };
      list.push(entry);
      saveState();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── List journal entries (optionally filtered by world / stage) ──
  registerLensAction("expedition-journal", "entry-list", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const worldId = params.worldId ? String(params.worldId) : null;
      const stageId = params.stageId ? String(params.stageId) : null;
      let list = (s.entries.get(userId) || []).slice();
      if (worldId) list = list.filter((e) => e.worldId === worldId);
      if (stageId) list = list.filter((e) => e.stageId === stageId);
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return { ok: true, result: { entries: list, count: list.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Delete a journal entry ──
  registerLensAction("expedition-journal", "entry-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const id = String(params.id || "");
      if (!id) return { ok: false, error: "entry id required" };
      const list = s.entries.get(userId) || [];
      const idx = list.findIndex((e) => e.id === id);
      if (idx === -1) return { ok: false, error: "entry not found" };
      list.splice(idx, 1);
      saveState();
      return { ok: true, result: { deleted: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Photo / screenshot capture per expedition stage ──
  registerLensAction("expedition-journal", "photo-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const worldId = String(params.worldId || "");
      const stageId = params.stageId ? String(params.stageId) : null;
      const dataUrl = String(params.dataUrl || params.url || "").trim();
      if (!KNOWN_WORLDS.includes(worldId)) {
        return { ok: false, error: `unknown world: ${worldId}` };
      }
      if (!dataUrl) return { ok: false, error: "photo dataUrl/url required" };
      if (!/^(data:image\/|https?:\/\/)/i.test(dataUrl)) {
        return { ok: false, error: "photo must be a data:image/ URL or http(s) URL" };
      }
      let list = s.photos.get(userId);
      if (!list) { list = []; s.photos.set(userId, list); }
      const photo = {
        id: nextId("photo"),
        worldId,
        stageId,
        caption: params.caption ? String(params.caption).slice(0, 200) : null,
        dataUrl: dataUrl.slice(0, 2_000_000),
        createdAt: nowIso(),
      };
      list.push(photo);
      saveState();
      // Return without echoing the (large) dataUrl back.
      const { dataUrl: _omit, ...meta } = photo;
      return { ok: true, result: { photo: meta } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── List photos (optionally filtered) ──
  registerLensAction("expedition-journal", "photo-list", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const worldId = params.worldId ? String(params.worldId) : null;
      const stageId = params.stageId ? String(params.stageId) : null;
      let list = (s.photos.get(userId) || []).slice();
      if (worldId) list = list.filter((p) => p.worldId === worldId);
      if (stageId) list = list.filter((p) => p.stageId === stageId);
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return { ok: true, result: { photos: list, count: list.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Delete a photo ──
  registerLensAction("expedition-journal", "photo-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const id = String(params.id || "");
      if (!id) return { ok: false, error: "photo id required" };
      const list = s.photos.get(userId) || [];
      const idx = list.findIndex((p) => p.id === id);
      if (idx === -1) return { ok: false, error: "photo not found" };
      list.splice(idx, 1);
      saveState();
      return { ok: true, result: { deleted: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Completion rewards: XP + earned badges ledger ──
  registerLensAction("expedition-journal", "rewards", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const r = rewardsFor(s, userId);
      return {
        ok: true,
        result: {
          xp: r.xp,
          level: 1 + Math.floor(r.xp / 200),
          badges: r.badges,
          log: r.log.slice(-50).reverse(),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Overall progress summary across all worlds ──
  registerLensAction("expedition-journal", "summary", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorOf(ctx);
      const worlds = KNOWN_WORLDS.map((w) => worldView(s, userId, w));
      const totalStages = worlds.reduce((a, w) => a + w.total, 0);
      const completedStages = worlds.reduce((a, w) => a + w.completed, 0);
      const completedWorlds = worlds.filter((w) => w.expeditionComplete).length;
      const r = rewardsFor(s, userId);
      const entries = (s.entries.get(userId) || []).length;
      const photos = (s.photos.get(userId) || []).length;
      return {
        ok: true,
        result: {
          worlds,
          totalStages,
          completedStages,
          overallPercent: totalStages ? Math.round((completedStages / totalStages) * 100) : 0,
          completedWorlds,
          totalWorlds: KNOWN_WORLDS.length,
          xp: r.xp,
          level: 1 + Math.floor(r.xp / 200),
          badgeCount: r.badges.length,
          entryCount: entries,
          photoCount: photos,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
