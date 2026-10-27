/**
 * Feed ingest provenance + quarantine visibility (security follow-up to #1610).
 *
 * #1610 opened rows whose `source` is an allowlisted public feed and that
 * carry the "feed" tag. Both fields are caller-controlled: any user could
 * create a private row with source "crossref-feed" and tag "feed", and the
 * boot backfill would make it public. This module adds proof that a row was
 * really written by a lens `feed` action:
 *
 *   meta.feedIngest = { domain, action, source, at }
 *
 * It is set ONLY by dtu.create while a registerLensAction feed handler is
 * running (AsyncLocalStorage, set by runAsFeedIngest in the registerLensAction
 * wrapper). It is not readable from a request body: dtu.create strips any
 * caller-supplied meta.feedIngest, dtu.update never writes meta, and fork
 * drops it.
 *
 * Also here: quarantine:* rows are never public or listed, and a
 * user-sourced row with no visibility is private.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { hasIngestMarker } from "./public-feed-sources.js";
import { concreteUserOwner } from "./dtu-ownership.js";
import { isQuarantined } from "./dtu-quarantine.js";
import { consolidatedVisibility, applyConsolidatedVisibility } from "./consolidated-visibility.js";

const _feedIngest = new AsyncLocalStorage();

/** Run fn as a lens feed ingest. dtu.create inside it stamps meta.feedIngest. */
export function runAsFeedIngest(info, fn) {
  const store = Object.freeze({ domain: String(info?.domain || ""), action: String(info?.action || "feed") });
  return _feedIngest.run(store, fn);
}

/** The running feed ingest ({ domain, action }) or null. */
export function currentFeedIngest() {
  return _feedIngest.getStore() || null;
}

/** Wrap a lens handler so it runs as a feed ingest. */
export function wrapFeedIngestHandler(domain, action, handler) {
  if (typeof handler !== "function") return handler;
  const wrapped = function feedIngestHandler(...args) {
    return runAsFeedIngest({ domain, action }, () => handler.apply(this, args));
  };
  wrapped.__feedIngest = true;
  return wrapped;
}

/** Copy of a caller meta object without the server-only marker. */
export function stripFeedIngestMarker(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  if (!Object.prototype.hasOwnProperty.call(meta, "feedIngest")) return meta;
  const { feedIngest: _drop, ...rest } = meta;
  return rest;
}

/** The marker dtu.create stamps for `source`, or null outside a feed ingest. */
export function feedIngestMarkerFor(source, now = () => new Date().toISOString()) {
  const fi = currentFeedIngest();
  if (!fi) return null;
  return { domain: fi.domain, action: fi.action, source: typeof source === "string" ? source : null, at: now() };
}

/** True when the row was written by a lens feed action for its own allowlisted source. */
export function hasFeedIngestProvenance(d) {
  return hasIngestMarker(d);
}

export { isQuarantined };

const OPEN_VIS = new Set(["public", "published", "marketplace"]);
export function isOpenVisibility(v) { return OPEN_VIS.has(String(v || "").toLowerCase()); }

/** Closed visibility for a quarantined row: private to its user owner, else internal. */
export function quarantineVisibility(d) {
  return concreteUserOwner(d) ? "private" : "internal";
}

/**
 * Boot step 1: rows the #1610 backfill opened (meta.publicFeed.from ===
 * "private") that have no ingest provenance go back to private / local.
 */
export function revertUnprovenPublicFeedItems({ nodes, persist = null, now = () => new Date().toISOString() }) {
  const out = { checked: 0, kept: 0, reverted: 0, keptBySource: {}, revertedBySource: {}, revertedIds: [], dryRun: !persist };
  for (const d of nodes || []) {
    if (!d || d.meta?.publicFeed?.from !== "private") continue;
    if (!isOpenVisibility(d.visibility)) continue;
    out.checked++;
    if (hasFeedIngestProvenance(d) && !isQuarantined(d)) {
      out.kept++; out.keptBySource[d.source] = (out.keptBySource[d.source] || 0) + 1;
      continue;
    }
    out.reverted++; out.revertedBySource[d.source] = (out.revertedBySource[d.source] || 0) + 1;
    out.revertedIds.push(d.id);
    if (persist) {
      d.visibility = "private";
      d.federation_tier = "local";
      if (d.federationTier) d.federationTier = "local";
      d.meta = { ...(d.meta || {}), publicFeed: { ...d.meta.publicFeed, revertedAt: now(), revertReason: "no_feed_ingest_provenance" } };
      persist(d);
    }
  }
  return out;
}

/** Boot step 2: quarantine:* rows that are open become private/internal. */
export function hideQuarantinedRows({ nodes, persist = null, now = () => new Date().toISOString() }) {
  const out = { hidden: 0, hiddenIds: [], dryRun: !persist };
  for (const d of nodes || []) {
    if (!d || !isQuarantined(d) || !isOpenVisibility(d.visibility)) continue;
    out.hidden++; out.hiddenIds.push(d.id);
    if (persist) {
      const from = d.visibility;
      d.visibility = quarantineVisibility(d);
      d.meta = { ...(d.meta || {}), quarantineHide: { at: now(), from } };
      persist(d);
    }
  }
  return out;
}

/** A user-sourced row (source "user" or "user:<id>") with no visibility. */
export function isUserSourcedWithoutVisibility(d) {
  if (!d || typeof d !== "object") return false;
  if (d.visibility != null && String(d.visibility).trim() !== "") return false;
  const s = typeof d.source === "string" ? d.source : "";
  return s === "user" || s.startsWith("user:");
}

/** Boot step 3: user-sourced rows with no visibility become private. */
export function privatizeUserSourcedRows({ nodes, persist = null }) {
  const out = { privatized: 0, ids: [], dryRun: !persist };
  for (const d of nodes || []) {
    if (!isUserSourcedWithoutVisibility(d)) continue;
    out.privatized++; out.ids.push(d.id);
    if (persist) { d.visibility = "private"; persist(d); }
  }
  return out;
}

/**
 * Boot step 4: public megas/hypers whose visibility came from the #1599
 * member rule are re-checked against their members (after steps 1-3) and
 * closed when a member is no longer public. Only tightens. Megas first so a
 * hyper sees its megas' new state.
 */
export function recloseConsolidatedNodes({ nodes, loadMember, persist = null, now = () => new Date().toISOString() }) {
  const out = { checked: 0, closed: 0, unresolved: 0, closedIds: [], dryRun: !persist };
  const cands = [];
  for (const n of nodes || []) {
    if (!n || (n.tier !== "mega" && n.tier !== "hyper")) continue;
    if (!isOpenVisibility(n.visibility)) continue;
    if (n.meta?.visibilityRule?.rule !== "consolidated_members_v1") continue;
    cands.push(n);
  }
  cands.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "mega" ? -1 : 1));
  for (const n of cands) {
    out.checked++;
    const ids = Array.isArray(n.lineage?.parents) ? n.lineage.parents : [];
    if (!ids.length) continue;
    const members = ids.map((id) => { try { return loadMember(id); } catch { return null; } });
    // A member that no longer loads cannot be proven public: close.
    if (members.some((m) => !m)) out.unresolved++;
    const r = consolidatedVisibility(members.map((m) => m || { visibility: "internal" }), { scope: n.scope });
    if (r.visibility === "public") continue;
    out.closed++; out.closedIds.push(n.id);
    if (persist) {
      const from = n.visibility;
      applyConsolidatedVisibility(n, r);
      n.meta.visibilityReclose = { at: now(), from, reason: r.reason };
      persist(n);
    }
  }
  return out;
}
