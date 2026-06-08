// server/domains/district.js
//
// District timeline lens-action domain (id "district"). Backs the
// DistrictTimeline panel with REAL point-in-time snapshots a caller records,
// and growth analysis computed strictly from recorded data.
//
// In-memory, STATE-backed (no migrations). STATE.districtSnapshots is a
// Map<districtId, Array<Snapshot>>. Empty by construction — a district shows
// nothing until a snapshot is recorded; growth curves are NEVER fabricated.
//
// Macros: snapshot-record, timeline-list, growth-analysis, districts-list.

export default function registerDistrictActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function store() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    STATE.districtSnapshots ??= new Map(); // districtId -> Array<Snapshot>
    if (!(STATE.districtSnapshots instanceof Map)) {
      STATE.districtSnapshots = new Map();
    }
    return STATE.districtSnapshots;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const sid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function snapshotsFor(m, districtId) {
    if (!m.has(districtId)) m.set(districtId, []);
    return m.get(districtId);
  }
  // chronological order by recorded timestamp
  function ordered(list) {
    return [...list].sort((a, b) => a.ts - b.ts);
  }

  // ── snapshot-record ──────────────────────────────────────────────
  // Records a real point-in-time district snapshot. Numeric fields are
  // validated; nothing is invented.
  registerLensAction("district", "snapshot-record", (ctx, _artifact, params = {}) => {
    try {
      const m = store();
      const p = params || {};
      const districtId = String(p.districtId || "").trim();
      if (!districtId) return { ok: false, error: "districtId required" };

      const numField = (name) => {
        const v = Number(p[name]);
        if (!Number.isFinite(v) || v < 0) return null;
        return v;
      };
      const buildingCount = numField("buildingCount");
      if (buildingCount === null) return { ok: false, error: "numeric buildingCount required" };
      const population = numField("population");
      if (population === null) return { ok: false, error: "numeric population required" };
      // activeUsers is optional but, if supplied, must be a valid non-negative number.
      let activeUsers = 0;
      if (p.activeUsers !== undefined) {
        const v = Number(p.activeUsers);
        if (!Number.isFinite(v) || v < 0) return { ok: false, error: "numeric activeUsers required" };
        activeUsers = v;
      }
      const at = p.at ? new Date(p.at) : new Date();
      if (Number.isNaN(at.getTime())) return { ok: false, error: "invalid timestamp" };

      const snapshot = {
        id: sid("snap"),
        districtId,
        buildingCount,
        population,
        activeUsers,
        at: at.toISOString(),
        ts: at.getTime(),
      };
      const list = snapshotsFor(m, districtId);
      list.push(snapshot);
      // bound in-memory growth
      if (list.length > 500) list.splice(0, list.length - 500);
      save();
      return { ok: true, result: { snapshot, snapshotCount: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── timeline-list ────────────────────────────────────────────────
  // Per-district ordered (oldest → newest) snapshot history. Empty until
  // something is recorded. Supports `limit` (most-recent N, returned in order).
  registerLensAction("district", "timeline-list", (ctx, _artifact, params = {}) => {
    try {
      const m = store();
      const p = params || {};
      const districtId = String(p.districtId || "").trim();
      if (!districtId) return { ok: false, error: "districtId required" };
      let list = ordered(snapshotsFor(m, districtId));
      if (p.limit !== undefined) {
        const lim = Number(p.limit);
        if (Number.isFinite(lim) && lim > 0) list = list.slice(-Math.floor(lim));
      }
      return { ok: true, result: { districtId, snapshots: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── growth-analysis ──────────────────────────────────────────────
  // Computes deltas + a per-period growth-rate between the FIRST and LAST
  // recorded snapshot. Needs >= 2 snapshots; otherwise returns guidance.
  registerLensAction("district", "growth-analysis", (ctx, _artifact, params = {}) => {
    try {
      const m = store();
      const p = params || {};
      const districtId = String(p.districtId || "").trim();
      if (!districtId) return { ok: false, error: "districtId required" };
      const list = ordered(snapshotsFor(m, districtId));
      if (list.length < 2) {
        return {
          ok: true,
          result: {
            districtId,
            snapshotCount: list.length,
            hasAnalysis: false,
            guidance: "Record at least 2 snapshots to compute district growth.",
          },
        };
      }
      const first = list[0];
      const last = list[list.length - 1];
      const periods = list.length - 1; // number of intervals between snapshots

      const buildingDelta = last.buildingCount - first.buildingCount;
      const populationDelta = last.population - first.population;
      const activeUsersDelta = last.activeUsers - first.activeUsers;

      // Per-period compound growth rate (geometric, "CAGR-ish" over snapshot
      // intervals). Only defined when the starting value is > 0.
      const compoundRate = (start, end) => {
        if (!(start > 0)) return null;
        const r = Math.pow(end / start, 1 / periods) - 1;
        return Math.round(r * 10000) / 10000; // 4dp fraction
      };
      const pct = (delta, start) => (start > 0 ? Math.round((delta / start) * 10000) / 100 : null);

      const buildingGrowthRate = compoundRate(first.buildingCount, last.buildingCount);
      const populationGrowthRate = compoundRate(first.population, last.population);

      // Trend label keyed off population (primary district vitality signal),
      // falling back to building growth when population started at 0.
      const trendBasis = populationDelta !== 0 ? populationDelta
        : buildingDelta !== 0 ? buildingDelta : 0;
      let trend;
      if (trendBasis > 0) trend = "growing";
      else if (trendBasis < 0) trend = "declining";
      else trend = "stable";

      return {
        ok: true,
        result: {
          districtId,
          snapshotCount: list.length,
          periods,
          hasAnalysis: true,
          first: { at: first.at, buildingCount: first.buildingCount, population: first.population, activeUsers: first.activeUsers },
          last: { at: last.at, buildingCount: last.buildingCount, population: last.population, activeUsers: last.activeUsers },
          deltas: {
            buildingCount: buildingDelta,
            population: populationDelta,
            activeUsers: activeUsersDelta,
          },
          percentChange: {
            buildingCount: pct(buildingDelta, first.buildingCount),
            population: pct(populationDelta, first.population),
          },
          growthRatePerPeriod: {
            buildingCount: buildingGrowthRate,
            population: populationGrowthRate,
          },
          trend,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── districts-list ───────────────────────────────────────────────
  // Distinct districts that have at least one recorded snapshot, with counts.
  registerLensAction("district", "districts-list", (_ctx, _artifact, _params = {}) => {
    try {
      const m = store();
      const districts = [];
      for (const [districtId, list] of m.entries()) {
        if (!Array.isArray(list) || list.length === 0) continue;
        const ord = ordered(list);
        districts.push({
          districtId,
          snapshotCount: ord.length,
          firstAt: ord[0].at,
          lastAt: ord[ord.length - 1].at,
        });
      }
      districts.sort((a, b) => a.districtId.localeCompare(b.districtId));
      return { ok: true, result: { districts, count: districts.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
