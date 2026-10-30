// server/lib/dtu-bridge/verify.js
//
// DTU bridge — Slice 5: the credential-free end-to-end proof.
//
// "Bridge is live" has an observable meaning (bridge plan §3): a DTU
// created on one side appears on the other with its chain verified,
// and a DTU whose chain does not verify does not appear at all. This
// module runs the whole bridge — pack (Slice 1) → outbox (Slice 2) →
// conflict rule (Slice 3) → apply (Slice 4) — between two in-memory
// stores and reports exactly what happened, per DTU: what synced,
// what was refused and why, and whether every chain the target holds
// still verifies afterwards. No database, no network, no credential:
// it is the done-state check for slices 0–4 and the rehearsal for the
// hosted side (Slice 6, which is founder-gated and not built here).

import { buildPack } from "./pack-envelope.js";
import { createMemoryStore, createOutbox } from "./outbox.js";
import { applyPack, createMemoryTarget, drainOutboxToTarget } from "./apply.js";
import { verifyChain } from "./provenance.js";

/** Verify every chain a memory target holds. */
export function verifyTargetIntegrity(target, { key = null } = {}) {
  const results = [];
  for (const [k, chain] of target.allChains()) {
    const [table, id] = k.split(":");
    const res = verifyChain(chain, { key });
    results.push({ table, id, valid: res.valid, failures: res.failures });
  }
  return results;
}

/**
 * Run the full bridge between two sets of chains.
 *   sourceChains: arrays of records (one DTU's chain each) to send.
 *   targetChains: arrays of records the target already holds.
 * Returns a report; `ok` means the bridge behaved correctly (every
 * target chain still verifies, and every DTU that did not sync has an
 * explicit refusal on record) — it does NOT mean everything synced.
 */
export function runBridgeDryRun({ sourceChains = [], targetChains = [], key = null } = {}) {
  const target = createMemoryTarget();
  for (const chain of targetChains) {
    applyPack(target, buildPack({ sourceNode: "dry-run-seed", records: chain }), { key });
  }

  const store = createMemoryStore();
  const outbox = createOutbox(store, { now: () => Date.now() });
  let packed = 0;
  let enqueued = 0;
  let deduped = 0;
  for (const chain of sourceChains) {
    const pack = buildPack({ sourceNode: "dry-run-source", records: chain });
    packed++;
    const res = outbox.enqueuePack(pack);
    enqueued += res.enqueued;
    deduped += res.deduped;
  }
  const drain = drainOutboxToTarget(outbox, target, { limit: 10000, key });

  const refusals = store
    .all()
    .filter((r) => r.status === "abandoned")
    .map((r) => ({ table: r.table, id: r.dtuId, contentHash: r.contentHash, reason: r.lastError }));

  const integrity = verifyTargetIntegrity(target, { key });
  const perDtu = sourceChains.map((chain) => {
    const { table, id } = chain[0];
    const sourceHead = chain[chain.length - 1].provenance.contentHash;
    const held = target.getChain(table, id);
    const targetHead = held.length ? held[held.length - 1].provenance.contentHash : null;
    const sourceHashes = chain.map((r) => r.provenance.contentHash);
    const targetHashes = held.map((r) => r.provenance.contentHash);
    const sameSequence =
      sourceHashes.length === targetHashes.length && sourceHashes.every((h, i) => h === targetHashes[i]);
    return {
      table,
      id,
      sourceHead,
      targetHead,
      // In sync means the same chain, not just the same head: a source
      // chain spliced in the middle can share a head hash with the
      // target's genuine chain while the two histories disagree, and
      // the report must show that rather than call it synced.
      inSync: sourceHead === targetHead && sameSequence,
      headConverged: sourceHead === targetHead && !sameSequence,
    };
  });

  const unsyncedExplained = perDtu.every(
    (d) => d.inSync || refusals.some((r) => r.table === d.table && r.id === d.id)
  );
  const ok = integrity.every((r) => r.valid) && unsyncedExplained && drain.failed === 0;

  return {
    ok,
    counts: { packed, enqueued, deduped, ...drain },
    perDtu,
    refusals,
    targetIntegrity: integrity,
  };
}
