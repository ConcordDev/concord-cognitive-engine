// server/domains/all.js
// Aggregation domain providing cross-domain analytics, search, and the
// launcher substrate for the "All Lenses" hub: per-user recency / frequency
// tracking, pinned (favorite) lenses, and a fuzzy command-palette index.

export default function registerAllActions(registerLensAction) {
  /**
   * crossDomainSearch
   * Search across all lens artifacts for matching query. Uses the live
   * STATE.dtus map exposed via globalThis._concordSTATE.
   */
  registerLensAction("all", "crossDomainSearch", (ctx, artifact, params) => {
    const query = String(params.query || artifact.data?.query || '').toLowerCase().trim();
    if (!query) return { ok: true, result: { matches: [], message: 'Provide a search query' } };

    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { matches: [], message: 'No DTU store available' } };

    const matches = [];
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
    for (const dtu of STATE.dtus.values?.() ?? []) {
      const hay = `${dtu.title || ''}\n${dtu.human?.summary || dtu.body || ''}`.toLowerCase();
      if (hay.includes(query)) {
        matches.push({
          dtuId: dtu.id,
          title: dtu.title,
          domain: dtu.domain,
          summary: (dtu.human?.summary || '').slice(0, 200),
          createdAt: dtu.createdAt,
        });
        if (matches.length >= limit) break;
      }
    }

    return { ok: true, result: { query, matches, total: matches.length } };
  });

  /**
   * domainStats
   * Aggregate statistics across all domains.
   */
  registerLensAction("all", "domainStats", (_ctx, _artifact, _params) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { message: 'No DTU store available', stats: {} } };

    const counts = {};
    let total = 0;
    let oldest = Infinity;
    let newest = 0;

    for (const dtu of STATE.dtus.values?.() ?? []) {
      const dom = dtu.domain || 'unknown';
      counts[dom] = (counts[dom] || 0) + 1;
      total++;
      const ts = new Date(dtu.createdAt || 0).getTime();
      if (Number.isFinite(ts)) {
        if (ts < oldest) oldest = ts;
        if (ts > newest) newest = ts;
      }
    }

    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count }));

    return {
      ok: true,
      result: {
        totalDtus: total,
        domains: ranked.length,
        topDomains: ranked.slice(0, 10),
        oldestDtuAt: oldest === Infinity ? null : new Date(oldest).toISOString(),
        newestDtuAt: newest === 0 ? null : new Date(newest).toISOString(),
      },
    };
  });

  /**
   * recentActivity
   * Show recent cross-domain activity feed.
   */
  registerLensAction("all", "recentActivity", (_ctx, _artifact, params) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { feed: [] } };

    const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
    const items = [];
    for (const dtu of STATE.dtus.values?.() ?? []) {
      items.push({
        dtuId: dtu.id,
        title: dtu.title,
        domain: dtu.domain,
        createdAt: dtu.createdAt,
        creatorId: dtu.creatorId || dtu.ownerId,
      });
    }
    items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return { ok: true, result: { feed: items.slice(0, limit) } };
  });

  // ─── Launcher substrate ───────────────────────────────────────────────
  // Per-user state for the "All Lenses" hub: recents, pins, usage counts.

  function getAllState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.allLens) STATE.allLens = {};
    const s = STATE.allLens;
    if (!(s.usage instanceof Map)) s.usage = new Map();   // userId -> Map<lensId, { count, lastAt }>
    if (!(s.pins instanceof Map)) s.pins = new Map();     // userId -> Array<lensId> (ordered)
    return s;
  }
  function saveAll() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const allNow = () => new Date().toISOString();
  const allActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const allClean = (v, max = 80) => String(v == null ? "" : v).trim().slice(0, max);
  const allUsage = (s, userId) => {
    if (!(s.usage.get(userId) instanceof Map)) s.usage.set(userId, new Map());
    return s.usage.get(userId);
  };
  const allPins = (s, userId) => {
    if (!Array.isArray(s.pins.get(userId))) s.pins.set(userId, []);
    return s.pins.get(userId);
  };
  const MAX_PINS = 24;

  /**
   * record-open
   * Records that the user opened a lens. Drives recency + frequency ordering.
   * params: { lensId }
   */
  registerLensAction("all", "record-open", (ctx, _a, params = {}) => {
    const s = getAllState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lensId = allClean(params.lensId, 80);
    if (!lensId) return { ok: false, error: "lensId required" };
    const usage = allUsage(s, allActor(ctx));
    s.seq = (Number(s.seq) || 0) + 1; // monotonic open counter — recency tiebreak
    const prev = usage.get(lensId) || { count: 0, lastAt: null, firstAt: allNow() };
    const rec = {
      count: prev.count + 1,
      lastAt: allNow(),
      firstAt: prev.firstAt || allNow(),
      seq: s.seq,
    };
    usage.set(lensId, rec);
    saveAll();
    return { ok: true, result: { lensId, count: rec.count, lastAt: rec.lastAt, firstAt: rec.firstAt } };
  });

  /**
   * usage-list
   * Returns per-user lens usage ordered for recency + frequency surfacing.
   * params: { limit?, mode? ('recent'|'frequent') }
   */
  registerLensAction("all", "usage-list", (ctx, _a, params = {}) => {
  try {
    const s = getAllState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const usage = allUsage(s, allActor(ctx));
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 12));
    const mode = params.mode === "frequent" ? "frequent" : "recent";
    const rows = [...usage.entries()].map(([lensId, rec]) => ({
      lensId,
      count: rec.count || 0,
      lastAt: rec.lastAt || null,
      firstAt: rec.firstAt || null,
      seq: rec.seq || 0,
    }));
    const byRecency = (a, b) => {
      const td = new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
      return td !== 0 ? td : b.seq - a.seq;
    };
    rows.sort((a, b) => {
      if (mode === "frequent") {
        if (b.count !== a.count) return b.count - a.count;
        return byRecency(a, b);
      }
      return byRecency(a, b);
    });
    const strip = (r) => ({ lensId: r.lensId, count: r.count, lastAt: r.lastAt, firstAt: r.firstAt });
    return {
      ok: true,
      result: {
        mode,
        recent: rows.slice(0, limit).map(strip),
        frequent: [...rows].sort((a, b) => (b.count - a.count) || byRecency(a, b)).slice(0, limit).map(strip),
        totalTracked: rows.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * pin-toggle
   * Pins or unpins a lens to the user's top shelf. Returns the new pin list.
   * params: { lensId }
   */
  registerLensAction("all", "pin-toggle", (ctx, _a, params = {}) => {
    const s = getAllState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lensId = allClean(params.lensId, 80);
    if (!lensId) return { ok: false, error: "lensId required" };
    const pins = allPins(s, allActor(ctx));
    const idx = pins.indexOf(lensId);
    let pinned;
    if (idx >= 0) {
      pins.splice(idx, 1);
      pinned = false;
    } else {
      if (pins.length >= MAX_PINS) {
        return { ok: false, error: `pin limit reached (${MAX_PINS})` };
      }
      pins.push(lensId);
      pinned = true;
    }
    saveAll();
    return { ok: true, result: { lensId, pinned, pins: [...pins] } };
  });

  /**
   * pin-list
   * Returns the ordered list of pinned lenses for the user.
   */
  registerLensAction("all", "pin-list", (ctx, _a, _params = {}) => {
    const s = getAllState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pins = allPins(s, allActor(ctx));
    return { ok: true, result: { pins: [...pins], count: pins.length, max: MAX_PINS } };
  });

  /**
   * pin-reorder
   * Reorders the pin shelf. params: { pins: string[] } — must be a permutation
   * of the existing pins (extra ids ignored, missing ids dropped).
   */
  registerLensAction("all", "pin-reorder", (ctx, _a, params = {}) => {
    const s = getAllState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const incoming = Array.isArray(params.pins) ? params.pins.map((p) => allClean(p, 80)) : [];
    if (!incoming.length) return { ok: false, error: "pins array required" };
    const pins = allPins(s, allActor(ctx));
    const existing = new Set(pins);
    const reordered = [];
    for (const id of incoming) {
      if (existing.has(id) && !reordered.includes(id)) reordered.push(id);
    }
    // keep any pins the caller forgot to include, appended in original order
    for (const id of pins) if (!reordered.includes(id)) reordered.push(id);
    s.pins.set(allActor(ctx), reordered);
    saveAll();
    return { ok: true, result: { pins: [...reordered], count: reordered.length } };
  });

  /**
   * lens-badges
   * Per-lens last-activity badge counts. For each requested lens domain,
   * counts DTUs created in that domain since the user last opened that lens
   * (from the usage ledger). A lens never opened reports its total DTU count.
   * params: { lensIds: string[] }
   */
  registerLensAction("all", "lens-badges", (ctx, _a, params = {}) => {
  try {
    const s = getAllState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const STATE = globalThis._concordSTATE;
    const lensIds = Array.isArray(params.lensIds)
      ? params.lensIds.map((l) => allClean(l, 80)).filter(Boolean).slice(0, 300)
      : [];
    if (!lensIds.length) return { ok: true, result: { badges: {} } };
    const usage = allUsage(s, allActor(ctx));

    // Bucket DTU creation times by domain once.
    const byDomain = new Map(); // domain -> Array<ms>
    if (STATE?.dtus?.values) {
      for (const dtu of STATE.dtus.values()) {
        const dom = dtu.domain || "unknown";
        if (!byDomain.has(dom)) byDomain.set(dom, []);
        const ts = new Date(dtu.createdAt || 0).getTime();
        if (Number.isFinite(ts)) byDomain.get(dom).push(ts);
      }
    }

    const badges = {};
    for (const lensId of lensIds) {
      const times = byDomain.get(lensId) || [];
      const seenAt = usage.get(lensId)?.lastAt;
      const since = seenAt ? new Date(seenAt).getTime() : 0;
      const fresh = since ? times.filter((t) => t > since).length : times.length;
      if (fresh > 0) {
        badges[lensId] = { count: fresh, lastSeenAt: seenAt || null, total: times.length };
      }
    }
    return { ok: true, result: { badges } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * command-index
   * Returns a flat command-palette index: one entry per (lens) plus one per
   * registered macro action of every domain (the "action", not just the lens).
   * Built live from the runtime macro registry so it never drifts.
   * params: { query? } — optional fuzzy filter applied server-side.
   */
  registerLensAction("all", "command-index", (_ctx, _a, params = {}) => {
  try {
    const STATE = globalThis._concordSTATE;
    const entries = [];

    // Macro actions — the launcher's "jump to action, not just lens" surface.
    // The runtime registry (globalThis._concordMACROS) is a nested
    // Map<domain, Map<name, { fn, spec }>>. Tests pass a flat
    // Map<"domain.name", entry> via STATE.macros; both shapes are handled.
    const macros = globalThis._concordMACROS || STATE?.macros;
    if (macros && typeof macros.entries === "function") {
      for (const [key, val] of macros.entries()) {
        if (val && typeof val.entries === "function") {
          // nested shape: key = domain, val = Map<name, ...>
          const domain = String(key);
          for (const name of val.keys()) {
            const action = String(name);
            if (!domain || !action) continue;
            entries.push({
              kind: "action",
              id: `${domain}.${action}`,
              domain,
              action,
              label: `${domain}: ${action}`,
              path: `/lenses/${domain}`,
            });
          }
        } else {
          // flat shape: key = "domain.name"
          const [domain, ...rest] = String(key).split(".");
          const action = rest.join(".");
          if (!domain || !action) continue;
          entries.push({
            kind: "action",
            id: `${domain}.${action}`,
            domain,
            action,
            label: `${domain}: ${action}`,
            path: `/lenses/${domain}`,
          });
        }
      }
    }

    const query = allClean(params.query, 80).toLowerCase();
    let rows = entries;
    if (query) {
      // simple subsequence fuzzy match + scoring
      const score = (text) => {
        const t = text.toLowerCase();
        let qi = 0;
        let lastHit = -1;
        let gaps = 0;
        for (let i = 0; i < t.length && qi < query.length; i++) {
          if (t[i] === query[qi]) {
            if (lastHit >= 0) gaps += i - lastHit - 1;
            lastHit = i;
            qi++;
          }
        }
        if (qi < query.length) return -1;
        return 1000 - gaps - lastHit;
      };
      rows = entries
        .map((e) => ({ e, s: score(e.label) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.e);
    }

    return {
      ok: true,
      result: {
        commands: rows.slice(0, 200),
        total: rows.length,
        indexed: entries.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
