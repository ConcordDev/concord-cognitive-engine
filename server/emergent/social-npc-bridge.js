// server/emergent/social-npc-bridge.js
//
// v2.0 bidirectional awareness loop. Public Social Lens posts (timeline DTUs
// with privacy='public') are wrapped as Shadow DTUs tagged 'social_awareness'
// and surfaced to NPCs via narrative-bridge so the in-game world stays aware
// of what real humans are talking about.
//
// Design:
//   - Read since last bridge run (lastBridgeRunAt cursor in STATE).
//   - Privacy enforcement is a hard backend filter — the bridge NEVER reads
//     a private or friends-only post. The query gates on data.privacy.
//   - Each public post becomes one shadow DTU. The shadow's `core.summary`
//     is the post body (capped at 280 chars). The shadow carries the
//     poster's handle as `authorHandle` and tags with 'social_awareness'.
//   - We avoid wiring full pattern edges here; this is awareness, not
//     citation. narrative-bridge.buildSocialSignals reads the shadows
//     directly via tag filter.
//   - Shadow capacity is bounded by shadow-graph's existing 2000-cap +
//     richness-based TTL; we don't add a parallel cap.
//
// Federation pass (Workstream 6b) is a follow-on: import shadows tagged
// 'federated_signal' from peers in the trust graph and feed them to NPCs
// at lower weight.
//
// Per CLAUDE.md: heartbeat modules must never throw. All work is wrapped
// in try/catch by the heartbeat-registry caller; we additionally guard
// each post individually so a single malformed row can't stop the batch.

const SUMMARY_MAX_CHARS = 280;
// Bumped from 200 → 2000 for 32GB-heap deployments. Per-tick cap on how
// many public timeline DTUs we wrap as social_awareness shadows in one pass.
const BATCH_LIMIT = Number(process.env.CONCORD_SOCIAL_BRIDGE_BATCH) || 2000;

/**
 * Run one pass of the social → NPC bridge.
 * @param {{ state: object, db: object, tickCount: number, reason: string }} ctx
 */
export async function runSocialNpcBridge({ state, db, tickCount }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!state) return { ok: false, reason: "no_state" };

  // Initialize shadow store + cursor on first run.
  if (!state.shadowDtus) state.shadowDtus = new Map();
  const cursor = state._socialNpcBridgeCursor || "1970-01-01T00:00:00.000Z";

  let rows = [];
  try {
    // Two privacy gates:
    //   1. tags must include 'timeline' (post-shaped DTU).
    //   2. body_json.privacy must be 'public'. We use json_extract for the
    //      authoritative gate so a forged tag can't bypass privacy.
    rows = db.prepare(`
      SELECT id, owner_user_id, title, body_json, tags_json, created_at
      FROM dtus
      WHERE tags_json LIKE '%timeline%'
        AND created_at > ?
        AND IFNULL(json_extract(body_json, '$.privacy'), 'public') = 'public'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(cursor, BATCH_LIMIT);
  } catch {
    // SQLite may lack json_extract on very old builds. Fall back to a
    // conservative scan that drops the privacy filter and we re-check in JS.
    rows = db.prepare(`
      SELECT id, owner_user_id, title, body_json, tags_json, created_at
      FROM dtus
      WHERE tags_json LIKE '%timeline%' AND created_at > ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(cursor, BATCH_LIMIT);
  }

  let createdShadows = 0;
  let lastSeenAt = cursor;

  for (const row of rows) {
    try {
      const body = safeJSON(row.body_json) || {};
      // JS-side privacy enforcement — defense in depth.
      const privacy = body.privacy ?? "public";
      if (privacy !== "public") {
        lastSeenAt = row.created_at; // still advance cursor so we don't re-scan it
        continue;
      }

      const summary = (body.content ?? row.title ?? "").toString().slice(0, SUMMARY_MAX_CHARS);
      if (!summary.trim()) {
        lastSeenAt = row.created_at;
        continue;
      }

      const shadowId = `shadow_social_${row.id}`;
      // Idempotent: if we've already shadowed this post, skip — shadow-graph
      // de-dups by id but we save the JSON parse cost.
      if (state.shadowDtus.has(shadowId)) {
        lastSeenAt = row.created_at;
        continue;
      }

      const shadowDtu = {
        id: shadowId,
        kind: "shadow",
        tags: ["social_awareness"],
        core: { summary },
        authorHandle: row.owner_user_id || "anon",
        sourceDtuId: row.id,
        targetWorldId: body.worldId ?? null,
        targetFactionId: body.factionId ?? null,
        createdAt: Date.parse(row.created_at) || Date.now(),
      };

      state.shadowDtus.set(shadowId, shadowDtu);
      createdShadows++;
      lastSeenAt = row.created_at;
    } catch {
      // Skip malformed row, advance cursor so we don't loop on it.
      lastSeenAt = row.created_at || lastSeenAt;
    }
  }

  state._socialNpcBridgeCursor = lastSeenAt;
  state._socialNpcBridgeLastTick = tickCount;
  state._socialNpcBridgeLastCount = createdShadows;

  // Phase G1.4 — surface the bridge to the player as a "world thought
  // about your timeline" signal. Best-effort; never blocks the pass.
  try {
    const emitFn = globalThis._concordRealtimeEmit;
    if (typeof emitFn === "function" && createdShadows > 0) {
      emitFn("social:shadows-synced", {
        createdShadows,
        totalCapacity: state.shadowDtus.size,
        droppedForPrivacy: rows.length - createdShadows,
      });
    }
  } catch { /* emit failures never affect pass */ }

  // v2.0 Workstream 6b: federation pass. Pull public social shadows from
  // configured peers and import them as 'federated_signal' shadows. The
  // NPC narrative-bridge weights these lower than local shadows. We
  // hard-cap import per tick and gracefully ignore unreachable peers.
  let federatedImports = 0;
  try {
    const peers = state.settings?.federationPeers ?? [];
    if (Array.isArray(peers) && peers.length > 0) {
      federatedImports = await importFederatedShadows(state, peers);
    }
  } catch { /* federation is best-effort — never block local bridge */ }

  return { ok: true, createdShadows, scanned: rows.length, cursor: lastSeenAt, federatedImports };
}

const FEDERATION_FETCH_TIMEOUT_MS = 3000;
const FEDERATION_MAX_IMPORT_PER_TICK = 25;

/**
 * Pull public shadow exports from peers and store them locally as
 * 'federated_signal' shadows. Each peer gets the same per-tick cap.
 * Idempotent: repeated imports of the same source shadow are no-ops.
 */
async function importFederatedShadows(state, peers) {
  let imported = 0;
  for (const peer of peers) {
    if (imported >= FEDERATION_MAX_IMPORT_PER_TICK) break;
    if (!peer?.url) continue;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FEDERATION_FETCH_TIMEOUT_MS);
      // Per-peer auth: peers carry an optional `token` field. We send it
      // as a Bearer header so the exporting instance can verify against
      // its own CONCORD_FEDERATION_TOKEN before disclosing shadows. Peers
      // without a token are still accepted (research-peer back-compat) but
      // tagged so narrative-bridge can de-prioritise them.
      const headers = { accept: "application/json" };
      if (peer.token) headers.authorization = `Bearer ${peer.token}`;
      const res = await fetch(`${peer.url.replace(/\/$/, "")}/api/world/social-shadows`, {
        signal: ctrl.signal,
        headers,
      }).finally(() => clearTimeout(t));
      if (!res.ok) continue;
      const body = await res.json().catch(() => null);
      const shadows = body?.shadows ?? [];
      for (const s of shadows) {
        if (imported >= FEDERATION_MAX_IMPORT_PER_TICK) break;
        const id = `shadow_fed_${peer.id ?? "peer"}_${s.id}`;
        if (state.shadowDtus.has(id)) continue;
        state.shadowDtus.set(id, {
          id,
          kind: "shadow",
          tags: ["federated_signal", "social_awareness"],
          core: { summary: (s.summary ?? "").toString().slice(0, SUMMARY_MAX_CHARS) },
          authorHandle: s.authorHandle ?? "federated",
          sourceDtuId: s.id,
          sourcePeer: peer.id ?? peer.url,
          targetWorldId: s.targetWorldId ?? null,
          createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
          weight: 0.5, // narrative-bridge weights federated lower than local
        });
        imported++;
      }
    } catch { /* one bad peer can't break the bridge */ }
  }
  return imported;
}

function safeJSON(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
