// server/lib/lattice-fork.js
//
// P-C — the lattice-fork object.
//
// A fork object is a BOUNDED clone of a specific set of DTUs + a snapshot of the
// source's temperament, exposed through THREE operations:
//
//   1. createForkObject       — bounded clone + agent-disclosure-compliant identity
//   2. instantiateForkSandbox — a confined in-process sandbox that can ONLY read
//                               the fork's DTUs and CANNOT write to any
//                               USER_GLOBAL_WRITE_TABLES table
//   3. mergeBackDryRun        — compute what a merge-back WOULD do (conflicts,
//                               applied fields) WITHOUT persisting anything
//
// Confinement mechanism: lib/confined-ctx.js (the object-capability sandbox). The
// fork sandbox grants ZERO host macros (default-deny) and is handed NO raw db, so
// a write to dtus/economy_ledger/users/... is not merely forbidden — it is
// unrepresentable. DTU reads are served through a bounded read-only accessor that
// only ever SELECTs the fork's own dtuIds.
//
// This unit does NOT use world-sharding: it is orthogonal to
// lib/world-shard-protocol.js and never changes any table's write-ownership.
// Out of scope (gated behind the P-D governance doc): rental pricing, marketplace
// listing, real (non-dry-run) merge execution, any economy hookup.

import crypto from "node:crypto";
import { makeConfinedCtx, assertConfined } from "./confined-ctx.js";
import { fieldLevelMerge } from "../emergent/merge.js";

// Bounded-clone cap. 500 mirrors the codebase's "bound a mirror" convention
// (cf. CONCORD_MAX_SHADOWS). A fork is a curated, hand-picked slice — not a corpus
// mirror — so the cap is a hard REJECT (silent truncation would hide data loss).
export const MAX_FORK_DTUS = Number(process.env.CONCORD_MAX_FORK_DTUS) || 500;

// ── small DB guards (mirrors the migration column-guard idiom) ────────────────

function tableExists(db, table) {
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
  } catch {
    return false;
  }
}

function columnsOf(db, table) {
  try {
    return db.pragma(`table_info(${table})`).map((c) => c.name);
  } catch {
    return [];
  }
}

// ── temperament snapshot ──────────────────────────────────────────────────────

/**
 * Snapshot whatever temperament/personality the codebase already models for the
 * source. Canonical home is the agent self-model (mig 325 agent_identities:
 * core_values_json = the anchor, drive_profile_json = the 7-drive Panksepp seed;
 * mig 330 value_drift). Falls back to a caller override, else an honest empty
 * shape — never fabricates a personality.
 *
 * @returns {{capturedFrom:string, coreValues:any[], driveProfile:object,
 *            valueDrift:(number|null), sourceAgentId?:string, capturedAt:number}}
 */
export function captureTemperamentSnapshot(db, sourceUserId, override) {
  if (db && sourceUserId && tableExists(db, "agent_identities")) {
    let row = null;
    try {
      row = db
        .prepare(
          "SELECT * FROM agent_identities WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(sourceUserId);
    } catch {
      row = null;
    }
    if (row) {
      let coreValues = [];
      let driveProfile = {};
      try { coreValues = JSON.parse(row.core_values_json || "[]"); } catch { coreValues = []; }
      try { driveProfile = JSON.parse(row.drive_profile_json || "{}"); } catch { driveProfile = {}; }
      return {
        capturedFrom: "agent_identity",
        sourceAgentId: row.agent_id,
        coreValues,
        driveProfile,
        valueDrift: typeof row.value_drift === "number" ? row.value_drift : null,
        capturedAt: Date.now(),
      };
    }
  }
  if (override && typeof override === "object") {
    return {
      capturedFrom: "override",
      coreValues: Array.isArray(override.coreValues) ? override.coreValues : [],
      driveProfile:
        override.driveProfile && typeof override.driveProfile === "object"
          ? override.driveProfile
          : {},
      valueDrift: typeof override.valueDrift === "number" ? override.valueDrift : null,
      capturedAt: Date.now(),
    };
  }
  return { capturedFrom: "none", coreValues: [], driveProfile: {}, valueDrift: null, capturedAt: Date.now() };
}

// ── agent disclosure ──────────────────────────────────────────────────────────

/**
 * Establish the agent-disclosure record for a fork: a reenacted/forked "you" MUST
 * disclose it is an agent. We create (a) a locked, clearly-marked agent account
 * flagged users.is_agent=1 (mig 324) and (b) the canonical agent self-model row in
 * agent_identities (mig 325) linked to it. Both writes are guarded so this works
 * against minimal test schemas and the full production users table.
 *
 * @returns {{agentIdentityId:(string|null), agentUserId:string}}
 */
function ensureForkAgentDisclosure(db, { forkId, sourceUserId, snapshot }) {
  const agentUserId = `agent_${forkId}`;
  const now = new Date().toISOString();

  // (a) the disclosed, non-login agent account.
  if (tableExists(db, "users")) {
    const cols = columnsOf(db, "users");
    const base = {
      id: agentUserId,
      username: `fork-agent-${forkId}`,
      email: `${agentUserId}@agent.concord.invalid`,
      password_hash: "!", // sentinel: no password can hash to "!" → login is impossible
      role: "agent",
      created_at: now,
    };
    if (cols.includes("is_agent")) base.is_agent = 1;
    if (cols.includes("agent_kind")) base.agent_kind = "fork-clone";
    if (cols.includes("agent_created_at")) base.agent_created_at = now;
    if (cols.includes("is_active")) base.is_active = 1;
    if (cols.includes("scopes")) base.scopes = JSON.stringify(["read"]);
    const use = Object.keys(base).filter((k) => cols.includes(k));
    try {
      db.prepare(
        `INSERT OR IGNORE INTO users (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`,
      ).run(...use.map((k) => base[k]));
    } catch {
      /* users schema mismatch — the agent_identities record below still discloses it */
    }
  }

  // (b) the canonical agent self-model (mig 325) — the disclosure record proper.
  let agentIdentityId = null;
  if (tableExists(db, "agent_identities")) {
    agentIdentityId = `aid_${forkId}`;
    try {
      db.prepare(
        `INSERT OR IGNORE INTO agent_identities
           (agent_id, user_id, given_name, naming_origin, core_values_json, drive_profile_json, status)
         VALUES (?, ?, ?, 'inherited', ?, ?, 'active')`,
      ).run(
        agentIdentityId,
        agentUserId,
        `Fork of ${sourceUserId}`,
        JSON.stringify(snapshot.coreValues || []),
        JSON.stringify(snapshot.driveProfile || {}),
      );
    } catch {
      agentIdentityId = null;
    }
  }

  return { agentIdentityId, agentUserId };
}

// ── create ────────────────────────────────────────────────────────────────────

/**
 * Create a bounded fork object + its agent-disclosure identity.
 *
 * @param {object} db  — better-sqlite3 handle (host-side; NOT the confined sandbox).
 * @param {object} o
 * @param {string} o.ownerUserId   — the human who forks.
 * @param {string} [o.sourceUserId]— whose corpus is cloned (defaults to owner = self-fork).
 * @param {string[]} o.dtuIds      — the bounded DTU id set (deduped; capped at MAX_FORK_DTUS).
 * @param {object} [o.temperament] — optional override snapshot (used only when the
 *                                    source has no agent_identity).
 * @throws if dtuIds is empty or exceeds the bounded cap (err.code === 'fork_bound_exceeded').
 */
export function createForkObject(db, { ownerUserId, sourceUserId, dtuIds, temperament } = {}) {
  if (!db) throw new Error("createForkObject: db required");
  if (!ownerUserId) throw new Error("createForkObject: ownerUserId required");
  const src = sourceUserId || ownerUserId;

  const ids = Array.isArray(dtuIds)
    ? [...new Set(dtuIds.map((x) => String(x)).filter(Boolean))]
    : [];
  if (ids.length === 0) {
    throw new Error("createForkObject: dtuIds must be a non-empty bounded set");
  }
  if (ids.length > MAX_FORK_DTUS) {
    const e = new Error(
      `createForkObject: dtuIds exceeds bounded cap ${MAX_FORK_DTUS} (got ${ids.length})`,
    );
    e.code = "fork_bound_exceeded";
    throw e;
  }

  const snapshot = captureTemperamentSnapshot(db, src, temperament);
  const forkId = `fork_${crypto.randomBytes(9).toString("hex")}`;
  const { agentIdentityId, agentUserId } = ensureForkAgentDisclosure(db, {
    forkId,
    sourceUserId: src,
    snapshot,
  });

  db.prepare(
    `INSERT INTO fork_objects
       (id, owner_user_id, source_user_id, dtu_ids_json, dtu_count,
        temperament_snapshot_json, agent_identity_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', unixepoch())`,
  ).run(
    forkId,
    ownerUserId,
    src,
    JSON.stringify(ids),
    ids.length,
    JSON.stringify(snapshot),
    agentIdentityId,
  );

  return {
    ok: true,
    id: forkId,
    ownerUserId,
    sourceUserId: src,
    dtuIds: ids,
    dtuCount: ids.length,
    temperament: snapshot,
    agentIdentityId,
    agentUserId,
    status: "draft",
  };
}

// ── load ──────────────────────────────────────────────────────────────────────

export function loadForkObject(db, forkObjectId) {
  let row = null;
  try {
    row = db.prepare("SELECT * FROM fork_objects WHERE id = ?").get(String(forkObjectId));
  } catch {
    row = null;
  }
  if (!row) return null;
  let dtuIds = [];
  let temperament = {};
  try { dtuIds = JSON.parse(row.dtu_ids_json || "[]"); } catch { dtuIds = []; }
  try { temperament = JSON.parse(row.temperament_snapshot_json || "{}"); } catch { temperament = {}; }
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    sourceUserId: row.source_user_id,
    dtuIds,
    dtuCount: row.dtu_count,
    temperament,
    agentIdentityId: row.agent_identity_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

// ── instantiate (confined sandbox) ─────────────────────────────────────────────

/**
 * Instantiate a fork in a confined in-process sandbox.
 *
 * Confinement is by construction (lib/confined-ctx.js):
 *   • the ctx exposes NO raw db and NO mint (assertConfined pins this),
 *   • the capability manifest grants ZERO host macros → every macro is
 *     capability_denied, so there is no write path to any USER_GLOBAL_WRITE_TABLES
 *     table (dtus, economy_ledger, users, …),
 *   • DTU reads are served ONLY through `readDtu`, a bounded SELECT-only accessor
 *     that refuses any id outside the fork's clone set.
 *
 * @returns {{ok:boolean, ctx?:object, readDtu?:Function, listDtuIds?:Function,
 *            dtuIds?:string[], agentUserId?:string, confined?:object, error?:string}}
 */
export function instantiateForkSandbox(forkObjectId, db) {
  const fork = loadForkObject(db, forkObjectId);
  if (!fork) return { ok: false, error: "fork_not_found" };

  const dtuIdSet = new Set(fork.dtuIds.map((x) => String(x)));

  // Resolve the disclosed agent identity the sandbox acts as.
  let agentUserId = `agent_${fork.id}`;
  if (fork.agentIdentityId && tableExists(db, "agent_identities")) {
    try {
      const r = db
        .prepare("SELECT user_id FROM agent_identities WHERE agent_id = ?")
        .get(fork.agentIdentityId);
      if (r?.user_id) agentUserId = r.user_id;
    } catch {
      /* keep the deterministic fallback id */
    }
  }

  // Bounded, read-only DTU accessor: ONLY the fork's dtuIds, SELECT-only. `db` is
  // captured in this closure but never exposed on the returned surface, and this is
  // the ONLY thing that touches the shared DB — and it can only ever read.
  const readDtu = (dtuId) => {
    const id = String(dtuId);
    if (!dtuIdSet.has(id)) {
      return { ok: false, error: "out_of_bounds", reason: "DTU not in fork clone set" };
    }
    try {
      const row = db.prepare("SELECT * FROM dtus WHERE id = ?").get(id);
      return row ? { ok: true, dtu: row } : { ok: false, error: "not_found" };
    } catch {
      return { ok: false, error: "read_failed" };
    }
  };

  // The capability-confined context. Default-deny manifest (no grants) + no db.
  const ctx = makeConfinedCtx({
    userId: agentUserId,
    runMacro: async () => ({
      ok: false,
      error: "capability_denied",
      reason: "fork sandbox grants no host macros",
    }),
    manifest: { macros: [] },
    // deliberately NO db → the scoped KV is inert; no persistence escape hatch.
  });

  return {
    ok: true,
    forkObjectId: fork.id,
    agentUserId,
    ctx,
    readDtu,
    listDtuIds: () => [...dtuIdSet],
    dtuIds: [...dtuIdSet],
    confined: assertConfined(ctx),
  };
}

// ── merge-back dry-run ──────────────────────────────────────────────────────────

// Hydrate a persisted DTU row into the in-memory shape emergent/merge.js expects.
// Always returns a COPY, so any in-place mutation the merge performs is discarded.
function hydrateDtuForMerge(row) {
  let tags = [];
  let body = {};
  try { tags = JSON.parse(row.tags_json || "[]"); } catch { tags = []; }
  try { body = JSON.parse(row.body_json || "{}"); } catch { body = {}; }
  return {
    id: row.id,
    ownerId: row.owner_user_id,
    title: row.title,
    content: typeof body.content === "string" ? body.content : "",
    summary: typeof body.summary === "string" ? body.summary : "",
    tags: Array.isArray(tags) ? [...tags] : [],
    tier: row.tier,
    meta: {},
    timestamp: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Compute what merging the sandbox's hypothetical edits back onto the source DTUs
 * WOULD do — conflicts + applied fields — WITHOUT writing anything. Pure dry-run:
 * fieldLevelMerge mutates STATE.dtus in place, so we run it against an EPHEMERAL
 * STATE holding a throwaway copy of each DTU; the persisted rows are never touched.
 *
 * Real (non-dry-run) merge execution + its economy/ownership implications are OUT
 * OF SCOPE for this unit (gated behind the P-D governance doc).
 *
 * @param {string} forkObjectId
 * @param {object|Array} edits — `{ [dtuId]: { field: value } }` or
 *                               `[{ dtuId, fields }]`.
 * @param {object} db
 * @returns {{ok:boolean, dryRun:true, forkObjectId:string, reports:object[]}}
 */
export function mergeBackDryRun(forkObjectId, edits, db) {
  const fork = loadForkObject(db, forkObjectId);
  if (!fork) return { ok: false, error: "fork_not_found" };

  const dtuIdSet = new Set(fork.dtuIds.map((x) => String(x)));

  // Normalize both accepted edit shapes into [ [dtuId, fields] ].
  const perDtu = [];
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (e && e.dtuId) perDtu.push([String(e.dtuId), e.fields && typeof e.fields === "object" ? e.fields : {}]);
    }
  } else if (edits && typeof edits === "object") {
    for (const [k, v] of Object.entries(edits)) {
      perDtu.push([String(k), v && typeof v === "object" ? v : {}]);
    }
  }

  // Batch the DTU lookup into ONE query instead of one SELECT per edit (was a
  // real N+1 — flagged by the perf detector: server/lib/lattice-fork.js:403).
  // Only in-bounds ids are worth fetching at all, so filter first, then fetch
  // the whole in-bounds set in a single `WHERE id IN (...)` round-trip.
  const inBoundsIds = [...new Set(perDtu.filter(([dtuId]) => dtuIdSet.has(dtuId)).map(([dtuId]) => dtuId))];
  const rowById = new Map();
  if (inBoundsIds.length > 0) {
    try {
      const placeholders = inBoundsIds.map(() => "?").join(",");
      const rows = db.prepare(`SELECT * FROM dtus WHERE id IN (${placeholders})`).all(...inBoundsIds);
      for (const row of rows) rowById.set(String(row.id), row);
    } catch {
      // Leave rowById empty on a query failure — every id then honestly
      // reports dtu_not_found below, matching the prior per-row try/catch.
    }
  }

  const reports = [];
  for (const [dtuId, fields] of perDtu) {
    if (!dtuIdSet.has(dtuId)) {
      reports.push({
        dtuId,
        ok: false,
        error: "out_of_bounds",
        reason: "edit targets a DTU outside the fork clone set",
      });
      continue;
    }
    const row = rowById.get(dtuId);
    if (!row) {
      reports.push({ dtuId, ok: false, error: "dtu_not_found" });
      continue;
    }

    const ephemeralState = { dtus: new Map([[dtuId, hydrateDtuForMerge(row)]]) };
    const result = fieldLevelMerge(ephemeralState, dtuId, fields, `fork:${fork.id}`);

    reports.push({
      dtuId,
      ok: result.ok !== false,
      applied: result.applied || [],
      conflicts: result.conflicts || [],
      preview: result.merged
        ? { title: result.merged.title, tags: result.merged.tags, summary: result.merged.summary }
        : null,
    });
  }

  return { ok: true, dryRun: true, forkObjectId: fork.id, reports };
}
