// domains/notary.js — Notary lens-action domain.
//
// Powers the de-demo'd NotarizationPanel with REAL data. The panel previously
// FAKED an on-chain transaction hash via setTimeout. This domain computes a
// genuine SHA-256 of the supplied content and builds an HONEST, append-only
// LOCAL hash-chain (each record links to the user's previous record via
// prevHash). It is NOT a blockchain and emits NO fabricated transaction hash —
// the proof surfaced is the real content hash + the local chain linkage.
//
// Per-user scope (ctx.actor.userId), STATE-backed (STATE.notaryRecords:
// Map<userId, Array<record>>). No DB migrations.
import { createHash } from "node:crypto";

export default function registerNotaryActions(registerLensAction) {
  function notaryStore() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    STATE.notaryRecords ??= new Map(); // userId -> Array<record>
    return STATE.notaryRecords;
  }
  const notaryActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const notaryList = (m, userId) => {
    if (!m.has(userId)) m.set(userId, []);
    return m.get(userId);
  };
  // Read the request payload: the harness passes `params`; the HTTP /api/lens/run
  // path mirrors `input` onto BOTH artifact.data and params — prefer params, then
  // artifact.data so both paths work.
  const payload = (artifact, params) => ({
    ...(artifact?.data && typeof artifact.data === "object" ? artifact.data : {}),
    ...(params && typeof params === "object" ? params : {}),
  });
  const sha256 = (str) => createHash("sha256").update(String(str), "utf8").digest("hex");
  const notaryId = () => `ntr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // notarize — REAL sha256(content) + honest local hash-chain. No on-chain tx.
  registerLensAction("notary", "notarize", (ctx, artifact, params) => {
    try {
      const p = payload(artifact, params);
      const content = p.content;
      if (typeof content !== "string" || content.length === 0) {
        return { ok: false, error: "content required" };
      }
      const store = notaryStore();
      const userId = notaryActor(ctx);
      const list = notaryList(store, userId);
      const prev = list.length ? list[list.length - 1] : null;
      const record = {
        id: notaryId(),
        contentHash: sha256(content),
        prevHash: prev ? prev.contentHash : null, // hash-chain to the user's last record
        notarizedAt: new Date().toISOString(),
        title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : "Untitled",
      };
      list.push(record);
      return { ok: true, result: { record } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // verify — recompute sha256(content), compare to stored contentHash. Tamper
  // detection: a changed content yields a different actualHash → valid:false.
  registerLensAction("notary", "verify", (ctx, artifact, params) => {
    try {
      const p = payload(artifact, params);
      const recordId = p.recordId;
      const content = p.content;
      if (!recordId) return { ok: false, error: "recordId required" };
      if (typeof content !== "string") return { ok: false, error: "content required" };
      const store = notaryStore();
      const userId = notaryActor(ctx);
      const record = notaryList(store, userId).find((r) => r.id === recordId);
      if (!record) return { ok: false, error: "record not found" };
      const expectedHash = record.contentHash;
      const actualHash = sha256(content);
      return {
        ok: true,
        result: { valid: actualHash === expectedHash, expectedHash, actualHash, recordId },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // records-list — per-user, newest-first.
  registerLensAction("notary", "records-list", (ctx, artifact, _params) => {
    try {
      const store = notaryStore();
      const userId = notaryActor(ctx);
      const records = notaryList(store, userId).slice().reverse(); // newest-first
      return { ok: true, result: { records, count: records.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // record-get — single record by id (+ not-found reject).
  registerLensAction("notary", "record-get", (ctx, artifact, params) => {
    try {
      const p = payload(artifact, params);
      if (!p.recordId) return { ok: false, error: "recordId required" };
      const store = notaryStore();
      const userId = notaryActor(ctx);
      const record = notaryList(store, userId).find((r) => r.id === p.recordId);
      if (!record) return { ok: false, error: "record not found" };
      return { ok: true, result: { record } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
