/**
 * On This Day / substrate diff / time-crystal detect.
 *
 * Extracted so the HTTP handlers can be regression-tested without booting
 * server.js. Archaeology lists only DTUs the requester can already see
 * (the same userVisibleDTUs predicate as GET /api/dtus and dtu.list) and
 * drops shadow/internal kinds the way dtu.search does. Substrate diff stays
 * an aggregate — counts only, no titles — and requires a signed-in viewer.
 * Detect is operator-only.
 */
import { viewerIdFromCtx } from "./dtu-read-access.js";
import { isOperator } from "./runtime/operator-gate.js";
import { isSearchHiddenDtu } from "./dtu-search-hits.js";

export const ARCHAEOLOGY_PERIODS = [
  { label: "1 week ago", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "1 month ago", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "3 months ago", ms: 90 * 24 * 60 * 60 * 1000 },
  { label: "6 months ago", ms: 180 * 24 * 60 * 60 * 1000 },
  { label: "1 year ago", ms: 365 * 24 * 60 * 60 * 1000 },
];

export function requesterIdFromReq(req) {
  if (!req) return null;
  return viewerIdFromCtx({ actor: req.actor, user: req.user });
}

export function archaeologyMemories({ dtus, now = new Date() } = {}) {
  const results = {};
  for (const period of ARCHAEOLOGY_PERIODS) {
    const targetDate = new Date(now.getTime() - period.ms);
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);
    const matches = [];
    for (const dtu of dtus || []) {
      if (!dtu || isSearchHiddenDtu(dtu)) continue;
      const created = new Date(dtu.createdAt || 0).getTime();
      if (created >= dayStart.getTime() && created <= dayEnd.getTime()) {
        matches.push({ id: dtu.id, title: dtu.title, domain: dtu.domain, tier: dtu.tier });
      }
    }
    results[period.label] = matches;
  }
  return results;
}

export function handleArchaeology(req, res, userVisibleDTUs) {
  const viewerId = requesterIdFromReq(req);
  if (!viewerId) return res.status(401).json({ ok: false, error: "auth_required" });
  const dtus = typeof userVisibleDTUs === "function" ? userVisibleDTUs(viewerId) : [];
  return res.json({ ok: true, memories: archaeologyMemories({ dtus }) });
}

export function handleSubstrateDiff(req, res, state) {
  const viewerId = requesterIdFromReq(req);
  if (!viewerId) return res.status(401).json({ ok: false, error: "auth_required" });
  const fromDate = req.query?.fromDate ? new Date(req.query.fromDate).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000;
  const toDate = req.query?.toDate ? new Date(req.query.toDate).getTime() : Date.now();
  const dtus = state?.dtus?.values ? state.dtus.values() : [];
  let totalBefore = 0;
  let totalAfter = 0;
  let newCount = 0;
  const domainGrowth = {};
  const tiersBefore = { regular: 0, mega: 0, hyper: 0 };
  const tiersAfter = { regular: 0, mega: 0, hyper: 0 };
  for (const dtu of dtus) {
    const created = new Date(dtu?.createdAt || 0).getTime();
    const tier = dtu?.tier || "regular";
    if (created < fromDate) {
      totalBefore += 1;
      tiersBefore[tier] = (tiersBefore[tier] || 0) + 1;
    }
    if (created <= toDate) {
      totalAfter += 1;
      tiersAfter[tier] = (tiersAfter[tier] || 0) + 1;
    }
    if (created >= fromDate && created <= toDate) {
      newCount += 1;
      const domain = dtu?.domain || "general";
      domainGrowth[domain] = (domainGrowth[domain] || 0) + 1;
    }
  }
  const swarms = Array.isArray(state?.swarms) ? state.swarms : [];
  const crystals = Array.isArray(state?.timeCrystals) ? state.timeCrystals : [];
  return res.json({
    ok: true,
    diff: {
      period: { from: new Date(fromDate).toISOString(), to: new Date(toDate).toISOString() },
      newDTUs: newCount,
      totalBefore,
      totalAfter,
      domainGrowth,
      tiersBefore,
      tiersAfter,
      newSwarms: swarms.filter((s) => new Date(s.created).getTime() >= fromDate).length,
      newCrystals: crystals.filter((c) => new Date(c.detectedAt).getTime() >= fromDate).length,
    },
  });
}

function operatorCtx(req) {
  if (req?.actor) return { actor: req.actor };
  if (req?.user?.id) {
    return { actor: { id: req.user.id, userId: req.user.id, role: req.user.role } };
  }
  return { actor: null };
}

export function handleTimeCrystalDetect(req, res, detect) {
  const viewerId = requesterIdFromReq(req);
  if (!viewerId) return res.status(401).json({ ok: false, error: "auth_required" });
  if (!isOperator(operatorCtx(req))) {
    return res.status(403).json({ ok: false, error: "operator_only", reason: "operator_only" });
  }
  try {
    const crystals = typeof detect === "function" ? detect() : [];
    return res.json({ ok: true, crystals, count: Array.isArray(crystals) ? crystals.length : 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
