/**
 * System: Civilization Attention System
 *
 * Coordinates compute allocation across 18+ emergent systems competing for
 * the same hardware. Surveys active systems every 5 minutes, scores each domain
 * by attention urgency, allocates LLM call budget proportionally, and publishes
 * allocation to the global queue priority system.
 *
 * Sovereign can force-focus a domain (up to 90% budget cap).
 *
 * All state in module-level structures. Silent failure. Additive only.
 */

import crypto from "crypto";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "attn") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function getSTATE() { return globalThis._concordSTATE || null; }

// ── Constants ───────────────────────────────────────────────────────────────

const ATTENTION_INTERVAL_MS = 900_000; // 15 minutes — attention allocation is gradual
const DEFAULT_TOTAL_BUDGET = parseInt(process.env.ATTENTION_BUDGET || "60", 10);

// ── Module State ────────────────────────────────────────────────────────────

let _timer = null;
let _totalBudget = DEFAULT_TOTAL_BUDGET;
let _focusOverride = null; // { domain, weight, expiresAt }
let _lastAllocation = null;
let _allocationHistory = []; // Last 288 entries (24h at 5min intervals)
const MAX_HISTORY = 288;

// ── Domain Discovery ────────────────────────────────────────────────────────

function discoverDomains(STATE) {
  const domains = new Set();
  if (STATE?.dtus instanceof Map) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.tags?.length) {
        for (const tag of dtu.tags) {
          if (tag.startsWith("domain:")) domains.add(tag.slice(7));
        }
      }
      if (dtu.machine?.domain) domains.add(dtu.machine.domain);
    }
  }
  // Add known system domains
  for (const d of ["physics", "mathematics", "philosophy", "biology", "chemistry",
    "history", "economics", "computer_science", "general"]) {
    domains.add(d);
  }
  return Array.from(domains);
}

// ── Urgency Scoring ─────────────────────────────────────────────────────────

function countKnowledgeGaps(domain, STATE) {
  let count = 0;
  if (STATE?.dtus instanceof Map) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.tags?.includes("gap") && (dtu.tags?.includes(`domain:${domain}`) || dtu.machine?.domain === domain)) {
        count++;
      }
    }
  }
  return count;
}

function countActiveHypotheses(domain, STATE) {
  let count = 0;
  if (STATE?.dtus instanceof Map) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.machine?.kind === "hypothesis" &&
          (dtu.machine?.status === "proposed" || dtu.machine?.status === "testing") &&
          (dtu.tags?.includes(`domain:${domain}`) || dtu.machine?.domain === domain)) {
        count++;
      }
    }
  }
  return count;
}

function getLastSovereignQuery(domain, STATE) {
  if (!STATE?._sovereignQueries) return null;
  const queries = STATE._sovereignQueries.filter(q =>
    q.text?.toLowerCase().includes(domain.toLowerCase())
  );
  if (!queries.length) return null;
  return new Date(queries[queries.length - 1].timestamp).getTime();
}

function getLastDTUTime(domain, STATE) {
  let latest = 0;
  if (STATE?.dtus instanceof Map) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.tags?.includes(`domain:${domain}`) || dtu.machine?.domain === domain) {
        const t = new Date(dtu.createdAt || 0).getTime();
        if (t > latest) latest = t;
      }
    }
  }
  return latest || null;
}

function getEntityActivity(domain, STATE) {
  let count = 0;
  if (STATE?.entities instanceof Map) {
    for (const entity of STATE.entities.values()) {
      if (entity.currentDomain === domain || entity.domains?.includes(domain)) count++;
    }
  }
  return count;
}

function getPainCount(domain, STATE) {
  if (!STATE?._painLog) return 0;
  const cutoff = Date.now() - 86400000; // Last 24h
  return STATE._painLog.filter(p =>
    p.context?.domain === domain && new Date(p.timestamp).getTime() > cutoff
  ).length;
}

export function scoreAttentionUrgency(domain, STATE) {
  const gaps = countKnowledgeGaps(domain, STATE);
  const gapScore = Math.min(gaps / 20, 1.0);

  const activeHypos = countActiveHypotheses(domain, STATE);
  const hypoScore = Math.min(activeHypos / 5, 1.0);

  const sovereignRecency = getLastSovereignQuery(domain, STATE);
  const sovereignScore = sovereignRecency
    ? Math.exp(-(Date.now() - sovereignRecency) / (24 * 3600000))
    : 0;

  const lastDTU = getLastDTUTime(domain, STATE);
  const staleness = lastDTU
    ? Math.min((Date.now() - lastDTU) / (7 * 86400000), 1.0)
    : 0.5;

  const entityActivity = getEntityActivity(domain, STATE);
  const entityScore = Math.min(entityActivity / 10, 1.0);

  const painCount = getPainCount(domain, STATE);
  const painScore = Math.min(painCount / 5, 1.0);

  return {
    domain,
    urgency: (
      0.25 * gapScore +
      0.20 * hypoScore +
      0.20 * sovereignScore +
      0.15 * staleness +
      0.10 * entityScore +
      0.10 * painScore
    ),
    breakdown: { gapScore, hypoScore, sovereignScore, staleness, entityScore, painScore },
  };
}

// ── Budget Allocation ───────────────────────────────────────────────────────

function allocateBudget(domainScores, totalBudget) {
  if (!domainScores.length) return [];

  // Apply focus override
  if (_focusOverride && _focusOverride.expiresAt > Date.now()) {
    const focused = domainScores.find(d => d.domain === _focusOverride.domain);
    if (focused) {
      const focusBudget = Math.floor(totalBudget * _focusOverride.weight);
      const remaining = totalBudget - focusBudget;
      const others = domainScores.filter(d => d.domain !== _focusOverride.domain);
      const perOther = others.length ? Math.floor(remaining / others.length) : 0;

      return [
        { ...focused, budget: focusBudget, focused: true },
        ...others.map(d => ({ ...d, budget: Math.max(1, perOther) })),
      ];
    }
  }

  // Clear expired focus override
  if (_focusOverride && _focusOverride.expiresAt <= Date.now()) {
    _focusOverride = null;
  }

  const totalUrgency = domainScores.reduce((sum, d) => sum + d.urgency, 0);
  if (totalUrgency === 0) {
    return domainScores.map(d => ({ ...d, budget: Math.floor(totalBudget / domainScores.length) }));
  }

  const minPerDomain = 2;
  const distributable = Math.max(0, totalBudget - (minPerDomain * domainScores.length));

  return domainScores.map(d => ({
    ...d,
    budget: minPerDomain + Math.floor((d.urgency / totalUrgency) * distributable),
  }));
}

// ── Publish Allocation ──────────────────────────────────────────────────────

function publishAllocation(allocation) {
  globalThis._concordAttentionBudget = new Map(
    allocation.map(a => [a.domain, { budget: a.budget, urgency: a.urgency }])
  );

  if (typeof globalThis.realtimeEmit === "function") {
    globalThis.realtimeEmit("attention:allocation", {
      allocation: allocation.map(a => ({
        domain: a.domain,
        budget: a.budget,
        urgency: parseFloat(a.urgency.toFixed(3)),
        focused: a.focused || false,
      })),
      focusOverride: _focusOverride ? {
        domain: _focusOverride.domain,
        weight: _focusOverride.weight,
        expiresAt: new Date(_focusOverride.expiresAt).toISOString(),
      } : null,
      timestamp: nowISO(),
    });
  }
}

// ── Attention Cycle ─────────────────────────────────────────────────────────

let _cycleRunning = false;

export async function runAttentionCycle() {
  if (_cycleRunning) return { ok: false, error: "Cycle already running" };
  _cycleRunning = true;

  try {
    const STATE = getSTATE();
    if (!STATE) return { ok: false, error: "STATE not available" };

    const domains = discoverDomains(STATE);
    const scores = domains.map(d => scoreAttentionUrgency(d, STATE));
    scores.sort((a, b) => b.urgency - a.urgency);

    const allocation = allocateBudget(scores, _totalBudget);
    publishAllocation(allocation);

    _lastAllocation = {
      timestamp: nowISO(),
      allocation,
      totalBudget: _totalBudget,
      domainCount: domains.length,
    };

    _allocationHistory.push(_lastAllocation);
    if (_allocationHistory.length > MAX_HISTORY) {
      _allocationHistory = _allocationHistory.slice(-MAX_HISTORY);
    }

    return { ok: true, ..._lastAllocation };
  } finally {
    _cycleRunning = false;
  }
}

// ── Focus Override ──────────────────────────────────────────────────────────

export function setFocusOverride(domain, weight, durationMinutes = 60) {
  _focusOverride = {
    domain,
    weight: Math.min(parseFloat(weight) || 0.5, 0.9),
    expiresAt: Date.now() + (durationMinutes * 60000),
  };
  return { ok: true, focusOverride: _focusOverride };
}

export function clearFocusOverride() {
  const old = _focusOverride;
  _focusOverride = null;
  return { ok: true, cleared: old };
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export function getStatus() {
  return {
    ok: true,
    running: !!_timer,
    totalBudget: _totalBudget,
    focusOverride: _focusOverride,
    lastAllocation: _lastAllocation,
    interval: ATTENTION_INTERVAL_MS,
  };
}

export function getAllocationHistory() {
  return {
    ok: true,
    history: _allocationHistory.slice(-48), // Last 4 hours
  };
}

export function setBudget(total) {
  const v = parseInt(total, 10);
  if (isNaN(v) || v < 1) return { ok: false, error: "Budget must be >= 1" };
  const old = _totalBudget;
  _totalBudget = v;
  return { ok: true, old, new: _totalBudget };
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handleAttentionCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "attention-status":
      return getStatus();
    case "attention-focus":
      return setFocusOverride(parts[1], parts[2], parseInt(parts[3] || "60", 10));
    case "attention-unfocus":
      return clearFocusOverride();
    case "attention-history":
      return getAllocationHistory();
    case "attention-budget":
      return setBudget(parts[1]);
    default:
      return { ok: false, error: `Unknown attention command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

// `helpers` was destructured here and never referenced — the signature
// implied a dependency this module does not have. STATE is genuinely used
// below. Callers still pass both; extra arguments are ignored.
export function init({ STATE } = {}) {
  if (STATE) globalThis._concordSTATE = STATE;

  _timer = setInterval(() => {
    runAttentionCycle().catch(e => console.warn('[attention-allocator] async op failed:', e?.message));
  }, ATTENTION_INTERVAL_MS);
  if (_timer.unref) _timer.unref();

  return { ok: true, interval: ATTENTION_INTERVAL_MS };
}

export function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
