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

  // ════════════════════════════════════════════════════════════════
  // 3D open-world feature-parity backlog (vs Roblox / Genshin Impact)
  // ════════════════════════════════════════════════════════════════
  //
  // Eight gameplay-UX systems the open-world spec calls out. Each
  // persists in a dedicated STATE.worldLens Map keyed by ctx.userId.
  // All data is real user input — no seed/demo content. Empty maps
  // produce empty lists, never invented samples.

  function getKitState() {
    const s = getWorldLensState();
    if (!s) return null;
    if (!s.placements)   s.placements   = new Map(); // userId -> Map<placementId, placement>
    if (!s.inventory)    s.inventory    = new Map(); // userId -> { slots, items }
    if (!s.parties)      s.parties      = new Map(); // partyId -> party
    if (!s.partyOf)      s.partyOf      = new Map(); // userId -> partyId
    if (!s.mapMarkers)   s.mapMarkers   = new Map(); // userId -> Map<markerId, marker>
    if (!s.mounts)       s.mounts       = new Map(); // userId -> { roster, activeId }
    if (!s.combatPrefs)  s.combatPrefs  = new Map(); // userId -> { lockOn, dodge, abilities }
    if (!s.streamPrefs)  s.streamPrefs  = new Map(); // userId -> { lodBias, drawDistance, ... }
    if (!s.photos)       s.photos       = new Map(); // userId -> Map<photoId, photo>
    return s;
  }

  // ── 1. In-world building / placement editor ──────────────────────
  // A player places, moves, and removes structures directly in the
  // 3D scene. Each placement is a real DTU-shaped record with world
  // coords, rotation, scale, and a kit kind.

  const PLACEMENT_KINDS = new Set([
    "wall", "floor", "roof", "door", "window", "pillar",
    "fence", "light", "decoration", "prop", "platform", "stair",
  ]);

  registerLensAction("world", "placement-create", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const worldId = String(params.worldId || "").trim();
    if (!worldId) return { ok: false, error: "worldId required" };
    const kind = String(params.kind || "").trim();
    if (!PLACEMENT_KINDS.has(kind)) {
      return { ok: false, error: `kind must be one of: ${[...PLACEMENT_KINDS].join(", ")}` };
    }
    const x = Number(params.x), y = Number(params.y), z = Number(params.z);
    if (![x, y, z].every(Number.isFinite)) return { ok: false, error: "x, y, z required (numeric)" };
    const placement = {
      id: nextWorldId("place"),
      worldId, kind,
      x, y, z,
      rotation: Number.isFinite(Number(params.rotation)) ? Number(params.rotation) % 360 : 0,
      scale: Number.isFinite(Number(params.scale)) ? Math.max(0.1, Math.min(20, Number(params.scale))) : 1,
      color: typeof params.color === "string" ? params.color.slice(0, 16) : null,
      label: String(params.label || "").slice(0, 60),
      ownerId: userId,
      createdAt: nowIsoWorld(),
      updatedAt: nowIsoWorld(),
    };
    if (!s.placements.has(userId)) s.placements.set(userId, new Map());
    s.placements.get(userId).set(placement.id, placement);
    saveWorldLensState();
    return { ok: true, result: { placement } };
  });

  registerLensAction("world", "placement-update", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const map = s.placements.get(userId);
    const id = String(params.id || "");
    const p = map?.get(id);
    if (!p) return { ok: false, error: "placement not found" };
    for (const axis of ["x", "y", "z"]) {
      if (params[axis] != null && Number.isFinite(Number(params[axis]))) p[axis] = Number(params[axis]);
    }
    if (params.rotation != null && Number.isFinite(Number(params.rotation))) p.rotation = Number(params.rotation) % 360;
    if (params.scale != null && Number.isFinite(Number(params.scale))) p.scale = Math.max(0.1, Math.min(20, Number(params.scale)));
    if (typeof params.color === "string") p.color = params.color.slice(0, 16);
    if (typeof params.label === "string") p.label = params.label.slice(0, 60);
    p.updatedAt = nowIsoWorld();
    saveWorldLensState();
    return { ok: true, result: { placement: p } };
  });

  registerLensAction("world", "placement-delete", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const map = s.placements.get(userId);
    const id = String(params.id || "");
    if (!map || !map.has(id)) return { ok: false, error: "placement not found" };
    map.delete(id);
    saveWorldLensState();
    return { ok: true, result: { deleted: id } };
  });

  registerLensAction("world", "placement-list", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const worldId = params.worldId ? String(params.worldId) : null;
    const map = s.placements.get(userId);
    let placements = map ? Array.from(map.values()) : [];
    if (worldId) placements = placements.filter((p) => p.worldId === worldId);
    placements.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { placements, count: placements.length } };
  });

  // ── 2. Inventory / equipment ─────────────────────────────────────
  // A bag of items + named equipment slots. Items carry a rarity and
  // a quantity; equip moves an item id into a slot, unequip clears it.

  const EQUIP_SLOTS = ["head", "chest", "legs", "feet", "hands", "mainhand", "offhand", "trinket"];

  function ensureInventory(s, userId) {
    if (!s.inventory.has(userId)) {
      s.inventory.set(userId, {
        items: [],
        slots: Object.fromEntries(EQUIP_SLOTS.map((k) => [k, null])),
      });
    }
    return s.inventory.get(userId);
  }

  registerLensAction("world", "inventory-get", (ctx, _artifact, _params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = ensureInventory(s, worldActorId(ctx));
    return { ok: true, result: { items: inv.items, slots: inv.slots, slotNames: EQUIP_SLOTS } };
  });

  registerLensAction("world", "inventory-add-item", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = ensureInventory(s, worldActorId(ctx));
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const qty = Math.max(1, Math.floor(Number(params.quantity) || 1));
    const item = {
      id: nextWorldId("item"),
      name: name.slice(0, 80),
      kind: String(params.kind || "misc").slice(0, 24),
      slot: EQUIP_SLOTS.includes(params.slot) ? params.slot : null,
      rarity: ["common", "uncommon", "rare", "epic", "legendary"].includes(params.rarity) ? params.rarity : "common",
      quantity: qty,
      stats: params.stats && typeof params.stats === "object" ? params.stats : {},
      icon: String(params.icon || "").slice(0, 24) || null,
      acquiredAt: nowIsoWorld(),
    };
    inv.items.push(item);
    saveWorldLensState();
    return { ok: true, result: { item } };
  });

  registerLensAction("world", "inventory-remove-item", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = ensureInventory(s, worldActorId(ctx));
    const id = String(params.id || "");
    const idx = inv.items.findIndex((i) => i.id === id);
    if (idx === -1) return { ok: false, error: "item not found" };
    inv.items.splice(idx, 1);
    for (const slot of EQUIP_SLOTS) if (inv.slots[slot] === id) inv.slots[slot] = null;
    saveWorldLensState();
    return { ok: true, result: { removed: id } };
  });

  registerLensAction("world", "inventory-equip", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = ensureInventory(s, worldActorId(ctx));
    const id = String(params.id || "");
    const item = inv.items.find((i) => i.id === id);
    if (!item) return { ok: false, error: "item not found" };
    const slot = String(params.slot || item.slot || "");
    if (!EQUIP_SLOTS.includes(slot)) return { ok: false, error: `slot must be one of: ${EQUIP_SLOTS.join(", ")}` };
    if (item.slot && item.slot !== slot) return { ok: false, error: `item ${item.name} cannot go in ${slot}` };
    inv.slots[slot] = id;
    saveWorldLensState();
    return { ok: true, result: { slot, equipped: id, slots: inv.slots } };
  });

  registerLensAction("world", "inventory-unequip", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = ensureInventory(s, worldActorId(ctx));
    const slot = String(params.slot || "");
    if (!EQUIP_SLOTS.includes(slot)) return { ok: false, error: `slot must be one of: ${EQUIP_SLOTS.join(", ")}` };
    const wasEquipped = inv.slots[slot];
    inv.slots[slot] = null;
    saveWorldLensState();
    return { ok: true, result: { slot, unequipped: wasEquipped, slots: inv.slots } };
  });

  // ── 3. Party / group play ────────────────────────────────────────
  // Co-op grouping with a shared objective. The leader creates the
  // party; others join by id. A party is destroyed when the last
  // member leaves.

  function partyView(party) {
    return {
      id: party.id,
      name: party.name,
      leaderId: party.leaderId,
      members: party.members,
      memberCount: party.members.length,
      objective: party.objective,
      worldId: party.worldId,
      createdAt: party.createdAt,
    };
  }

  registerLensAction("world", "party-create", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    if (s.partyOf.has(userId)) return { ok: false, error: "already in a party — leave first" };
    const party = {
      id: nextWorldId("party"),
      name: String(params.name || "").slice(0, 50) || "Adventuring party",
      leaderId: userId,
      members: [userId],
      objective: String(params.objective || "").slice(0, 200) || null,
      worldId: String(params.worldId || "concordia-hub"),
      createdAt: nowIsoWorld(),
    };
    s.parties.set(party.id, party);
    s.partyOf.set(userId, party.id);
    saveWorldLensState();
    return { ok: true, result: { party: partyView(party) } };
  });

  registerLensAction("world", "party-join", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    if (s.partyOf.has(userId)) return { ok: false, error: "already in a party — leave first" };
    const party = s.parties.get(String(params.partyId || ""));
    if (!party) return { ok: false, error: "party not found" };
    if (party.members.length >= 8) return { ok: false, error: "party is full (8 max)" };
    party.members.push(userId);
    s.partyOf.set(userId, party.id);
    saveWorldLensState();
    return { ok: true, result: { party: partyView(party) } };
  });

  registerLensAction("world", "party-leave", (ctx, _artifact, _params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const partyId = s.partyOf.get(userId);
    if (!partyId) return { ok: false, error: "not in a party" };
    const party = s.parties.get(partyId);
    s.partyOf.delete(userId);
    if (party) {
      party.members = party.members.filter((m) => m !== userId);
      if (party.members.length === 0) {
        s.parties.delete(partyId);
      } else if (party.leaderId === userId) {
        party.leaderId = party.members[0];
      }
    }
    saveWorldLensState();
    return { ok: true, result: { left: partyId } };
  });

  registerLensAction("world", "party-get", (ctx, _artifact, _params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const partyId = s.partyOf.get(userId);
    const party = partyId ? s.parties.get(partyId) : null;
    return { ok: true, result: { party: party ? partyView(party) : null } };
  });

  registerLensAction("world", "party-set-objective", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const partyId = s.partyOf.get(userId);
    const party = partyId ? s.parties.get(partyId) : null;
    if (!party) return { ok: false, error: "not in a party" };
    if (party.leaderId !== userId) return { ok: false, error: "only the party leader can set the objective" };
    party.objective = String(params.objective || "").slice(0, 200) || null;
    saveWorldLensState();
    return { ok: true, result: { party: partyView(party) } };
  });

  // ── 4. Minimap + world map fast-travel points ────────────────────
  // Players drop named map markers. A marker flagged fastTravel is a
  // teleport destination surfaced in the world map.

  const MARKER_KINDS = ["waypoint", "town", "dungeon", "vendor", "resource", "danger", "home", "portal"];

  registerLensAction("world", "marker-create", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const worldId = String(params.worldId || "").trim();
    if (!worldId) return { ok: false, error: "worldId required" };
    const x = Number(params.x), z = Number(params.z);
    if (![x, z].every(Number.isFinite)) return { ok: false, error: "x, z required (numeric)" };
    const marker = {
      id: nextWorldId("mark"),
      worldId,
      name: String(params.name || "").slice(0, 60) || "Marker",
      kind: MARKER_KINDS.includes(params.kind) ? params.kind : "waypoint",
      x, y: Number.isFinite(Number(params.y)) ? Number(params.y) : 0, z,
      fastTravel: params.fastTravel === true,
      ownerId: userId,
      createdAt: nowIsoWorld(),
    };
    if (!s.mapMarkers.has(userId)) s.mapMarkers.set(userId, new Map());
    s.mapMarkers.get(userId).set(marker.id, marker);
    saveWorldLensState();
    return { ok: true, result: { marker } };
  });

  registerLensAction("world", "marker-delete", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.mapMarkers.get(worldActorId(ctx));
    const id = String(params.id || "");
    if (!map || !map.has(id)) return { ok: false, error: "marker not found" };
    map.delete(id);
    saveWorldLensState();
    return { ok: true, result: { deleted: id } };
  });

  registerLensAction("world", "marker-list", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.mapMarkers.get(worldActorId(ctx));
    const worldId = params.worldId ? String(params.worldId) : null;
    let markers = map ? Array.from(map.values()) : [];
    if (worldId) markers = markers.filter((m) => m.worldId === worldId);
    markers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      ok: true,
      result: { markers, count: markers.length, fastTravelPoints: markers.filter((m) => m.fastTravel) },
    };
  });

  registerLensAction("world", "marker-fast-travel", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.mapMarkers.get(worldActorId(ctx));
    const marker = map?.get(String(params.id || ""));
    if (!marker) return { ok: false, error: "marker not found" };
    if (!marker.fastTravel) return { ok: false, error: "marker is not a fast-travel point" };
    // The route layer / 3D scene teleports the avatar; this returns
    // the destination coords + emits a realtime hint.
    emitVoiceToRoom(`user:${worldActorId(ctx)}`, "world:fast-travel", {
      worldId: marker.worldId, x: marker.x, y: marker.y, z: marker.z, markerId: marker.id,
    });
    return {
      ok: true,
      result: { destination: { worldId: marker.worldId, x: marker.x, y: marker.y, z: marker.z }, marker },
    };
  });

  // ── 5. Mounts / vehicles UX ──────────────────────────────────────
  // A roster of summonable mounts. Summon sets the active mount;
  // dismiss clears it.

  function ensureMounts(s, userId) {
    if (!s.mounts.has(userId)) s.mounts.set(userId, { roster: [], activeId: null });
    return s.mounts.get(userId);
  }

  registerLensAction("world", "mount-add", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = ensureMounts(s, worldActorId(ctx));
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const mount = {
      id: nextWorldId("mount"),
      name: name.slice(0, 60),
      species: String(params.species || "horse").slice(0, 32),
      speed: Math.max(1, Math.min(100, Math.floor(Number(params.speed) || 12))),
      stamina: Math.max(1, Math.min(100, Math.floor(Number(params.stamina) || 50))),
      kind: ["ground", "flying", "aquatic"].includes(params.kind) ? params.kind : "ground",
      acquiredAt: nowIsoWorld(),
    };
    m.roster.push(mount);
    saveWorldLensState();
    return { ok: true, result: { mount } };
  });

  registerLensAction("world", "mount-remove", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = ensureMounts(s, worldActorId(ctx));
    const id = String(params.id || "");
    const idx = m.roster.findIndex((x) => x.id === id);
    if (idx === -1) return { ok: false, error: "mount not found" };
    m.roster.splice(idx, 1);
    if (m.activeId === id) m.activeId = null;
    saveWorldLensState();
    return { ok: true, result: { removed: id } };
  });

  registerLensAction("world", "mount-summon", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const m = ensureMounts(s, userId);
    const id = String(params.id || "");
    const mount = m.roster.find((x) => x.id === id);
    if (!mount) return { ok: false, error: "mount not found" };
    m.activeId = id;
    saveWorldLensState();
    emitVoiceToRoom(`user:${userId}`, "world:mount-summoned", { mountId: id, species: mount.species });
    return { ok: true, result: { active: mount } };
  });

  registerLensAction("world", "mount-dismiss", (ctx, _artifact, _params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = ensureMounts(s, worldActorId(ctx));
    const was = m.activeId;
    m.activeId = null;
    saveWorldLensState();
    return { ok: true, result: { dismissed: was } };
  });

  registerLensAction("world", "mount-list", (ctx, _artifact, _params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = ensureMounts(s, worldActorId(ctx));
    const active = m.roster.find((x) => x.id === m.activeId) || null;
    return { ok: true, result: { roster: m.roster, activeId: m.activeId, active } };
  });

  // ── 6. Combat depth — targeting / dodge / ability cooldowns ──────
  // Persists per-user combat config: lock-on toggle, dodge style, and
  // a hotbar of abilities each with a cooldown clock. Cooldown state
  // is computed live from a lastUsedMs timestamp.

  function ensureCombatPrefs(s, userId) {
    if (!s.combatPrefs.has(userId)) {
      s.combatPrefs.set(userId, { lockOn: true, dodgeStyle: "roll", blockEnabled: true, abilities: [] });
    }
    return s.combatPrefs.get(userId);
  }

  function abilityView(a, nowMs) {
    const elapsed = nowMs - (a.lastUsedMs || 0);
    const remaining = Math.max(0, a.cooldownMs - elapsed);
    return {
      id: a.id, name: a.name, slot: a.slot, element: a.element,
      cooldownMs: a.cooldownMs,
      cooldownRemainingMs: remaining,
      ready: remaining === 0,
    };
  }

  registerLensAction("world", "combat-prefs-get", (ctx, _artifact, _params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const cp = ensureCombatPrefs(s, worldActorId(ctx));
    const now = Date.now();
    return {
      ok: true,
      result: {
        lockOn: cp.lockOn, dodgeStyle: cp.dodgeStyle, blockEnabled: cp.blockEnabled,
        abilities: cp.abilities.map((a) => abilityView(a, now)),
      },
    };
  });

  registerLensAction("world", "combat-prefs-set", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const cp = ensureCombatPrefs(s, worldActorId(ctx));
    if (typeof params.lockOn === "boolean") cp.lockOn = params.lockOn;
    if (typeof params.blockEnabled === "boolean") cp.blockEnabled = params.blockEnabled;
    if (["roll", "dash", "blink", "sidestep"].includes(params.dodgeStyle)) cp.dodgeStyle = params.dodgeStyle;
    saveWorldLensState();
    return { ok: true, result: { lockOn: cp.lockOn, dodgeStyle: cp.dodgeStyle, blockEnabled: cp.blockEnabled } };
  });

  registerLensAction("world", "combat-ability-add", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const cp = ensureCombatPrefs(s, worldActorId(ctx));
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const slot = Math.max(1, Math.min(8, Math.floor(Number(params.slot) || cp.abilities.length + 1)));
    if (cp.abilities.some((a) => a.slot === slot)) return { ok: false, error: `slot ${slot} already bound` };
    const ability = {
      id: nextWorldId("abil"),
      name: name.slice(0, 50),
      slot,
      element: ["physical", "fire", "ice", "lightning", "bio", "energy", "poison"].includes(params.element) ? params.element : "physical",
      cooldownMs: Math.max(0, Math.min(600000, Math.floor(Number(params.cooldownMs) || 5000))),
      lastUsedMs: 0,
    };
    cp.abilities.push(ability);
    cp.abilities.sort((a, b) => a.slot - b.slot);
    saveWorldLensState();
    return { ok: true, result: { ability: abilityView(ability, Date.now()) } };
  });

  registerLensAction("world", "combat-ability-remove", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const cp = ensureCombatPrefs(s, worldActorId(ctx));
    const id = String(params.id || "");
    const idx = cp.abilities.findIndex((a) => a.id === id);
    if (idx === -1) return { ok: false, error: "ability not found" };
    cp.abilities.splice(idx, 1);
    saveWorldLensState();
    return { ok: true, result: { removed: id } };
  });

  registerLensAction("world", "combat-ability-trigger", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const cp = ensureCombatPrefs(s, worldActorId(ctx));
    const id = String(params.id || "");
    const ability = cp.abilities.find((a) => a.id === id);
    if (!ability) return { ok: false, error: "ability not found" };
    const now = Date.now();
    const remaining = Math.max(0, ability.cooldownMs - (now - (ability.lastUsedMs || 0)));
    if (remaining > 0) {
      return { ok: false, error: `ability on cooldown — ${Math.ceil(remaining / 1000)}s remaining`, result: { cooldownRemainingMs: remaining } };
    }
    ability.lastUsedMs = now;
    saveWorldLensState();
    return { ok: true, result: { ability: abilityView(ability, now) } };
  });

  // ── 7. LOD / streaming preferences ───────────────────────────────
  // Per-user perf knobs the 3D scene reads to budget draw calls in
  // big worlds — draw distance, LOD bias, shadow quality, etc.

  registerLensAction("world", "streaming-prefs-get", (ctx, _artifact, _params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const prefs = s.streamPrefs.get(userId) || {
      drawDistanceM: 400,
      lodBias: 1.0,
      shadowQuality: "medium",
      maxVisibleEntities: 200,
      foliageDensity: 1.0,
      streamingEnabled: true,
    };
    return { ok: true, result: { prefs } };
  });

  registerLensAction("world", "streaming-prefs-set", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const cur = s.streamPrefs.get(userId) || {
      drawDistanceM: 400, lodBias: 1.0, shadowQuality: "medium",
      maxVisibleEntities: 200, foliageDensity: 1.0, streamingEnabled: true,
    };
    if (Number.isFinite(Number(params.drawDistanceM))) cur.drawDistanceM = Math.max(50, Math.min(4000, Number(params.drawDistanceM)));
    if (Number.isFinite(Number(params.lodBias))) cur.lodBias = Math.max(0.25, Math.min(4, Number(params.lodBias)));
    if (["low", "medium", "high", "off"].includes(params.shadowQuality)) cur.shadowQuality = params.shadowQuality;
    if (Number.isFinite(Number(params.maxVisibleEntities))) cur.maxVisibleEntities = Math.max(20, Math.min(2000, Math.floor(Number(params.maxVisibleEntities))));
    if (Number.isFinite(Number(params.foliageDensity))) cur.foliageDensity = Math.max(0, Math.min(2, Number(params.foliageDensity)));
    if (typeof params.streamingEnabled === "boolean") cur.streamingEnabled = params.streamingEnabled;
    s.streamPrefs.set(userId, cur);
    saveWorldLensState();
    return { ok: true, result: { prefs: cur } };
  });

  registerLensAction("world", "streaming-prefs-preset", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const PRESETS = {
      potato:      { drawDistanceM: 120, lodBias: 0.4, shadowQuality: "off",    maxVisibleEntities: 60,  foliageDensity: 0.2, streamingEnabled: true },
      balanced:    { drawDistanceM: 400, lodBias: 1.0, shadowQuality: "medium", maxVisibleEntities: 200, foliageDensity: 1.0, streamingEnabled: true },
      ultra:       { drawDistanceM: 1600, lodBias: 2.5, shadowQuality: "high",  maxVisibleEntities: 800, foliageDensity: 2.0, streamingEnabled: true },
    };
    const preset = PRESETS[String(params.preset || "")];
    if (!preset) return { ok: false, error: `preset must be one of: ${Object.keys(PRESETS).join(", ")}` };
    s.streamPrefs.set(userId, { ...preset });
    saveWorldLensState();
    return { ok: true, result: { preset: String(params.preset), prefs: { ...preset } } };
  });

  // ── 8. Photo mode / screenshot sharing ───────────────────────────
  // A player saves a captured screenshot (data URL or external link)
  // with camera metadata + a caption; the gallery lists them and a
  // share flips visibility public so other players can view.

  registerLensAction("world", "photo-save", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = worldActorId(ctx);
    const imageUrl = String(params.imageUrl || "").trim();
    if (!imageUrl) return { ok: false, error: "imageUrl required (data URL or hosted link)" };
    if (imageUrl.length > 6_000_000) return { ok: false, error: "image payload too large" };
    const photo = {
      id: nextWorldId("photo"),
      worldId: String(params.worldId || "concordia-hub"),
      imageUrl,
      caption: String(params.caption || "").slice(0, 200),
      camera: params.camera && typeof params.camera === "object" ? params.camera : null,
      filter: String(params.filter || "none").slice(0, 24),
      ownerId: userId,
      public: false,
      likes: 0,
      createdAt: nowIsoWorld(),
    };
    if (!s.photos.has(userId)) s.photos.set(userId, new Map());
    s.photos.get(userId).set(photo.id, photo);
    saveWorldLensState();
    return { ok: true, result: { photo } };
  });

  registerLensAction("world", "photo-delete", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.photos.get(worldActorId(ctx));
    const id = String(params.id || "");
    if (!map || !map.has(id)) return { ok: false, error: "photo not found" };
    map.delete(id);
    saveWorldLensState();
    return { ok: true, result: { deleted: id } };
  });

  registerLensAction("world", "photo-list", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.photos.get(worldActorId(ctx));
    const worldId = params.worldId ? String(params.worldId) : null;
    let photos = map ? Array.from(map.values()) : [];
    if (worldId) photos = photos.filter((p) => p.worldId === worldId);
    photos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { photos, count: photos.length } };
  });

  registerLensAction("world", "photo-share", (ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const map = s.photos.get(worldActorId(ctx));
    const photo = map?.get(String(params.id || ""));
    if (!photo) return { ok: false, error: "photo not found" };
    photo.public = params.public !== false;
    saveWorldLensState();
    return { ok: true, result: { id: photo.id, public: photo.public } };
  });

  // photo-gallery-public — cross-user read of every photo flagged
  // public (the community photo wall).
  registerLensAction("world", "photo-gallery-public", (_ctx, _artifact, params = {}) => {
    const s = getKitState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const worldId = params.worldId ? String(params.worldId) : null;
    const out = [];
    for (const map of s.photos.values()) {
      for (const photo of map.values()) {
        if (!photo.public) continue;
        if (worldId && photo.worldId !== worldId) continue;
        out.push(photo);
      }
    }
    out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { photos: out.slice(0, 60), count: out.length } };
  });
}
