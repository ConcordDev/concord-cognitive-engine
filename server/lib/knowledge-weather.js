/**
 * Knowledge Weather + Drift Radar + Continuity Diary
 *
 * Three small modules that surface the system's epistemic state.
 *
 * • knowledge-weather — domains where activity is rising (warm fronts) or
 *   decaying (cold fronts). 24h rolling window over DTU creation timestamps.
 *
 * • drift-radar — pairs of domains whose semantic embeddings have drifted
 *   apart over time, flagging potential schism. Uses the precomputed centroid
 *   from autogen if present; otherwise approximates via tag overlap.
 *
 * • continuity-diary — rolling daily journal of major system events. Pulls
 *   from morning briefs, council verdicts, marketplace milestones, and
 *   referendum outcomes.
 *
 * All three are read-only views — no mutation of substrate. Cheap to compute
 * (single pass over recent DTUs / events) so they can be polled per-tick.
 */

const WEATHER_WINDOW_MS = 24 * 60 * 60 * 1000;
const DRIFT_PAIR_LIMIT  = 10;
const DIARY_MAX_ENTRIES = 60;

// Diary state — module-scoped journal. Grows up to DIARY_MAX_ENTRIES then rotates.
const _diary = [];

/**
 * Compute knowledge weather for the last 24h.
 *
 * @param {object} STATE
 * @returns {{ ok: true, fronts: Array<{ domain, count, rateChange, status }> }}
 */
export function computeKnowledgeWeather(STATE) {
  const now = Date.now();
  const win = WEATHER_WINDOW_MS;
  const buckets = new Map(); // domain -> { current, prev }

  if (!STATE?.dtus) return { ok: true, fronts: [] };

  for (const dtu of STATE.dtus.values?.() ?? []) {
    const created = parseTime(dtu.createdAt);
    if (!created) continue;
    const dt = now - created;
    if (dt > win * 2) continue;

    const dom = dtu.domain || extractDomainTag(dtu.tags ?? dtu.meta?.tags ?? []) || "general";
    if (!buckets.has(dom)) buckets.set(dom, { current: 0, prev: 0 });
    const b = buckets.get(dom);
    if (dt < win) b.current++;
    else b.prev++;
  }

  const fronts = [];
  for (const [domain, b] of buckets) {
    const rateChange = b.prev === 0
      ? (b.current > 2 ? 1.0 : 0.0)
      : Math.round(((b.current - b.prev) / Math.max(1, b.prev)) * 100) / 100;
    let status = "stable";
    if (rateChange >= 0.5) status = "warm_front";
    else if (rateChange >= 0.15) status = "rising";
    else if (rateChange <= -0.5) status = "cold_front";
    else if (rateChange <= -0.15) status = "cooling";
    fronts.push({ domain, count: b.current, prevCount: b.prev, rateChange, status });
  }

  fronts.sort((a, b) => Math.abs(b.rateChange) - Math.abs(a.rateChange));
  return { ok: true, fronts: fronts.slice(0, 20) };
}

/**
 * Compute drift radar — domain pairs that share citations but whose recent
 * DTUs use disjoint tag vocabulary.
 */
export function computeDriftRadar(STATE) {
  if (!STATE?.dtus) return { ok: true, pairs: [] };

  const domainTagSets = new Map(); // domain -> Set<tag>
  for (const dtu of STATE.dtus.values?.() ?? []) {
    const created = parseTime(dtu.createdAt);
    if (!created) continue;
    if (Date.now() - created > 14 * 24 * 60 * 60 * 1000) continue; // 14d window
    const dom = dtu.domain || extractDomainTag(dtu.tags ?? []);
    if (!dom) continue;
    if (!domainTagSets.has(dom)) domainTagSets.set(dom, new Set());
    for (const t of (dtu.tags ?? dtu.meta?.tags ?? [])) {
      if (typeof t === "string" && !t.startsWith("domain:") && !t.startsWith("lens:")) {
        domainTagSets.get(dom).add(t.toLowerCase());
      }
    }
  }

  const pairs = [];
  const domains = [...domainTagSets.keys()];
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const a = domainTagSets.get(domains[i]);
      const b = domainTagSets.get(domains[j]);
      if (!a.size || !b.size) continue;
      const overlap = [...a].filter(t => b.has(t)).length;
      const union   = new Set([...a, ...b]).size;
      const jaccard = overlap / Math.max(1, union);
      // Drift candidate: shared citation context (at least one shared tag)
      // but low Jaccard suggests vocabulary divergence.
      if (overlap >= 1 && jaccard < 0.15) {
        pairs.push({ domainA: domains[i], domainB: domains[j], overlap, jaccard, drift: 1 - jaccard });
      }
    }
  }
  pairs.sort((a, b) => b.drift - a.drift);
  return { ok: true, pairs: pairs.slice(0, DRIFT_PAIR_LIMIT) };
}

/**
 * Add an entry to the continuity diary.
 *
 * @param {string} kind — "morning_brief" | "council_verdict" | "marketplace" | "referendum" | "system"
 * @param {object} payload — flexible payload, summarized in the diary entry
 */
export function diaryAppend(kind, payload) {
  const entry = {
    id: `diary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind: String(kind),
    ts: new Date().toISOString(),
    summary: summarize(kind, payload),
    payload,
  };
  _diary.push(entry);
  if (_diary.length > DIARY_MAX_ENTRIES) _diary.shift();
  return entry;
}

export function getContinuityDiary(opts = {}) {
  const { kind, limit = 30 } = opts;
  let out = _diary;
  if (kind) out = out.filter(e => e.kind === kind);
  out = out.slice(-limit).reverse();
  return { ok: true, entries: out };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function parseTime(t) {
  if (!t) return null;
  if (typeof t === "number") return t;
  const d = new Date(t);
  const v = d.getTime();
  return Number.isFinite(v) ? v : null;
}

function extractDomainTag(tags) {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (typeof t !== "string") continue;
    if (t.startsWith("domain:")) return t.slice(7);
    if (t.startsWith("lens:")) return t.slice(5);
  }
  return null;
}

function summarize(kind, payload) {
  const p = payload || {};
  switch (kind) {
    case "morning_brief":
      return p.summary?.slice?.(0, 240) || "Morning brief recorded.";
    case "council_verdict":
      return `Council verdict on "${(p.proposal?.topic || "").slice(0, 100)}": ${p.verdict?.outcome || "no_outcome"}`;
    case "marketplace":
      return `Marketplace activity: ${p.event || "listing"} — ${(p.title || "").slice(0, 100)}`;
    case "referendum":
      return `Referendum on "${(p.topic || "").slice(0, 100)}" reached ${p.outcome || "no_outcome"}`;
    case "system":
      return p.message?.slice?.(0, 240) || "System event recorded.";
    default:
      return p.summary || `Event: ${kind}`;
  }
}
