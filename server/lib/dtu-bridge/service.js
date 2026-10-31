// server/lib/dtu-bridge/service.js
//
// DTU bridge — wiring slice: the bridge service the server runs.
//
// Slices 0–5 shipped the bridge as a library with no caller: DTU
// writes never reached the outbox, and the outbox never drained.
// This service is the caller. It composes the existing pieces —
// outbox (slice 2), apply engine + pump (slice 4) — behind three
// operations the server drives from a heartbeat:
//
//   sweep(dtus) — capture: for each live DTU, project its content
//     layer, hash it, and — if that hash is not already the chain
//     head this service knows — pack it as a new version (parentHash
//     = the previous head) and enqueue it. A sweep is idempotent: an
//     unchanged DTU enqueues nothing, so the sweep can run on a
//     cadence over the whole corpus and only real changes move.
//     Capturing by sweep (not by hooking every write path) means
//     every writer is covered, including the ones nobody enumerated.
//   drain() — deliver: drainOutboxToTarget applies due outbox rows
//     through the conflict rule into the target, with the outbox's
//     honest statuses (delivered / abandoned-with-reason / failed
//     with backoff — never a false delivered).
//   stats() — the bridge's own counts, for status surfaces.
//
// Scope, honestly: this wires the canonical `dtus` table — the
// substrate class's centre. Satellite tables (integrity, rights,
// citations, …) cross by the same service shape in later slices;
// nothing here claims they move yet. On a SQLite host the target is
// the local replica (sqlite-target.js); the Postgres target of
// slice 6 implements the same getChain/putRecord interface and
// swaps in behind this service unchanged.
//
// PAYLOAD RULE (the wiring forward note, B5 on #1764): packs carry
// CONTENT-LAYER payloads, never whole live records. The projection
// below is the DTU's substantive layer — id, title, tier, tags, the
// human/core/machine layers, the legacy content body, source — and
// excludes relations, lineage, meta, authority and timestamps by
// construction. Relation writes therefore can never move a version's
// content hash, exactly as the envelope's recipe assumes. The legacy
// body rides as `body`, not a top-level `content` key, so the
// bridge's hash covers the whole projection: any substantive change
// versions, bookkeeping changes do not.

import { createOutbox, createMemoryStore, createSqliteStore } from "./outbox.js";
import { createMemoryTarget, drainOutboxToTarget } from "./apply.js";
import { createSqliteTarget } from "./sqlite-target.js";
import { buildPack } from "./pack-envelope.js";
import { computeContentHash, makeProvenance } from "./provenance.js";

export const DTU_BRIDGE_TABLE = "dtus";

/** Project a live DTU object to its bridge content-layer payload. */
export function dtuContentPayload(dtu) {
  return {
    id: String(dtu.id),
    title: dtu.title ?? null,
    tier: dtu.tier ?? null,
    tags: Array.isArray(dtu.tags) ? [...dtu.tags] : [],
    human: dtu.human ?? dtu.humanLayer ?? null,
    core: dtu.core ?? dtu.coreLayer ?? null,
    machine: dtu.machine ?? null,
    body: dtu.content ?? null,
    source: dtu.source ?? null,
  };
}

// The id → head-hash memo is a pure cache (headFor re-reads the target's
// chain head on a miss), so it is capped: without a cap it gained one entry
// per distinct DTU id the sweep ever touched, for the life of the process.
export const HEAD_CACHE_MAX_DEFAULT = 50000;

export function createDtuBridgeService({ store, target, sourceNode = "concord-sqlite", headCacheMax } = {}) {
  if (!store) throw new TypeError("createDtuBridgeService: a store is required");
  if (!target) throw new TypeError("createDtuBridgeService: a target is required");
  const outbox = createOutbox(store);
  // id → content hash of the newest version this service has enqueued
  // (seeded lazily from the target's applied chain head). Lets a sweep
  // recognise an unchanged DTU without re-packing it.
  const headHashById = new Map();
  const envMax = Number(process.env.DTU_BRIDGE_HEAD_CACHE_MAX);
  const headMax = Math.max(
    1,
    Number.isFinite(headCacheMax) ? headCacheMax : Number.isFinite(envMax) && envMax > 0 ? envMax : HEAD_CACHE_MAX_DEFAULT,
  );

  function rememberHead(id, head) {
    // Re-insert so the Map's insertion order is recency order, then evict the
    // oldest entries past the cap.
    headHashById.delete(id);
    headHashById.set(id, head);
    while (headHashById.size > headMax) headHashById.delete(headHashById.keys().next().value);
  }

  function headFor(id) {
    if (headHashById.has(id)) return headHashById.get(id);
    const chain = target.getChain(DTU_BRIDGE_TABLE, id);
    const head = chain.length > 0 ? chain[chain.length - 1].provenance.contentHash : null;
    rememberHead(id, head);
    return head;
  }

  /** Enqueue one DTU if its content layer changed since the known head. */
  function enqueueDtu(dtu) {
    if (!dtu || typeof dtu.id !== "string" || dtu.id.length === 0) {
      return { enqueued: 0, deduped: 0, skipped: 1 };
    }
    const payload = dtuContentPayload(dtu);
    const hash = computeContentHash(payload);
    const parent = headFor(dtu.id);
    if (parent === hash) return { enqueued: 0, deduped: 1, skipped: 0 };
    const record = {
      table: DTU_BRIDGE_TABLE,
      id: dtu.id,
      payload,
      provenance: makeProvenance(payload, parent),
    };
    const res = outbox.enqueuePack(buildPack({ sourceNode, records: [record] }));
    if (res.ok && res.enqueued > 0) rememberHead(dtu.id, hash);
    return { enqueued: res.enqueued || 0, deduped: res.deduped || 0, skipped: 0 };
  }

  // Rotating sweep position. A sweep scans at most `limit` DTUs, so without
  // this the same head of the list is rescanned every tick and DTUs past
  // `limit` are never captured. Each sweep resumes where the last one ended
  // and wraps, so every live DTU is visited once per ceil(n / limit) sweeps.
  let sweepCursor = 0;

  /** Capture pass over live DTUs: `limit` items from the rotating cursor. */
  function sweep(dtus, { limit = 200 } = {}) {
    const list = Array.isArray(dtus) ? dtus : Array.from(dtus || []);
    const n = list.length;
    const counts = { scanned: 0, enqueued: 0, deduped: 0, skipped: 0, cursor: 0 };
    if (n === 0) {
      sweepCursor = 0;
      return counts;
    }
    const start = sweepCursor >= n ? 0 : sweepCursor;
    const budget = Math.min(n, Math.max(0, limit));
    for (let k = 0; k < budget; k++) {
      counts.scanned++;
      const r = enqueueDtu(list[(start + k) % n]);
      counts.enqueued += r.enqueued;
      counts.deduped += r.deduped;
      counts.skipped += r.skipped;
    }
    sweepCursor = (start + counts.scanned) % n;
    counts.cursor = sweepCursor;
    return counts;
  }

  /** Deliver pass: apply due outbox rows to the target. */
  function drain(limit = 50) {
    return drainOutboxToTarget(outbox, target, { limit });
  }

  function stats() {
    return {
      cursor: sweepCursor,
      headCache: headHashById.size,
      outbox: outbox.stats(),
      chains:
        typeof target.countChains === "function"
          ? target.countChains()
          : target.allChains
            ? target.allChains().size
            : null,
    };
  }

  return { outbox, target, enqueueDtu, sweep, drain, stats };
}

/** Production composition: SQLite outbox + SQLite replica target. */
export function createSqliteBridgeService({ db, sourceNode = "concord-sqlite" } = {}) {
  if (!db) throw new TypeError("createSqliteBridgeService: a db handle is required");
  return createDtuBridgeService({
    store: createSqliteStore(db),
    target: createSqliteTarget(db),
    sourceNode,
  });
}

/** Test / dry-run composition: memory store + memory target. */
export function createMemoryBridgeService({ sourceNode = "concord-memory" } = {}) {
  return createDtuBridgeService({
    store: createMemoryStore(),
    target: createMemoryTarget(),
    sourceNode,
  });
}
