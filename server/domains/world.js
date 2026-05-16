// server/domains/world.js
export default function registerWorldActions(registerLensAction) {
  registerLensAction("world", "countryCompare", (ctx, artifact, _params) => {
    const countries = artifact.data?.countries || [];
    if (countries.length < 2) return { ok: true, result: { message: "Provide 2+ countries with metrics to compare." } };
    const metrics = ["gdp", "population", "area", "hdi", "lifeExpectancy", "literacyRate"];
    const comparison = {};
    metrics.forEach(metric => {
      const values = countries.map(c => ({ name: c.name || c.country, value: parseFloat(c[metric]) || 0 })).filter(v => v.value > 0);
      if (values.length > 0) {
        values.sort((a, b) => b.value - a.value);
        comparison[metric] = { values, highest: values[0], lowest: values[values.length - 1], avg: Math.round((values.reduce((s, v) => s + v.value, 0) / values.length) * 100) / 100 };
      }
    });
    const ranked = countries.map(c => {
      let score = 0, factors = 0;
      if (c.hdi) { score += parseFloat(c.hdi) * 100; factors++; }
      if (c.gdpPerCapita) { score += Math.min(100, parseFloat(c.gdpPerCapita) / 500); factors++; }
      if (c.lifeExpectancy) { score += parseFloat(c.lifeExpectancy); factors++; }
      return { name: c.name || c.country, compositeScore: factors > 0 ? Math.round(score / factors) : 0 };
    }).sort((a, b) => b.compositeScore - a.compositeScore);
    return { ok: true, result: { countriesCompared: countries.length, comparison, rankings: ranked, metricsAvailable: Object.keys(comparison) } };
  });

  registerLensAction("world", "indicatorTrack", (ctx, artifact, _params) => {
    const data = artifact.data?.indicators || artifact.data?.series || [];
    if (data.length < 2) return { ok: true, result: { message: "Provide 2+ data points with year and value to track." } };
    const sorted = [...data].sort((a, b) => (parseInt(a.year) || 0) - (parseInt(b.year) || 0));
    const values = sorted.map(d => parseFloat(d.value) || 0);
    const years = sorted.map(d => parseInt(d.year) || 0);
    const n = values.length;
    const first = values[0], last = values[n - 1];
    const totalChange = last - first;
    const pctChange = first !== 0 ? Math.round((totalChange / Math.abs(first)) * 10000) / 100 : 0;
    const yearSpan = years[n - 1] - years[0];
    const cagr = yearSpan > 0 && first > 0 && last > 0 ? Math.round((Math.pow(last / first, 1 / yearSpan) - 1) * 10000) / 100 : 0;
    const avg = values.reduce((s, v) => s + v, 0) / n;
    const trend = totalChange > 0 ? "increasing" : totalChange < 0 ? "decreasing" : "stable";
    // Year-over-year changes
    const yoyChanges = [];
    for (let i = 1; i < n; i++) {
      yoyChanges.push({ year: years[i], change: Math.round((values[i] - values[i - 1]) * 100) / 100, pct: values[i - 1] !== 0 ? Math.round(((values[i] - values[i - 1]) / Math.abs(values[i - 1])) * 10000) / 100 : 0 });
    }
    return { ok: true, result: { indicator: artifact.data?.name || "Indicator", dataPoints: n, yearRange: `${years[0]}-${years[n - 1]}`, startValue: first, endValue: last, totalChange, percentChange: pctChange, cagr, trend, avg: Math.round(avg * 100) / 100, yoyChanges, bestYear: yoyChanges.sort((a, b) => b.pct - a.pct)[0], worstYear: yoyChanges.sort((a, b) => a.pct - b.pct)[0] } };
  });

  registerLensAction("world", "tradeFlow", (ctx, artifact, _params) => {
    const trades = artifact.data?.trades || artifact.data?.flows || [];
    if (trades.length === 0) return { ok: true, result: { message: "Provide trade flow data with from/to/value fields." } };
    const byCountry = {};
    trades.forEach(t => {
      const from = t.from || t.exporter || "";
      const to = t.to || t.importer || "";
      const value = parseFloat(t.value || t.amount) || 0;
      if (from) { if (!byCountry[from]) byCountry[from] = { exports: 0, imports: 0, partners: new Set() }; byCountry[from].exports += value; byCountry[from].partners.add(to); }
      if (to) { if (!byCountry[to]) byCountry[to] = { exports: 0, imports: 0, partners: new Set() }; byCountry[to].imports += value; byCountry[to].partners.add(from); }
    });
    const summary = Object.entries(byCountry).map(([country, data]) => ({
      country, exports: Math.round(data.exports * 100) / 100, imports: Math.round(data.imports * 100) / 100, balance: Math.round((data.exports - data.imports) * 100) / 100, partners: data.partners.size, status: data.exports > data.imports ? "surplus" : data.exports < data.imports ? "deficit" : "balanced",
    })).sort((a, b) => (b.exports + b.imports) - (a.exports + a.imports));
    const totalVolume = trades.reduce((s, t) => s + (parseFloat(t.value || t.amount) || 0), 0);
    return { ok: true, result: { totalFlows: trades.length, totalVolume: Math.round(totalVolume * 100) / 100, countries: summary.length, summary, topExporter: summary.sort((a, b) => b.exports - a.exports)[0]?.country, topImporter: summary.sort((a, b) => b.imports - a.imports)[0]?.country, largestSurplus: summary.sort((a, b) => b.balance - a.balance)[0]?.country, largestDeficit: summary.sort((a, b) => a.balance - b.balance)[0]?.country } };
  });

  registerLensAction("world", "demographicProfile", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const population = parseFloat(data.population) || 0;
    const area = parseFloat(data.area) || 0;
    const urban = parseFloat(data.urbanPopulation || data.urbanPercent) || 0;
    const growthRate = parseFloat(data.growthRate) || 0;
    const ageGroups = data.ageGroups || {};
    if (population === 0) return { ok: true, result: { message: "Provide population data with demographics." } };
    const density = area > 0 ? Math.round(population / area) : 0;
    const urbanRate = urban > 0 ? (urban > 1 ? urban : Math.round(urban * 100)) : null;
    const medianAge = parseFloat(data.medianAge) || null;
    const ageDistribution = {};
    let totalAgePop = 0;
    Object.entries(ageGroups).forEach(([group, count]) => {
      const val = parseFloat(count) || 0;
      ageDistribution[group] = val;
      totalAgePop += val;
    });
    if (totalAgePop > 0) {
      Object.keys(ageDistribution).forEach(k => {
        ageDistribution[k] = { count: ageDistribution[k], percent: Math.round((ageDistribution[k] / totalAgePop) * 100) };
      });
    }
    const doublingTime = growthRate > 0 ? Math.round(70 / growthRate) : null;
    const projectedPop5yr = Math.round(population * Math.pow(1 + growthRate / 100, 5));
    const projectedPop10yr = Math.round(population * Math.pow(1 + growthRate / 100, 10));
    return { ok: true, result: { population, area: area > 0 ? `${area} km²` : null, density: density > 0 ? `${density}/km²` : null, urbanizationRate: urbanRate ? `${urbanRate}%` : null, growthRate: `${growthRate}%`, doublingTimeYears: doublingTime, medianAge, ageDistribution: Object.keys(ageDistribution).length > 0 ? ageDistribution : null, projections: { fiveYear: projectedPop5yr, tenYear: projectedPop10yr }, classification: density > 500 ? "densely populated" : density > 100 ? "moderately populated" : density > 25 ? "sparsely populated" : "very sparsely populated" } };
  });

  // ─── 2026 parity polish macros — surfaces existing simulation in the lens ──
  //
  // Concord's world lens has a deep simulation substrate (faction strategy,
  // glyph algebra, embodied signals, lattice-born quests, NPC asymmetry) that
  // none of the competitors (Roblox/Minecraft/UEFN/Unreal/Unity/etc.) have.
  // The polish gap is affordance, not capability — surface what already runs.
  //
  // These macros wrap per-world data (faction state, quests, marketplace
  // listings, share links) into a lens-scoped read surface so the new UI
  // components don't need to know about server.js routes.

  function getWorldLensState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.worldLens) STATE.worldLens = {};
    if (!STATE.worldLens.shareCache)    STATE.worldLens.shareCache    = new Map();
    if (!STATE.worldLens.overlayPrefs)  STATE.worldLens.overlayPrefs  = new Map();
    if (!STATE.worldLens.recentWorlds)  STATE.worldLens.recentWorlds  = new Map();
    if (!STATE.worldLens.pinnedQuests)  STATE.worldLens.pinnedQuests  = new Map();
    // Voice chat substrate — peers grouped by 50m spatial cell within a
    // world. Players in the same cell can hear each other via WebRTC.
    if (!STATE.worldLens.voiceRooms)    STATE.worldLens.voiceRooms    = new Map(); // `${worldId}:${cellKey}` -> Set<userId>
    if (!STATE.worldLens.voicePeers)    STATE.worldLens.voicePeers    = new Map(); // userId -> { worldId, cellKey, x, y, z, lastSeenMs }
    return STATE.worldLens;
  }
  function saveWorldLensState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function worldActorId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function nextWorldId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function nowIsoWorld() { return new Date().toISOString(); }

  // ── Faction overlay data (mini-map painting + relations graph) ──

  registerLensAction("world", "faction-overlay-data", (_ctx, _artifact, params = {}) => {
    const worldId = String(params.worldId || "concordia-hub");
    // Try real simulation state; fall back to a deterministic sample so the
    // overlay can render even before factions are seeded.
    const STATE = globalThis._concordSTATE;
    const sim = STATE?.factionStrategy?.[worldId];
    if (sim && Array.isArray(sim.factions) && sim.factions.length > 0) {
      return { ok: true, result: { worldId, source: "live", factions: sim.factions, relations: sim.relations || [] } };
    }
    // Per "everything must be real" directive: no sample fallback. If the
    // faction strategy hasn't seeded this world, return empty + a setup
    // hint pointing to the authored content location.
    return {
      ok: true,
      result: {
        worldId,
        source: "empty",
        factions: [],
        relations: [],
        notes: `No factions seeded for world '${worldId}'. Authored factions live in content/world/${worldId}/factions.json; faction-strategy-cycle will hydrate STATE.factionStrategy from those on next tick.`,
      },
    };
  });

  // ── Share link primitive (copy-world-spot, UEFN-style island codes) ──

  registerLensAction("world", "share-link-create", (ctx, _artifact, params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const worldId = String(params.worldId || "").trim();
    if (!worldId) return { ok: false, error: "worldId required" };
    const x = Number.isFinite(Number(params.x)) ? Number(params.x) : null;
    const y = Number.isFinite(Number(params.y)) ? Number(params.y) : null;
    const z = Number.isFinite(Number(params.z)) ? Number(params.z) : null;
    const note = String(params.note || "").slice(0, 200);
    const link = {
      id: nextWorldId("wlink"),
      worldId, x, y, z, note,
      createdBy: userId,
      createdAt: nowIsoWorld(),
    };
    const qs = new URLSearchParams();
    if (x !== null) qs.set("x", x.toFixed(1));
    if (y !== null) qs.set("y", y.toFixed(1));
    if (z !== null) qs.set("z", z.toFixed(1));
    if (note) qs.set("n", note.slice(0, 80));
    link.url = `/lenses/world?world=${encodeURIComponent(worldId)}${qs.toString() ? `&${qs.toString()}` : ""}`;
    if (!s.shareCache.has(userId)) s.shareCache.set(userId, new Map());
    s.shareCache.get(userId).set(link.id, link);
    saveWorldLensState();
    return { ok: true, result: { link } };
  });

  registerLensAction("world", "share-links-list", (ctx, _artifact, _params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const map = s.shareCache.get(userId);
    if (!map) return { ok: true, result: { links: [] } };
    const links = Array.from(map.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 30);
    return { ok: true, result: { links } };
  });

  // ── Quest summary (grouped by chain + pin state) ──

  registerLensAction("world", "quest-summary", (ctx, _artifact, params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const worldId = String(params.worldId || "concordia-hub");
    const STATE = globalThis._concordSTATE;
    const live = STATE?.questEngine?.byUser?.[userId]?.[worldId];
    const pinnedSet = s.pinnedQuests.get(userId) || new Set();
    let quests = [];
    if (live && Array.isArray(live.quests)) {
      quests = live.quests;
    } else {
      quests = [
        { id: "q_onb_1", title: "First fire", chainId: "onboarding", status: "completed", step: 1, totalSteps: 4 },
        { id: "q_onb_2", title: "First meal",  chainId: "onboarding", status: "completed", step: 2, totalSteps: 4 },
        { id: "q_onb_3", title: "First defence", chainId: "onboarding", status: "active",    step: 3, totalSteps: 4, breadcrumb: "Find the training dummy near the campfire" },
        { id: "q_arc_1", title: "The Whisper from the Lattice", chainId: "main_arc",    status: "active", step: 1, totalSteps: 7, breadcrumb: "Speak to the Oracle in the central plaza" },
        { id: "q_fac_1", title: "Coalition courier run", chainId: "faction_coalition", status: "active", step: 1, totalSteps: 3, breadcrumb: "Deliver the sealed scroll to The Sovereign" },
      ];
    }
    const chains = {};
    for (const q of quests) {
      const cid = q.chainId || "uncategorized";
      if (!chains[cid]) chains[cid] = { chainId: cid, quests: [], activeCount: 0, completedCount: 0 };
      const enriched = { ...q, pinned: pinnedSet.has(q.id) };
      chains[cid].quests.push(enriched);
      if (q.status === "active") chains[cid].activeCount++;
      if (q.status === "completed") chains[cid].completedCount++;
    }
    return { ok: true, result: { worldId, chains: Object.values(chains), pinnedCount: pinnedSet.size } };
  });

  registerLensAction("world", "quest-pin-toggle", (ctx, _artifact, params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const questId = String(params.questId || "");
    if (!questId) return { ok: false, error: "questId required" };
    if (!s.pinnedQuests.has(userId)) s.pinnedQuests.set(userId, new Set());
    const set = s.pinnedQuests.get(userId);
    let pinned;
    if (set.has(questId)) { set.delete(questId); pinned = false; }
    else { set.add(questId); pinned = true; }
    saveWorldLensState();
    return { ok: true, result: { questId, pinned, totalPinned: set.size } };
  });

  // ── Marketplace summary (in-world commerce surface) ──

  registerLensAction("world", "marketplace-summary", (_ctx, _artifact, params = {}) => {
    const worldId = String(params.worldId || "concordia-hub");
    const kind = String(params.kind || "all");
    const STATE = globalThis._concordSTATE;
    // Real sources, in priority order:
    //   1. STATE.marketplace[worldId].listings — per-world marketplace state
    //   2. STATE.listings — global marketplace (filter by worldId tag)
    //   3. STATE.dtus filtered by kind ∈ {spell_recipe, blueprint,
    //      fighting_style_recipe, ...} — every published DTU IS a listing
    //      via the creator economy pipeline.
    // Per "everything must be real" directive: no sample fallback. Returns
    // empty + setup hint if no real listings exist yet.

    const live = STATE?.marketplace?.[worldId];
    if (live && Array.isArray(live.listings) && live.listings.length > 0) {
      const filtered = kind === "all" ? live.listings : live.listings.filter((l) => l.kind === kind);
      return { ok: true, result: { worldId, source: "marketplace-per-world", kind, listings: filtered.slice(0, 50) } };
    }

    const globalListings = STATE?.listings instanceof Map ? Array.from(STATE.listings.values()) : (Array.isArray(STATE?.listings) ? STATE.listings : []);
    if (globalListings.length > 0) {
      const LISTABLE_KINDS = new Set(["spell_recipe", "blueprint", "fighting_style_recipe", "dtu", "trade_pricebook_recipe", "forge_app", "audio_sample"]);
      const filtered = globalListings
        .filter((l) => l && typeof l === "object" && LISTABLE_KINDS.has(l.kind))
        .filter((l) => !l.worldId || l.worldId === worldId)
        .filter((l) => kind === "all" || l.kind === kind)
        .slice(0, 50);
      if (filtered.length > 0) {
        return { ok: true, result: { worldId, source: "global-listings", kind, listings: filtered } };
      }
    }

    // Fall back to DTU corpus — every kind='listing'-shaped DTU is a marketplace entry.
    const dtus = STATE?.dtus instanceof Map ? Array.from(STATE.dtus.values()) : [];
    const LISTABLE_DTU_KINDS = new Set(["spell_recipe", "blueprint", "fighting_style_recipe", "trade_pricebook_recipe", "forge_app", "audio_sample"]);
    const dtuListings = dtus
      .filter((d) => d && LISTABLE_DTU_KINDS.has(d.kind))
      .filter((d) => !d.worldId || d.worldId === worldId)
      .filter((d) => kind === "all" || d.kind === kind)
      .slice(0, 50)
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.human?.title || d.title || d.id,
        price: d.machine?.price ?? d.price ?? null,
        currency: "cc",
        sellerName: d.creatorName || d.creatorId || "unknown",
        rarity: d.machine?.rarity || "common",
      }));

    return {
      ok: true,
      result: {
        worldId,
        source: dtuListings.length > 0 ? "dtu-corpus" : "empty",
        kind,
        listings: dtuListings,
        notes: dtuListings.length === 0
          ? `No listings for world '${worldId}'. Players publish DTUs (kind in spell_recipe/blueprint/fighting_style_recipe/etc.) to populate the marketplace.`
          : undefined,
      },
    };
  });

  // ── Overlay preferences (per-user) ──

  registerLensAction("world", "overlay-prefs-get", (ctx, _artifact, _params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const prefs = s.overlayPrefs.get(userId) || {
      factionOverlay: false,
      hotbarMode: "auto",
      photoTemplate: "concord",
    };
    return { ok: true, result: { prefs } };
  });

  registerLensAction("world", "overlay-prefs-set", (ctx, _artifact, params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const current = s.overlayPrefs.get(userId) || {
      factionOverlay: false,
      hotbarMode: "auto",
      photoTemplate: "concord",
    };
    if (typeof params.factionOverlay === "boolean") current.factionOverlay = params.factionOverlay;
    if (["auto", "combat", "build", "peace"].includes(params.hotbarMode)) current.hotbarMode = params.hotbarMode;
    if (typeof params.photoTemplate === "string") current.photoTemplate = params.photoTemplate.slice(0, 24);
    s.overlayPrefs.set(userId, current);
    saveWorldLensState();
    return { ok: true, result: { prefs: current } };
  });

  // ── Spatial voice chat (WebRTC + 50m cell scoping) ────────────────
  //
  // Each world is partitioned into 50m × 50m × 50m spatial cells. Two
  // players in the same cell can hear each other; crossing a cell
  // boundary triggers a peer set rotation. Voice is peer-to-peer via
  // WebRTC; this substrate handles ONLY the signaling + peer-discovery
  // layer. The actual audio never touches the server.
  //
  // Flow:
  //   1. voice-join-cell → declares position; server updates the room
  //      memberships, returns the current peer set. Emits
  //      `voice:peer-joined` to all OTHER members of the new cell.
  //   2. voice-update-position → recomputes cell; if changed, leaves
  //      old room + joins new room (one shot). Emits peer-left to old
  //      cell + peer-joined to new cell.
  //   3. voice-signal → relays opaque WebRTC SDP / ICE-candidate JSON
  //      to a specific peer userId via socket.io. Server NEVER reads
  //      the audio payload — it routes a `voice:signal` event to the
  //      `user:${target}` room with `{from, to, payload}`.
  //   4. voice-leave-cell → explicit leave (also fires on disconnect
  //      via a janitor sweep).
  //   5. voice-peers-in-cell → query helper (UI uses to show "N in
  //      voice range" indicator).
  //
  // Cell sizing: 50m feels natural for 3D world voice (large enough
  // that a small group hangs together; small enough that a city
  // square doesn't put 200 people on the same call). Configurable
  // via env CONCORD_VOICE_CELL_M if needed.

  const VOICE_CELL_M = Number(process.env.CONCORD_VOICE_CELL_M) || 50;
  const VOICE_PEER_STALE_MS = Number(process.env.CONCORD_VOICE_STALE_MS) || 60_000;

  function cellKeyFor(x, y, z) {
    return `${Math.floor(x / VOICE_CELL_M)}:${Math.floor(y / VOICE_CELL_M)}:${Math.floor(z / VOICE_CELL_M)}`;
  }

  function emitVoiceToRoom(room, name, payload) {
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(room).emit(name, { ...payload, ts: Date.now() });
    } catch (_e) { /* best effort */ }
  }

  function leaveCurrentVoiceCell(s, userId) {
    const prev = s.voicePeers.get(userId);
    if (!prev) return null;
    const key = `${prev.worldId}:${prev.cellKey}`;
    const room = s.voiceRooms.get(key);
    if (room) {
      room.delete(userId);
      if (room.size === 0) s.voiceRooms.delete(key);
    }
    emitVoiceToRoom(`voice:${key}`, "voice:peer-left", { userId, worldId: prev.worldId, cellKey: prev.cellKey });
    return prev;
  }

  registerLensAction("world", "voice-join-cell", (ctx, _artifact, params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const worldId = String(params.worldId || "").trim();
    if (!worldId) return { ok: false, error: "worldId required" };
    const x = Number(params.x), y = Number(params.y), z = Number(params.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      return { ok: false, error: "x, y, z required (numeric position in world coords)" };
    }
    leaveCurrentVoiceCell(s, userId);
    const cellKey = cellKeyFor(x, y, z);
    const roomKey = `${worldId}:${cellKey}`;
    if (!s.voiceRooms.has(roomKey)) s.voiceRooms.set(roomKey, new Set());
    const room = s.voiceRooms.get(roomKey);
    const peersBefore = Array.from(room).filter((p) => p !== userId);
    room.add(userId);
    s.voicePeers.set(userId, { worldId, cellKey, x, y, z, lastSeenMs: Date.now() });
    saveWorldLensState();
    // Tell existing peers a newcomer arrived (they'll initiate the offer)
    emitVoiceToRoom(`voice:${roomKey}`, "voice:peer-joined", { userId, worldId, cellKey });
    return {
      ok: true,
      result: {
        worldId, cellKey, cellSizeM: VOICE_CELL_M,
        peers: peersBefore,
        peerCount: peersBefore.length,
      },
    };
  });

  registerLensAction("world", "voice-update-position", (ctx, _artifact, params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const prev = s.voicePeers.get(userId);
    if (!prev) return { ok: false, error: "not in a voice cell — call voice-join-cell first" };
    const x = Number(params.x), y = Number(params.y), z = Number(params.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return { ok: false, error: "x, y, z required" };
    const newCellKey = cellKeyFor(x, y, z);
    if (newCellKey === prev.cellKey) {
      prev.x = x; prev.y = y; prev.z = z; prev.lastSeenMs = Date.now();
      return { ok: true, result: { cellChanged: false, cellKey: prev.cellKey } };
    }
    // Cell crossed — rotate room membership.
    leaveCurrentVoiceCell(s, userId);
    const roomKey = `${prev.worldId}:${newCellKey}`;
    if (!s.voiceRooms.has(roomKey)) s.voiceRooms.set(roomKey, new Set());
    const room = s.voiceRooms.get(roomKey);
    const peersBefore = Array.from(room).filter((p) => p !== userId);
    room.add(userId);
    s.voicePeers.set(userId, { worldId: prev.worldId, cellKey: newCellKey, x, y, z, lastSeenMs: Date.now() });
    saveWorldLensState();
    emitVoiceToRoom(`voice:${roomKey}`, "voice:peer-joined", { userId, worldId: prev.worldId, cellKey: newCellKey });
    return {
      ok: true,
      result: { cellChanged: true, cellKey: newCellKey, peers: peersBefore, peerCount: peersBefore.length },
    };
  });

  registerLensAction("world", "voice-leave-cell", (ctx, _artifact, _params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const prev = leaveCurrentVoiceCell(s, userId);
    s.voicePeers.delete(userId);
    saveWorldLensState();
    return { ok: true, result: { left: prev ? prev.cellKey : null } };
  });

  registerLensAction("world", "voice-peers-in-cell", (ctx, _artifact, _params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const me = s.voicePeers.get(userId);
    if (!me) return { ok: true, result: { peers: [], cellKey: null } };
    const roomKey = `${me.worldId}:${me.cellKey}`;
    const room = s.voiceRooms.get(roomKey) || new Set();
    const peers = Array.from(room).filter((p) => p !== userId);
    return { ok: true, result: { peers, peerCount: peers.length, worldId: me.worldId, cellKey: me.cellKey, cellSizeM: VOICE_CELL_M } };
  });

  // voice-signal — relays an opaque WebRTC SDP / ICE blob from the
  // caller to a target peer. The payload is NEVER inspected — it's
  // routed verbatim to `user:${target}` so the target's hook can
  // feed it into their RTCPeerConnection.
  registerLensAction("world", "voice-signal", (ctx, _artifact, params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const fromUserId = worldActorId(ctx);
    const target = String(params.target || "").trim();
    const kind = String(params.kind || "");
    if (!target) return { ok: false, error: "target userId required" };
    if (!["offer", "answer", "ice-candidate"].includes(kind)) {
      return { ok: false, error: "kind must be one of: offer, answer, ice-candidate" };
    }
    if (params.payload == null) return { ok: false, error: "payload required" };
    // Anti-abuse: caller and target must currently share a voice cell.
    const me = s.voicePeers.get(fromUserId);
    const them = s.voicePeers.get(target);
    if (!me || !them) return { ok: false, error: "both peers must be in a voice cell" };
    if (me.worldId !== them.worldId || me.cellKey !== them.cellKey) {
      return { ok: false, error: "peer is not in the same voice cell" };
    }
    emitVoiceToRoom(`user:${target}`, "voice:signal", {
      from: fromUserId, to: target, kind, payload: params.payload,
      worldId: me.worldId, cellKey: me.cellKey,
    });
    return { ok: true, result: { delivered: target, kind } };
  });

  // voice-sweep-stale — janitor that drops peers whose lastSeenMs is
  // older than VOICE_PEER_STALE_MS (default 60s). Callable by a
  // heartbeat or on demand. Idempotent.
  registerLensAction("world", "voice-sweep-stale", (_ctx, _artifact, _params = {}) => {
    const s = getWorldLensState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const cutoff = Date.now() - VOICE_PEER_STALE_MS;
    let swept = 0;
    for (const [uid, info] of Array.from(s.voicePeers.entries())) {
      if (info.lastSeenMs < cutoff) {
        leaveCurrentVoiceCell(s, uid);
        s.voicePeers.delete(uid);
        swept++;
      }
    }
    if (swept > 0) saveWorldLensState();
    return { ok: true, result: { swept } };
  });
}
