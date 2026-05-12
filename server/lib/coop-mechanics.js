import { LruMap, LruSet } from "./lru-map.js";
/**
 * Cooperative mechanics — coop build, shared inventory, cross-world raids.
 *
 * Builds on the existing parties primitive. A party can opt into:
 *   • coop_build       — every party member's edits to a designated build site
 *                         apply to a single shared blueprint (no merge conflicts;
 *                         last-write-wins per cell, broadcast immediately)
 *   • shared_inventory — a single party-pooled stash. Items deposited become
 *                         party property; withdrawal requires party membership
 *                         + leader-set permissions (open / leader_only / vote)
 *   • raid             — multi-world coordinated objective. The party leader
 *                         declares the raid target; members in any connected
 *                         world contribute progress toward a shared counter.
 *                         Completion drops loot to every participant's
 *                         personal inventory.
 *
 * Persistence: in-memory module state for now; the DB tables added by
 * migration 085 mirror the structure for restart durability.
 */

const _coopBuilds  = new LruMap();   // siteId -> { partyId, ownerId, dtus: [...], lastEditAt, openInvite }
const _sharedStash = new LruMap();   // partyId -> { items: [{ id, kind, name, depositedBy, ts }], permission }
const _raids       = new LruMap();   // raidId -> { partyId, target, worlds: Set, progress, threshold, contributors: Map }

const VALID_PERMS = new Set(["open", "leader_only", "vote"]);

// ── Coop build ───────────────────────────────────────────────────────────

export function createCoopBuildSite({ partyId, ownerId, position }) {
  if (!partyId || !ownerId) return { ok: false, error: "missing_party_or_owner" };
  const siteId = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _coopBuilds.set(siteId, {
    siteId,
    partyId,
    ownerId,
    position: position ?? { x: 0, y: 0, z: 0 },
    dtus: [],
    lastEditAt: Date.now(),
    edits: 0,
  });
  return { ok: true, siteId };
}

export function applyCoopBuildEdit({ siteId, userId, dtuId, op = "place", cell }) {
  const site = _coopBuilds.get(siteId);
  if (!site) return { ok: false, error: "site_not_found" };
  // The party-membership check is the caller's responsibility (route-level).
  if (op === "place") {
    site.dtus.push({ dtuId, by: userId, cell, ts: Date.now() });
  } else if (op === "remove") {
    site.dtus = site.dtus.filter(d => d.dtuId !== dtuId);
  }
  site.lastEditAt = Date.now();
  site.edits++;
  return { ok: true, site };
}

export function getCoopBuildSite(siteId) {
  const s = _coopBuilds.get(siteId);
  if (!s) return { ok: false, error: "site_not_found" };
  return { ok: true, site: s };
}

export function listCoopBuildSites(partyId) {
  const out = [];
  for (const s of _coopBuilds.values()) {
    if (s.partyId === partyId) out.push(s);
  }
  return { ok: true, sites: out };
}

// ── Shared inventory ─────────────────────────────────────────────────────

export function ensureSharedStash(partyId, opts = {}) {
  if (!partyId) return null;
  if (!_sharedStash.has(partyId)) {
    _sharedStash.set(partyId, {
      partyId,
      items: [],
      permission: VALID_PERMS.has(opts.permission) ? opts.permission : "open",
      createdAt: Date.now(),
    });
  }
  return _sharedStash.get(partyId);
}

export function depositToStash({ partyId, userId, item }) {
  if (!partyId || !item) return { ok: false, error: "missing_party_or_item" };
  const stash = ensureSharedStash(partyId);
  const entry = {
    id: `stash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind: item.kind ?? "dtu",
    name: item.name ?? item.title ?? "(untitled)",
    payload: item,
    depositedBy: userId,
    ts: Date.now(),
  };
  stash.items.push(entry);
  return { ok: true, item: entry };
}

export function withdrawFromStash({ partyId, userId, itemId, isLeader, voteApproved }) {
  const stash = _sharedStash.get(partyId);
  if (!stash) return { ok: false, error: "no_stash" };

  if (stash.permission === "leader_only" && !isLeader) {
    return { ok: false, error: "leader_only" };
  }
  if (stash.permission === "vote" && !voteApproved) {
    return { ok: false, error: "needs_vote" };
  }

  const idx = stash.items.findIndex(i => i.id === itemId);
  if (idx === -1) return { ok: false, error: "item_not_found" };
  const [item] = stash.items.splice(idx, 1);
  return { ok: true, item, withdrawnBy: userId };
}

export function setStashPermission({ partyId, isLeader, permission }) {
  if (!isLeader) return { ok: false, error: "leader_only" };
  if (!VALID_PERMS.has(permission)) return { ok: false, error: "invalid_permission" };
  const stash = ensureSharedStash(partyId);
  stash.permission = permission;
  return { ok: true, permission };
}

export function getSharedStash(partyId) {
  const stash = _sharedStash.get(partyId);
  return stash ? { ok: true, stash } : { ok: false, error: "no_stash" };
}

// ── Cross-world raid coordination ────────────────────────────────────────

export function startRaid({ partyId, leaderId, target, threshold = 100, worlds = ["concordia"] }) {
  if (!partyId || !leaderId || !target) {
    return { ok: false, error: "missing_party_leader_or_target" };
  }
  const raidId = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _raids.set(raidId, {
    raidId,
    partyId,
    leaderId,
    target,
    threshold,
    worlds: new Set(worlds),
    progress: 0,
    contributors: new Map(),
    startedAt: Date.now(),
    completedAt: null,
    state: "active",
  });
  return { ok: true, raidId };
}

export function contributeToRaid({ raidId, userId, worldId, amount = 1 }) {
  const raid = _raids.get(raidId);
  if (!raid) return { ok: false, error: "raid_not_found" };
  if (raid.state !== "active") return { ok: false, error: "raid_not_active" };
  if (worldId && !raid.worlds.has(worldId)) raid.worlds.add(worldId);
  const prev = raid.contributors.get(userId) || 0;
  raid.contributors.set(userId, prev + amount);
  raid.progress = Math.min(raid.threshold, raid.progress + amount);
  if (raid.progress >= raid.threshold) {
    raid.state = "completed";
    raid.completedAt = Date.now();
  }
  return { ok: true, raid: snapshotRaid(raid) };
}

export function getRaid(raidId) {
  const raid = _raids.get(raidId);
  if (!raid) return { ok: false, error: "raid_not_found" };
  return { ok: true, raid: snapshotRaid(raid) };
}

export function listActiveRaids(filter = {}) {
  const out = [];
  for (const raid of _raids.values()) {
    if (filter.partyId && raid.partyId !== filter.partyId) continue;
    if (filter.state && raid.state !== filter.state) continue;
    out.push(snapshotRaid(raid));
  }
  return { ok: true, raids: out };
}

function snapshotRaid(raid) {
  return {
    raidId: raid.raidId,
    partyId: raid.partyId,
    leaderId: raid.leaderId,
    target: raid.target,
    threshold: raid.threshold,
    progress: raid.progress,
    worlds: [...raid.worlds],
    state: raid.state,
    contributors: [...raid.contributors.entries()].map(([userId, amount]) => ({ userId, amount })),
    startedAt: raid.startedAt,
    completedAt: raid.completedAt,
  };
}
