// server/lib/dtu-bridge/apply.js
//
// DTU bridge — Slice 4: the apply engine.
//
// This is where packs land. It acts on the Slice 3 conflict rule and
// on nothing else: a record is written only when the rule returns
// "accept", and only the part of the incoming chain the target does
// not already hold. Every DTU in a pack gets a receipt saying exactly
// what happened — applied (and how many versions), duplicate, rejected
// or refused, with the rule's reason. A pack that fails envelope
// verification is refused whole, before any record is considered.
//
// Targets sit behind a small interface — getChain(table, id) returning
// the held versions root → head, and putRecord(record) appending one
// version — so the same engine applies to a SQLite store today and to
// the Postgres side when it exists. createMemoryTarget is the test /
// dry-run implementation.
//
// drainOutboxToTarget is the pump: it claims due outbox rows and
// applies them one record at a time. Outcomes map onto the outbox's
// honest statuses — applied or already-present → delivered; a change
// that can never apply (invalid chain, incomparable fork) →
// abandoned with the rule's reason, never retried and never marked
// delivered; a transient target error → failed (backoff, retry).

import { parsePack } from "./pack-envelope.js";
import { decideOverwrite } from "./conflict-rule.js";

export function createMemoryTarget() {
  const chains = new Map();
  const k = (table, id) => `${table}:${id}`;
  return {
    getChain: (table, id) => [...(chains.get(k(table, id)) || [])],
    putRecord: (rec) => {
      const key = k(rec.table, rec.id);
      const chain = chains.get(key) || [];
      chain.push(rec);
      chains.set(key, chain);
    },
    allChains: () => chains,
  };
}

function groupByDtu(records) {
  const groups = new Map();
  for (const rec of records) {
    const key = `${rec.table}:${rec.id}`;
    if (!groups.has(key)) groups.set(key, { table: rec.table, id: rec.id, records: [] });
    groups.get(key).records.push(rec);
  }
  return [...groups.values()];
}

/** Append only the versions of `incoming` the held chain lacks. */
function appendNewVersions(target, existing, incoming) {
  let start = 0;
  if (existing.length > 0) {
    const exHead = existing[existing.length - 1].provenance.contentHash;
    const idx = incoming.findIndex((r) => r.provenance.contentHash === exHead);
    if (idx >= 0) start = idx + 1;
    // Otherwise the incoming root anchors onto the held head
    // (parentHash === exHead) and every incoming record is new.
  }
  let applied = 0;
  for (let i = start; i < incoming.length; i++) {
    target.putRecord(incoming[i]);
    applied++;
  }
  return applied;
}

export function applyPack(target, packInput, { key = null } = {}) {
  const parsed = parsePack(packInput);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, receipts: [] };
  const receipts = [];
  for (const group of groupByDtu(parsed.pack.records)) {
    const existing = target.getChain(group.table, group.id);
    const verdict = decideOverwrite({ existing, incoming: group.records, key });
    let applied = 0;
    if (verdict.decision === "accept") {
      applied = appendNewVersions(target, existing, group.records);
    }
    receipts.push({
      table: group.table,
      id: group.id,
      decision: verdict.decision,
      reason: verdict.reason,
      applied,
    });
  }
  return { ok: true, receipts };
}

export function drainOutboxToTarget(outbox, target, { limit = 25, key = null } = {}) {
  const rows = outbox.claim(limit);
  const summary = { claimed: rows.length, applied: 0, duplicates: 0, abandoned: 0, failed: 0 };
  for (const row of rows) {
    let packJson;
    try {
      packJson = JSON.parse(row.packJson);
    } catch {
      outbox.abandon(row.key, "stored_pack_unparseable");
      summary.abandoned++;
      continue;
    }
    const rec = packJson.records?.[0];
    if (!rec) {
      outbox.abandon(row.key, "stored_pack_empty");
      summary.abandoned++;
      continue;
    }
    try {
      const existing = target.getChain(rec.table, rec.id);
      const verdict = decideOverwrite({ existing, incoming: [rec], key });
      if (verdict.decision === "accept") {
        appendNewVersions(target, existing, [rec]);
        outbox.ack(row.key);
        summary.applied++;
      } else if (verdict.decision === "duplicate" || verdict.reason === "stale") {
        // The target already holds this version (or a newer one):
        // the change has, in effect, arrived. Delivered — not a retry.
        outbox.ack(row.key);
        summary.duplicates++;
      } else {
        outbox.abandon(row.key, `${verdict.decision}:${verdict.reason}`);
        summary.abandoned++;
      }
    } catch (e) {
      outbox.fail(row.key, e.message || String(e));
      summary.failed++;
    }
  }
  return summary;
}
