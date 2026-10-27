/**
 * Visibility of a consolidated node (mega or hyper) from its members.
 *
 * Rule (Ramaj, 2026-10-27): a mega or hyper built only from public content is
 * public. Otherwise it takes the most restrictive member visibility, so
 * private and internal content never leaks into a public summary. A hyper's
 * members are its megas, so a hyper is public only when every mega is.
 *
 * A member counts as public only when its visibility is explicitly public,
 * published or marketplace and nothing else closes it (privacy private or
 * followers-only, or a user/personal/private/system scope). A member with no
 * visibility counts as private: "every member is public" must be provable.
 *
 * Restrictiveness: internal > private > public. A private result keeps the
 * single owner of the private members, so that owner can still read it and
 * boot ownership normalization (lib/dtu-ownership.js) does not turn it into
 * internal. Private members from more than one owner make the result internal,
 * so no user sees another user's private content through a summary.
 */
import { concreteUserOwner } from "./dtu-ownership.js";
import { isQuarantined } from "./dtu-quarantine.js";

const PUBLIC = new Set(["public", "published", "marketplace"]);
const INTERNAL = new Set(["internal", "system"]);
const CLOSED_PRIVACY = new Set(["private", "followers-only", "followers_only"]);
const CLOSED_SCOPES = new Set(["user", "personal", "private"]);
const PRIVATE_SCOPES = /^(personal|private|local|user)$/i;

function str(v) { return typeof v === "string" ? v.trim().toLowerCase() : ""; }

/** "public" | "private" | "internal" for one member. */
export function memberVisibilityClass(m) {
  if (!m || typeof m !== "object") return "internal";
  const vis = str(m.visibility);
  const scope = str(m.scope);
  if (INTERNAL.has(vis) || scope === "system") return "internal";
  if (!PUBLIC.has(vis)) return "private";
  // quarantine:* content is never public, so it never opens a summary.
  if (isQuarantined(m)) return "private";
  if (CLOSED_PRIVACY.has(str(m.privacy)) || CLOSED_SCOPES.has(scope)) return "private";
  return "public";
}

/**
 * @param {object[]} members  the node's members (regulars for a mega, megas for a hyper)
 * @param {{ scope?: string }} [opts]  the scope the node would otherwise inherit
 * @returns {{ visibility: "public"|"private"|"internal", ownerId: string|null, scope: string|undefined, reason: string, counts: object }}
 */
export function consolidatedVisibility(members, { scope } = {}) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  const counts = { public: 0, private: 0, internal: 0 };
  const privateOwners = new Set();
  for (const m of list) {
    const c = memberVisibilityClass(m);
    counts[c]++;
    if (c === "private") { const o = concreteUserOwner(m); if (o) privateOwners.add(o); }
  }
  if (!list.length) return { visibility: "internal", ownerId: null, scope, reason: "no_members", counts };
  if (counts.internal > 0) return { visibility: "internal", ownerId: null, scope, reason: "internal_member", counts };
  if (counts.private > 0) {
    if (privateOwners.size > 1) return { visibility: "internal", ownerId: null, scope, reason: "private_members_mixed_owners", counts };
    return { visibility: "private", ownerId: privateOwners.size === 1 ? [...privateOwners][0] : null, scope, reason: "private_member", counts };
  }
  // All public: a private-flavoured inherited scope (feeds are "local") would
  // contradict the visibility; public consolidated nodes are global.
  const outScope = !scope || PRIVATE_SCOPES.test(String(scope)) ? "global" : scope;
  return { visibility: "public", ownerId: null, scope: outScope, reason: "all_public", counts };
}

/** Write a consolidatedVisibility() result onto a node. Returns the node. */
export function applyConsolidatedVisibility(node, result) {
  if (!node || !result) return node;
  node.visibility = result.visibility;
  if (result.scope) node.scope = result.scope;
  if (result.ownerId && !concreteUserOwner(node)) node.ownerId = result.ownerId;
  node.meta = { ...(node.meta || {}), visibilityRule: { rule: "consolidated_members_v1", reason: result.reason, counts: result.counts } };
  return node;
}

/**
 * Absorbing new members into an existing node can only tighten it: the node
 * itself counts as a member, so a public node that absorbs a private member
 * becomes private, and a closed node never opens.
 */
export function absorbVisibility(node, fresh) {
  return consolidatedVisibility([node, ...(Array.isArray(fresh) ? fresh : [])], { scope: node?.scope });
}

/**
 * One-shot backfill: consolidated nodes created on or after `since` that are
 * closed (internal/private), have no user owner (or were minted by gap
 * promotion and only inherited one), and whose members ALL load
 * and are ALL public become public. Nothing is ever tightened or touched
 * otherwise. Megas run before hypers so a hyper sees its megas' new state.
 *
 * @param {object} p
 * @param {Iterable<object>} p.nodes
 * @param {(id: string) => object|null} p.loadMember  live store first, then the archive
 * @param {string} p.since  ISO timestamp
 * @param {(node: object) => void} [p.persist]  omit for a dry run
 * @param {number} [p.limit]
 */
export function backfillConsolidatedVisibility({ nodes, loadMember, since, persist = null, limit = 1000 }) {
  const out = { checked: 0, opened: 0, notAllPublic: 0, unresolved: 0, skipped: 0, openedIds: [], dryRun: !persist };
  const sinceMs = Date.parse(since || "");
  const cands = [];
  for (const n of nodes || []) {
    if (!n || (n.tier !== "mega" && n.tier !== "hyper")) continue;
    if (!["internal", "private"].includes(str(n.visibility))) continue;
    if (isQuarantined(n)) continue; // quarantine:* is never opened
    // A user-owned node is only considered when consolidation minted it
    // (it inherited the owner from its members). Chat/user megas stay put.
    if (concreteUserOwner(n) && n.lineage?.kind !== "gap_promotion") continue;
    if (Number.isFinite(sinceMs) && !(Date.parse(n.createdAt || "") >= sinceMs)) continue;
    cands.push(n);
  }
  cands.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "mega" ? -1 : 1));
  for (const n of cands.slice(0, limit)) {
    out.checked++;
    const ids = Array.isArray(n.lineage?.parents) ? n.lineage.parents : [];
    if (!ids.length) { out.skipped++; continue; }
    const members = ids.map((id) => { try { return loadMember(id); } catch { return null; } });
    if (members.some((m) => !m)) { out.unresolved++; continue; }
    const r = consolidatedVisibility(members, { scope: n.scope });
    if (r.visibility !== "public") { out.notAllPublic++; continue; }
    out.opened++;
    out.openedIds.push(n.id);
    if (persist) {
      const from = n.visibility;
      applyConsolidatedVisibility(n, r);
      n.meta.visibilityBackfill = { at: new Date().toISOString(), from };
      persist(n);
    }
  }
  return out;
}
