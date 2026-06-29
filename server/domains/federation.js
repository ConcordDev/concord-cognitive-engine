// server/domains/federation.js
// Federation lens — fediverse-style instance admin console.
//
// Existing macros: peers, activity (peer list + federated activity feed).
// Backlog macros (this file): allowlist/blocklist/defederation, inbound
// moderation queue, per-peer sync policy, relay subscriptions, peer
// trust-score history, federation activity metrics, signed-actor key
// verification + rotation handling.
//
// Persistent per-user state lives on globalThis._concordSTATE under a
// single `federation` namespace of Maps keyed by userId. Handlers never
// throw — every path is wrapped and returns { ok, result?, error? }.

import { listPeers } from "../lib/federation.js";

// ── per-user state ──────────────────────────────────────────────────

function fedState() {
  const STATE = (globalThis._concordSTATE ||= {});
  if (!STATE.federation) {
    STATE.federation = {
      // userId -> { domain -> { policy: 'allow'|'block'|'pending', reason, addedAt, updatedAt } }
      access: new Map(),
      // userId -> [ moderationItem ]
      moderation: new Map(),
      // userId -> { domain -> { inbound, outbound, classes:[], updatedAt } }
      syncPolicy: new Map(),
      // userId -> [ relaySubscription ]
      relays: new Map(),
      // userId -> { domain -> [ { at, score, delta, reason } ] }
      trustHistory: new Map(),
      // userId -> [ metricSample ]
      metrics: new Map(),
      // userId -> { domain -> { keyId, publicKey, algo, verified, rotatedAt, fingerprint } }
      actorKeys: new Map(),
    };
  }
  return STATE.federation;
}

function userId(ctx) {
  return String(ctx?.actor?.userId ?? ctx?.userId ?? "anon");
}

function userMap(map, uid, factory) {
  if (!map.has(uid)) map.set(uid, factory());
  return map.get(uid);
}

function now() {
  return Date.now();
}

function newId(prefix) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Normalise a peer reference to a stable domain key.
function normDomain(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return s;
}

// Deterministic small fingerprint of a public-key string (no crypto dep).
function fingerprint(key) {
  if (!key || typeof key !== "string") return "";
  let h1 = 0x811c9dc5;
  let h2 = 0x1505;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = ((h2 << 5) + h2 + c) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
  return hex.match(/.{2}/g).join(":").toUpperCase();
}

const SYNC_CLASSES = ["dtu", "trust", "activity", "moderation", "media", "lineage"];

export default function registerFederationActions(registerLensAction) {
  // ── peers — current federation peer list with trust scores ────────
  registerLensAction("federation", "peers", (ctx) => {
    try {
      const STATE = globalThis._concordSTATE;
      const peers = STATE?.settings?.federationPeers ?? [];
      let trustGraph = [];
      try {
        // listPeers returns { ok, peers: [...] } — unwrap to the array.
        const lp = listPeers(ctx?.db, {});
        trustGraph = Array.isArray(lp) ? lp : (lp?.peers ?? []);
      } catch { /* DB-dependent helper — empty list on minimal builds */ }
      return {
        ok: true,
        result: {
          configured: peers.map((p) => ({ id: p.id ?? p.url, url: p.url, hasToken: !!p.token })),
          trustGraph: trustGraph.slice(0, 50),
          federationEnabled: STATE?.settings?.federationEnabled !== false,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── activity — federated shadow-DTU feed ──────────────────────────
  registerLensAction("federation", "activity", () => {
    try {
      const STATE = globalThis._concordSTATE;
      if (!STATE?.shadowDtus) return { ok: true, result: { items: [] } };
      const items = [];
      for (const s of STATE.shadowDtus.values()) {
        if (!Array.isArray(s.tags) || !s.tags.includes("federated_signal")) continue;
        items.push({
          id: s.id,
          summary: s.core?.summary ?? "",
          sourcePeer: s.sourcePeer,
          createdAt: s.createdAt,
        });
        if (items.length >= 50) break;
      }
      items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return { ok: true, result: { items } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // [M] Allowlist / blocklist / defederation controls per peer
  // ════════════════════════════════════════════════════════════════

  // setPeerPolicy — { domain, policy: 'allow'|'block'|'pending', reason? }
  registerLensAction("federation", "setPeerPolicy", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      const policy = String(p.policy || "").toLowerCase();
      if (!["allow", "block", "pending"].includes(policy)) {
        return { ok: false, error: "policy must be allow|block|pending" };
      }
      const fs = fedState();
      const uid = userId(ctx);
      const access = userMap(fs.access, uid, () => new Map());
      const existing = access.get(domain);
      const entry = {
        domain,
        policy,
        reason: typeof p.reason === "string" ? p.reason : (existing?.reason ?? ""),
        addedAt: existing?.addedAt ?? now(),
        updatedAt: now(),
      };
      access.set(domain, entry);
      return { ok: true, result: { entry, total: access.size } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // listPeerPolicies — { filter? 'allow'|'block'|'pending' }
  registerLensAction("federation", "listPeerPolicies", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const fs = fedState();
      const access = userMap(fs.access, userId(ctx), () => new Map());
      let entries = [...access.values()];
      if (p.filter) entries = entries.filter((e) => e.policy === p.filter);
      entries.sort((a, b) => b.updatedAt - a.updatedAt);
      const counts = { allow: 0, block: 0, pending: 0 };
      for (const e of access.values()) counts[e.policy] = (counts[e.policy] || 0) + 1;
      return { ok: true, result: { entries, counts, total: access.size } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // removePeerPolicy — { domain }
  registerLensAction("federation", "removePeerPolicy", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      const fs = fedState();
      const access = userMap(fs.access, userId(ctx), () => new Map());
      const removed = access.delete(domain);
      return { ok: true, result: { removed, total: access.size } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // checkPeerAllowed — { domain } -> is this peer permitted to federate?
  registerLensAction("federation", "checkPeerAllowed", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      const fs = fedState();
      const access = userMap(fs.access, userId(ctx), () => new Map());
      const entry = access.get(domain) || null;
      // Default-allow when no explicit policy; block when policy says so.
      const allowed = !entry ? true : entry.policy === "allow";
      return { ok: true, result: { domain, allowed, policy: entry?.policy ?? "default", entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // [M] Inbound moderation queue for federated content
  // ════════════════════════════════════════════════════════════════

  // reportInbound — { sourceDomain, contentId?, summary, reason }
  registerLensAction("federation", "reportInbound", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.sourceDomain || p.domain);
      if (!domain) return { ok: false, error: "sourceDomain required" };
      const reason = String(p.reason || "").trim();
      if (!reason) return { ok: false, error: "reason required" };
      const fs = fedState();
      const queue = userMap(fs.moderation, userId(ctx), () => []);
      const item = {
        id: newId("mod"),
        sourceDomain: domain,
        contentId: p.contentId ? String(p.contentId) : null,
        summary: String(p.summary || "").slice(0, 500),
        reason,
        status: "open",
        decision: null,
        reportedAt: now(),
        reviewedAt: null,
      };
      queue.unshift(item);
      if (queue.length > 500) queue.length = 500;
      return { ok: true, result: { item, open: queue.filter((q) => q.status === "open").length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // listModerationQueue — { status? 'open'|'reviewed'|'all' }
  registerLensAction("federation", "listModerationQueue", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const fs = fedState();
      const queue = userMap(fs.moderation, userId(ctx), () => []);
      const status = p.status || "open";
      let items = queue;
      if (status === "open") items = queue.filter((q) => q.status === "open");
      else if (status === "reviewed") items = queue.filter((q) => q.status === "reviewed");
      return {
        ok: true,
        result: {
          items,
          open: queue.filter((q) => q.status === "open").length,
          reviewed: queue.filter((q) => q.status === "reviewed").length,
          total: queue.length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // reviewInbound — { id, decision: 'approve'|'reject'|'defederate' }
  registerLensAction("federation", "reviewInbound", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const id = String(p.id || "");
      const decision = String(p.decision || "").toLowerCase();
      if (!id) return { ok: false, error: "id required" };
      if (!["approve", "reject", "defederate"].includes(decision)) {
        return { ok: false, error: "decision must be approve|reject|defederate" };
      }
      const fs = fedState();
      const uid = userId(ctx);
      const queue = userMap(fs.moderation, uid, () => []);
      const item = queue.find((q) => q.id === id);
      if (!item) return { ok: false, error: "moderation item not found" };
      item.status = "reviewed";
      item.decision = decision;
      item.reviewedAt = now();
      let defederated = false;
      // A 'defederate' decision auto-blocks the source peer.
      if (decision === "defederate") {
        const access = userMap(fs.access, uid, () => new Map());
        access.set(item.sourceDomain, {
          domain: item.sourceDomain,
          policy: "block",
          reason: `defederated via moderation: ${item.reason}`,
          addedAt: access.get(item.sourceDomain)?.addedAt ?? now(),
          updatedAt: now(),
        });
        defederated = true;
      }
      return { ok: true, result: { item, defederated } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // [S] Per-peer sync policy — what content flows which direction
  // ════════════════════════════════════════════════════════════════

  // setSyncPolicy — { domain, inbound: bool, outbound: bool, classes: [] }
  registerLensAction("federation", "setSyncPolicy", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      let classes = Array.isArray(p.classes) ? p.classes : [];
      classes = classes.filter((c) => SYNC_CLASSES.includes(c));
      if (classes.length === 0) classes = ["dtu"];
      const fs = fedState();
      const map = userMap(fs.syncPolicy, userId(ctx), () => new Map());
      const entry = {
        domain,
        inbound: p.inbound !== false,
        outbound: p.outbound !== false,
        classes,
        updatedAt: now(),
      };
      map.set(domain, entry);
      return { ok: true, result: { entry, validClasses: SYNC_CLASSES } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // listSyncPolicies
  registerLensAction("federation", "listSyncPolicies", (ctx) => {
    try {
      const fs = fedState();
      const map = userMap(fs.syncPolicy, userId(ctx), () => new Map());
      const entries = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, result: { entries, total: map.size, validClasses: SYNC_CLASSES } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // [M] Relay support — subscribe to a relay for broader discovery
  // ════════════════════════════════════════════════════════════════

  // subscribeRelay — { url, name? }
  registerLensAction("federation", "subscribeRelay", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const url = String(p.url || "").trim();
      if (!url) return { ok: false, error: "url required" };
      if (!/^https?:\/\//.test(url)) return { ok: false, error: "url must be http(s)" };
      const fs = fedState();
      const relays = userMap(fs.relays, userId(ctx), () => []);
      const domain = normDomain(url);
      if (relays.some((r) => r.domain === domain)) {
        return { ok: false, error: "relay already subscribed" };
      }
      const relay = {
        id: newId("relay"),
        url,
        domain,
        name: String(p.name || domain),
        status: "subscribed",
        subscribedAt: now(),
        lastPullAt: null,
        discoveredPeers: 0,
      };
      relays.push(relay);
      return { ok: true, result: { relay, total: relays.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // listRelays
  registerLensAction("federation", "listRelays", (ctx) => {
    try {
      const fs = fedState();
      const relays = userMap(fs.relays, userId(ctx), () => []);
      return { ok: true, result: { relays, total: relays.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // pollRelay — { id } — simulate a discovery pass against a subscribed relay
  registerLensAction("federation", "pollRelay", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const id = String(p.id || "");
      if (!id) return { ok: false, error: "id required" };
      const fs = fedState();
      const relays = userMap(fs.relays, userId(ctx), () => []);
      const relay = relays.find((r) => r.id === id);
      if (!relay) return { ok: false, error: "relay not found" };
      // Discovery is derived from configured peers + trust graph the
      // relay would surface — no fabricated peers, just a real count.
      const STATE = globalThis._concordSTATE;
      const configured = STATE?.settings?.federationPeers ?? [];
      let graphCount = 0;
      try {
        // listPeers returns { ok, peers: [...] } — count the array.
        const lp = listPeers(ctx?.db, {});
        graphCount = (Array.isArray(lp) ? lp : (lp?.peers ?? [])).length;
      } catch { /* minimal build */ }
      relay.lastPullAt = now();
      relay.discoveredPeers = configured.length + graphCount;
      relay.status = "active";
      return { ok: true, result: { relay } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // unsubscribeRelay — { id }
  registerLensAction("federation", "unsubscribeRelay", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const id = String(p.id || "");
      if (!id) return { ok: false, error: "id required" };
      const fs = fedState();
      const relays = userMap(fs.relays, userId(ctx), () => []);
      const idx = relays.findIndex((r) => r.id === id);
      if (idx === -1) return { ok: false, error: "relay not found" };
      relays.splice(idx, 1);
      return { ok: true, result: { removed: true, total: relays.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // [S] Peer trust-score history / reputation timeline
  // ════════════════════════════════════════════════════════════════

  // recordTrustEvent — { domain, score (0..1), reason? }
  registerLensAction("federation", "recordTrustEvent", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      const score = Number(p.score);
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        return { ok: false, error: "score must be a number 0..1" };
      }
      const fs = fedState();
      const map = userMap(fs.trustHistory, userId(ctx), () => new Map());
      const series = map.get(domain) || [];
      const prev = series.length ? series[series.length - 1].score : score;
      const sample = {
        at: now(),
        score: Math.round(score * 1000) / 1000,
        delta: Math.round((score - prev) * 1000) / 1000,
        reason: typeof p.reason === "string" ? p.reason : "",
      };
      series.push(sample);
      if (series.length > 200) series.shift();
      map.set(domain, series);
      return { ok: true, result: { sample, points: series.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // trustHistory — { domain } -> reputation timeline for one peer
  registerLensAction("federation", "trustHistory", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      const fs = fedState();
      const map = userMap(fs.trustHistory, userId(ctx), () => new Map());
      const series = map.get(domain) || [];
      const current = series.length ? series[series.length - 1].score : null;
      const min = series.length ? Math.min(...series.map((s) => s.score)) : null;
      const max = series.length ? Math.max(...series.map((s) => s.score)) : null;
      const avg = series.length
        ? Math.round((series.reduce((a, s) => a + s.score, 0) / series.length) * 1000) / 1000
        : null;
      return { ok: true, result: { domain, series, current, min, max, avg } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // [S] Federation activity metrics dashboard (in/out volume over time)
  // ════════════════════════════════════════════════════════════════

  // recordMetric — { inbound?, outbound?, label? } — append one sample
  registerLensAction("federation", "recordMetric", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const inbound = Math.max(0, Number(p.inbound) || 0);
      const outbound = Math.max(0, Number(p.outbound) || 0);
      const fs = fedState();
      const samples = userMap(fs.metrics, userId(ctx), () => []);
      const sample = {
        at: now(),
        inbound,
        outbound,
        label: String(p.label || ""),
      };
      samples.push(sample);
      if (samples.length > 500) samples.shift();
      return { ok: true, result: { sample, total: samples.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // metricsDashboard — { sinceMs? } -> aggregated in/out volume series
  registerLensAction("federation", "metricsDashboard", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const fs = fedState();
      const uid = userId(ctx);
      const samples = userMap(fs.metrics, uid, () => []);
      const sinceMs = Number(p.sinceMs);
      const cutoff = Number.isFinite(sinceMs) && sinceMs > 0 ? now() - sinceMs : 0;
      const series = samples.filter((s) => s.at >= cutoff);
      const totalInbound = series.reduce((a, s) => a + s.inbound, 0);
      const totalOutbound = series.reduce((a, s) => a + s.outbound, 0);
      // Live counts that don't depend on recorded samples.
      const access = userMap(fs.access, uid, () => new Map());
      const moderation = userMap(fs.moderation, uid, () => []);
      const relays = userMap(fs.relays, uid, () => []);
      const counts = { allow: 0, block: 0, pending: 0 };
      for (const e of access.values()) counts[e.policy] = (counts[e.policy] || 0) + 1;
      return {
        ok: true,
        result: {
          series,
          totalInbound,
          totalOutbound,
          ratio: totalOutbound > 0 ? Math.round((totalInbound / totalOutbound) * 100) / 100 : null,
          peerCounts: counts,
          openModeration: moderation.filter((m) => m.status === "open").length,
          relayCount: relays.length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // [M] Signed-actor verification + key rotation handling
  // ════════════════════════════════════════════════════════════════

  // registerActorKey — { domain, keyId, publicKey, algo? }
  registerLensAction("federation", "registerActorKey", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      const keyId = String(p.keyId || "").trim();
      if (!keyId) return { ok: false, error: "keyId required" };
      const publicKey = String(p.publicKey || "").trim();
      if (!publicKey || publicKey.length < 16) {
        return { ok: false, error: "publicKey required (min 16 chars)" };
      }
      const fs = fedState();
      const map = userMap(fs.actorKeys, userId(ctx), () => new Map());
      const existing = map.get(domain);
      const rotated = !!existing && existing.fingerprint !== fingerprint(publicKey);
      const entry = {
        domain,
        keyId,
        publicKey,
        algo: String(p.algo || "rsa-sha256"),
        fingerprint: fingerprint(publicKey),
        verified: false,
        registeredAt: existing?.registeredAt ?? now(),
        rotatedAt: rotated ? now() : (existing?.rotatedAt ?? null),
        rotationCount: rotated ? (existing?.rotationCount ?? 0) + 1 : (existing?.rotationCount ?? 0),
        priorFingerprint: rotated ? existing.fingerprint : (existing?.priorFingerprint ?? null),
      };
      map.set(domain, entry);
      return { ok: true, result: { entry, rotated } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // verifyActorSignature — { domain, keyId, signedFingerprint }
  // Verifies that a presented signature matches the registered key's
  // fingerprint (deterministic local check — no external crypto round-trip).
  registerLensAction("federation", "verifyActorSignature", (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const domain = normDomain(p.domain);
      if (!domain) return { ok: false, error: "domain required" };
      const fs = fedState();
      const map = userMap(fs.actorKeys, userId(ctx), () => new Map());
      const entry = map.get(domain);
      if (!entry) return { ok: false, error: "no registered key for domain" };
      const presentedKeyId = String(p.keyId || "");
      const presentedFp = String(p.signedFingerprint || "").toUpperCase();
      const keyIdMatch = !presentedKeyId || presentedKeyId === entry.keyId;
      const fpMatch = presentedFp === entry.fingerprint;
      const verified = keyIdMatch && fpMatch;
      entry.verified = verified;
      entry.lastVerifiedAt = verified ? now() : entry.lastVerifiedAt ?? null;
      return {
        ok: true,
        result: {
          domain,
          verified,
          keyIdMatch,
          fingerprintMatch: fpMatch,
          expectedFingerprint: entry.fingerprint,
          keyId: entry.keyId,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // listActorKeys — registered signed-actor keys with rotation state
  registerLensAction("federation", "listActorKeys", (ctx) => {
    try {
      const fs = fedState();
      const map = userMap(fs.actorKeys, userId(ctx), () => new Map());
      const entries = [...map.values()]
        .map((e) => ({
          domain: e.domain,
          keyId: e.keyId,
          algo: e.algo,
          fingerprint: e.fingerprint,
          verified: e.verified,
          registeredAt: e.registeredAt,
          rotatedAt: e.rotatedAt,
          rotationCount: e.rotationCount,
          priorFingerprint: e.priorFingerprint,
          lastVerifiedAt: e.lastVerifiedAt ?? null,
        }))
        .sort((a, b) => (b.rotatedAt ?? b.registeredAt) - (a.rotatedAt ?? a.registeredAt));
      return {
        ok: true,
        result: {
          entries,
          total: entries.length,
          verified: entries.filter((e) => e.verified).length,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
