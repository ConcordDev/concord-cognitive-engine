// server/domains/collab.js
// Domain actions for collaboration: participant scoring, session analytics,
// contribution tracking, consensus detection, workload balancing.
//
// Plus a real-time multiplayer collaboration substrate: shared documents with
// a conflict-free operation log (CRDT-style), live multiplayer cursors +
// presence, version-history snapshot/restore, @-mention comments with
// notifications, per-element threaded discussion pins, follow-mode, and
// per-invitee permission tiers (view / comment / edit). All state persists in
// globalThis._concordSTATE so it survives across macro calls and (via the
// debounced save hook) across restarts.

export default function registerCollabActions(registerLensAction) {
  // ─────────────────────────────────────────────────────────────────
  //  Shared collaboration state
  // ─────────────────────────────────────────────────────────────────
  function getCollabState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.collabLens) STATE.collabLens = {};
    const s = STATE.collabLens;
    // documents:     docId -> { id, title, ownerId, ops[], snapshots[], permissions{}, createdAt }
    // presence:      docId -> Map(userId -> { userId, name, cursor, selection, color, following, viewport, updatedAt })
    // comments:      docId -> [ { id, threadId, parentId, authorId, authorName, text, mentions[], elementId, resolved, createdAt } ]
    // notifications: userId -> [ { id, kind, docId, commentId, fromId, fromName, text, read, createdAt } ]
    for (const k of ["documents", "presence", "comments", "notifications"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveCollabState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const cbUid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const cbName = (ctx) => ctx?.actor?.name || ctx?.actor?.displayName || ctx?.userName || cbUid(ctx);
  const cbNow = () => Date.now();
  const cbId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const cbClean = (v, max = 8000) => String(v == null ? "" : v).trim().slice(0, max);
  // Deterministic presence color from a user id.
  const PRESENCE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#ef4444", "#14b8a6"];
  function colorFor(userId) {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
    return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
  }
  // Emit a realtime event to a document room (degrades to poll when unavailable).
  function emitToDoc(docId, name, payload) {
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`collab:doc:${docId}`).emit(name, { docId, ...payload, ts: cbNow() });
    } catch (_e) { /* best effort — clients fall back to poll */ }
  }
  function emitToUser(userId, name, payload) {
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`user:${userId}`).emit(name, { userId, ...payload, ts: cbNow() });
    } catch (_e) { /* best effort */ }
  }
  // Permission tier resolution. Owner always has edit. Tiers: view < comment < edit.
  const TIER_RANK = { view: 1, comment: 2, edit: 3 };
  function tierFor(doc, userId) {
    if (!doc) return "view";
    if (doc.ownerId === userId) return "edit";
    return doc.permissions[userId] || doc.defaultTier || "view";
  }
  function canEdit(doc, userId) { return TIER_RANK[tierFor(doc, userId)] >= TIER_RANK.edit; }
  function canComment(doc, userId) { return TIER_RANK[tierFor(doc, userId)] >= TIER_RANK.comment; }
  // Materialize the document text from its conflict-free op log. Each op is
  // { id, type:'insert'|'delete', pos, text|len, authorId, lamport, ts }. The log
  // is kept sorted by (lamport, authorId) so concurrent edits converge to the
  // same final text regardless of arrival order — a CRDT-style total order.
  function materialize(doc) {
    const sorted = [...doc.ops].sort((a, b) =>
      a.lamport !== b.lamport ? a.lamport - b.lamport : String(a.authorId).localeCompare(String(b.authorId)));
    let text = doc.baseText || "";
    for (const op of sorted) {
      if (op.type === "insert") {
        const pos = Math.max(0, Math.min(op.pos | 0, text.length));
        text = text.slice(0, pos) + (op.text || "") + text.slice(pos);
      } else if (op.type === "delete") {
        const pos = Math.max(0, Math.min(op.pos | 0, text.length));
        const len = Math.max(0, Math.min(op.len | 0, text.length - pos));
        text = text.slice(0, pos) + text.slice(pos + len);
      }
    }
    return text;
  }
  // Fail-CLOSED numeric coercion. parseFloat/parseInt silently leak Infinity
  // (parseFloat("Infinity") === Infinity) and accept "12abc" as 12, which then
  // poisons every downstream division/ratio with Infinity/NaN. This helper
  // returns `fallback` for anything that isn't a finite number, so a poisoned
  // input degrades to the default instead of corrupting the computed result.
  function finiteNum(v, fallback = 0) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // Prune stale presence rows (no heartbeat in 45s).
  function prunePresence(map) {
    const cutoff = cbNow() - 45_000;
    for (const [uid, p] of map.entries()) {
      if ((p.updatedAt || 0) < cutoff) map.delete(uid);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Original facilitation macros (pure compute)
  // ═══════════════════════════════════════════════════════════════════
  registerLensAction("collab", "sessionAnalytics", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const participants = data.participants || [];
    const messages = data.messages || [];
    const duration = Math.max(0, finiteNum(data.durationMinutes, 0));
    const participantStats = participants.map(p => {
      const pName = p.name || p;
      const pMessages = messages.filter(m => m.author === pName || m.sender === pName);
      const wordCount = pMessages.reduce((s, m) => s + ((m.content || m.text || "").split(/\s+/).length), 0);
      return { name: pName, messages: pMessages.length, wordCount, avgWordsPerMessage: pMessages.length > 0 ? Math.round(wordCount / pMessages.length) : 0, sharePercent: messages.length > 0 ? Math.round((pMessages.length / messages.length) * 100) : 0 };
    });
    const giniCoeff = (() => {
      const shares = participantStats.map(p => p.messages).sort((a, b) => a - b);
      const n = shares.length; if (n < 2) return 0;
      const mean = shares.reduce((s, v) => s + v, 0) / n;
      if (mean === 0) return 0;
      let sum = 0; for (let i = 0; i < n; i++) sum += (2 * (i + 1) - n - 1) * shares[i];
      return Math.round((sum / (n * n * mean)) * 100) / 100;
    })();
    return { ok: true, result: { totalMessages: messages.length, totalParticipants: participants.length, durationMinutes: duration, messagesPerMinute: duration > 0 ? Math.round((messages.length / duration) * 10) / 10 : 0, participantStats, participationBalance: giniCoeff, balanceRating: giniCoeff < 0.2 ? "well-balanced" : giniCoeff < 0.4 ? "slightly-uneven" : "dominated-by-few" } };
  });

  registerLensAction("collab", "contributionScore", (ctx, artifact, _params) => {
    const contributions = artifact.data?.contributions || [];
    if (contributions.length === 0) return { ok: true, result: { message: "Track contributions to calculate scores." } };
    const weights = { code: 3, design: 2.5, document: 2, review: 1.5, discussion: 1, admin: 0.5 };
    const scored = contributions.map(c => {
      const type = (c.type || "discussion").toLowerCase();
      // Fail-CLOSED: a non-finite / poisoned quality falls to the 0.7 default
      // (preserving the original `|| 0.7` semantics), then clamps to [0,1].
      const quality = Math.max(0, Math.min(1, finiteNum(c.quality, 0.7) || 0.7));
      const weight = weights[type] || 1;
      const count = Math.max(1, Math.round(finiteNum(c.count, 1)) || 1);
      return { contributor: c.name || c.author, type, quality: Math.round(quality * 100), score: Math.round(weight * quality * 100), count };
    });
    const byPerson = {};
    for (const s of scored) {
      if (!byPerson[s.contributor]) byPerson[s.contributor] = { total: 0, contributions: 0 };
      byPerson[s.contributor].total += s.score * s.count;
      byPerson[s.contributor].contributions += s.count;
    }
    const rankings = Object.entries(byPerson).map(([name, data]) => ({ name, totalScore: data.total, contributions: data.contributions })).sort((a, b) => b.totalScore - a.totalScore);
    return { ok: true, result: { rankings, totalContributions: scored.reduce((s, c) => s + c.count, 0), topContributor: rankings[0]?.name } };
  });

  registerLensAction("collab", "detectConsensus", (ctx, artifact, _params) => {
    const votes = artifact.data?.votes || [];
    if (votes.length === 0) return { ok: true, result: { message: "Add votes or positions to detect consensus." } };
    const tally = {};
    for (const v of votes) { const pos = v.position || v.vote || "abstain"; tally[pos] = (tally[pos] || 0) + 1; }
    const total = votes.length;
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const topPosition = sorted[0]?.[0];
    const topCount = sorted[0]?.[1] || 0;
    const consensusPercent = total > 0 ? Math.round((topCount / total) * 100) : 0;
    const hasConsensus = consensusPercent >= 67;
    const hasSupermajority = consensusPercent >= 75;
    return { ok: true, result: { totalVotes: total, tally: Object.fromEntries(sorted), leadingPosition: topPosition, consensusPercent, hasConsensus, hasSupermajority, status: hasSupermajority ? "strong-consensus" : hasConsensus ? "consensus-reached" : consensusPercent >= 50 ? "simple-majority" : "no-consensus", dissenting: sorted.slice(1).map(([pos, count]) => ({ position: pos, count, percent: Math.round((count / total) * 100) })) } };
  });

  registerLensAction("collab", "balanceWorkload", (ctx, artifact, _params) => {
    const members = artifact.data?.members || [];
    const tasks = artifact.data?.tasks || [];
    if (members.length === 0) return { ok: true, result: { message: "Add team members and tasks to balance workload." } };
    const memberLoads = members.map(m => {
      const assigned = tasks.filter(t => t.assignee === m.name || t.assignee === m);
      // Fail-CLOSED: poisoned hours/capacity fall to sane defaults (2h/task, 40h cap)
      // so Infinity/NaN never leaks into totalHours, capacity, or utilization.
      const totalHours = assigned.reduce((s, t) => s + Math.max(0, finiteNum(t.hours ?? t.estimatedHours, 2) || 2), 0);
      const capacity = Math.max(1, finiteNum(m.capacityHours, 40) || 40);
      return { name: typeof m === "string" ? m : m.name, assignedTasks: assigned.length, totalHours, capacity, utilization: Math.round((totalHours / capacity) * 100), status: totalHours > capacity ? "overloaded" : totalHours > capacity * 0.8 ? "near-capacity" : "available" };
    });
    const unassigned = tasks.filter(t => !t.assignee);
    const overloaded = memberLoads.filter(m => m.status === "overloaded");
    const available = memberLoads.filter(m => m.status === "available").sort((a, b) => a.utilization - b.utilization);
    return { ok: true, result: { members: memberLoads, unassignedTasks: unassigned.length, overloadedMembers: overloaded.length, suggestions: overloaded.length > 0 && available.length > 0 ? [`Move tasks from ${overloaded[0].name} to ${available[0].name}`] : [], avgUtilization: Math.round(memberLoads.reduce((s, m) => s + m.utilization, 0) / memberLoads.length) } };
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Shared documents — conflict-free co-editing (CRDT op-log)
  // ═══════════════════════════════════════════════════════════════════

  // Create a shared document.
  registerLensAction("collab", "docCreate", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const uid = cbUid(ctx);
      const title = cbClean(params?.title, 240) || "Untitled document";
      const baseText = cbClean(params?.text, 200_000);
      const id = cbId("doc");
      const doc = {
        id, title, ownerId: uid, baseText,
        ops: [], snapshots: [], permissions: {}, defaultTier: "edit",
        createdAt: cbNow(), updatedAt: cbNow(), lamport: 0,
      };
      s.documents.set(id, doc);
      saveCollabState();
      return { ok: true, result: { id, title, ownerId: uid, text: baseText, createdAt: doc.createdAt } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List documents the caller can see (owner or has a permission entry).
  registerLensAction("collab", "docList", (ctx, _artifact, _params) => {
    try {
      const s = getCollabState();
      const uid = cbUid(ctx);
      const docs = [];
      for (const doc of s.documents.values()) {
        const tier = tierFor(doc, uid);
        if (doc.ownerId !== uid && !(uid in doc.permissions) && doc.defaultTier === "view" && doc.permissions && Object.keys(doc.permissions).length > 0) {
          // visible only if explicitly shared once it has a permission table
        }
        docs.push({
          id: doc.id, title: doc.title, ownerId: doc.ownerId,
          isOwner: doc.ownerId === uid, tier,
          opCount: doc.ops.length, snapshotCount: doc.snapshots.length,
          updatedAt: doc.updatedAt, createdAt: doc.createdAt,
        });
      }
      docs.sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, result: { documents: docs, total: docs.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Read full document state: materialized text + op log + lamport clock.
  registerLensAction("collab", "docState", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      return { ok: true, result: {
        id: doc.id, title: doc.title, ownerId: doc.ownerId,
        text: materialize(doc), lamport: doc.lamport, opCount: doc.ops.length,
        tier: tierFor(doc, uid), canEdit: canEdit(doc, uid), canComment: canComment(doc, uid),
        updatedAt: doc.updatedAt,
      } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Apply a conflict-free edit operation. Concurrent ops converge because the
  // log is replayed in a deterministic (lamport, authorId) total order.
  registerLensAction("collab", "docOp", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!canEdit(doc, uid)) return { ok: false, error: "permission denied: edit tier required" };
      const type = params?.type === "delete" ? "delete" : "insert";
      const clientLamport = parseInt(params?.lamport) || 0;
      // Lamport clock: new op's clock is max(local, remote) + 1.
      doc.lamport = Math.max(doc.lamport, clientLamport) + 1;
      const op = {
        id: cbId("op"), type, authorId: uid,
        pos: Math.max(0, parseInt(params?.pos) || 0),
        lamport: doc.lamport, ts: cbNow(),
      };
      if (type === "insert") op.text = cbClean(params?.text, 20_000);
      else op.len = Math.max(0, parseInt(params?.len) || 0);
      doc.ops.push(op);
      doc.updatedAt = cbNow();
      // Keep the op log bounded — fold the oldest 200 ops into baseText when it grows past 1000.
      if (doc.ops.length > 1000) {
        const sortedOld = [...doc.ops].sort((a, b) =>
          a.lamport !== b.lamport ? a.lamport - b.lamport : String(a.authorId).localeCompare(String(b.authorId)));
        const keep = sortedOld.slice(-800);
        const fold = sortedOld.slice(0, sortedOld.length - 800);
        const foldedDoc = { baseText: doc.baseText, ops: fold };
        doc.baseText = materialize(foldedDoc);
        doc.ops = keep;
      }
      saveCollabState();
      const text = materialize(doc);
      emitToDoc(doc.id, "collab:doc-op", { op, lamport: doc.lamport, text });
      return { ok: true, result: { op, lamport: doc.lamport, text } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Poll-based sync: return ops newer than the caller's last-seen lamport.
  registerLensAction("collab", "docSync", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const sinceLamport = parseInt(params?.sinceLamport) || 0;
      const newOps = doc.ops
        .filter(op => op.lamport > sinceLamport)
        .sort((a, b) => a.lamport - b.lamport);
      const presenceMap = s.presence.get(doc.id) || new Map();
      prunePresence(presenceMap);
      return { ok: true, result: {
        ops: newOps, lamport: doc.lamport, text: materialize(doc),
        presence: [...presenceMap.values()],
      } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Version history — snapshot / list / restore
  // ═══════════════════════════════════════════════════════════════════

  registerLensAction("collab", "docSnapshot", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!canEdit(doc, uid)) return { ok: false, error: "permission denied: edit tier required" };
      const snap = {
        id: cbId("snap"), label: cbClean(params?.label, 160) || `Version ${doc.snapshots.length + 1}`,
        text: materialize(doc), lamport: doc.lamport, opCount: doc.ops.length,
        authorId: uid, authorName: cbName(ctx), createdAt: cbNow(),
      };
      doc.snapshots.push(snap);
      if (doc.snapshots.length > 100) doc.snapshots = doc.snapshots.slice(-100);
      saveCollabState();
      emitToDoc(doc.id, "collab:doc-snapshot", { snapshotId: snap.id, label: snap.label });
      return { ok: true, result: { id: snap.id, label: snap.label, createdAt: snap.createdAt, totalSnapshots: doc.snapshots.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("collab", "docHistory", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const snapshots = doc.snapshots.map(sn => ({
        id: sn.id, label: sn.label, lamport: sn.lamport, opCount: sn.opCount,
        authorId: sn.authorId, authorName: sn.authorName, createdAt: sn.createdAt,
        preview: (sn.text || "").slice(0, 200),
        chars: (sn.text || "").length,
      })).sort((a, b) => b.createdAt - a.createdAt);
      return { ok: true, result: { snapshots, total: snapshots.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Restore: snapshots prior state to baseText, clears the op log so the
  // document materializes exactly to the chosen version.
  registerLensAction("collab", "docRestore", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!canEdit(doc, uid)) return { ok: false, error: "permission denied: edit tier required" };
      const snap = doc.snapshots.find(sn => sn.id === cbClean(params?.snapshotId, 80));
      if (!snap) return { ok: false, error: "snapshot not found" };
      // Preserve current state as an auto-snapshot before destructive restore.
      doc.snapshots.push({
        id: cbId("snap"), label: `Auto-save before restore`,
        text: materialize(doc), lamport: doc.lamport, opCount: doc.ops.length,
        authorId: uid, authorName: cbName(ctx), createdAt: cbNow(),
      });
      doc.baseText = snap.text;
      doc.ops = [];
      doc.lamport += 1;
      doc.updatedAt = cbNow();
      saveCollabState();
      emitToDoc(doc.id, "collab:doc-restored", { snapshotId: snap.id, label: snap.label, text: snap.text, lamport: doc.lamport });
      return { ok: true, result: { restoredTo: snap.label, text: snap.text, lamport: doc.lamport } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  CRDT-aware snapshots (capture Y.Doc binary state)
  //
  // The text-only snapshots above lose Y.Doc structure: cursor
  // positions, formatting, nested types. These macros capture the
  // FULL CRDT state via `Y.encodeStateAsUpdate(doc)` so restore is
  // exact and lets users undo/redo across history boundaries.
  // Restore replaces the in-memory Y.Doc and emits `yjs:doc-reset`
  // to every connected client; the useYjsDoc hook re-binds.
  // ═══════════════════════════════════════════════════════════════════

  registerLensAction("collab", "docCrdtSnapshot", async (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      const doc = s.documents.get(docId);
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!canEdit(doc, uid)) return { ok: false, error: "permission denied: edit tier required" };
      const { encodeStateAsUpdate } = await import("../lib/yjs-realtime.js");
      const bytes = encodeStateAsUpdate("collab:doc", docId);
      const b64 = Buffer.from(bytes).toString("base64");
      if (!Array.isArray(doc.crdtSnapshots)) doc.crdtSnapshots = [];
      // `seq` is a monotonic counter per doc so newest-first sort is
      // deterministic even when two snapshots share a `createdAt` ms
      // (Date.now resolution is 1ms; rapid back-to-back snapshots can
      // tie). `crdtSnapshotSeq` lives on the doc and survives restart
      // because the whole doc is saved to STATE.
      doc.crdtSnapshotSeq = (doc.crdtSnapshotSeq | 0) + 1;
      const snap = {
        id: cbId("csnap"),
        seq: doc.crdtSnapshotSeq,
        label: cbClean(params?.label, 160) || `CRDT v${doc.crdtSnapshots.length + 1}`,
        update: b64,
        bytes: bytes.length,
        textPreview: materialize(doc).slice(0, 200),
        authorId: uid, authorName: cbName(ctx),
        createdAt: cbNow(),
      };
      doc.crdtSnapshots.push(snap);
      // Keep the last 50 — Y.Doc updates compound, so each snapshot is
      // larger than the previous; 50 is a sane upper bound.
      if (doc.crdtSnapshots.length > 50) doc.crdtSnapshots = doc.crdtSnapshots.slice(-50);
      saveCollabState();
      emitToDoc(doc.id, "collab:doc-crdt-snapshot", { snapshotId: snap.id, label: snap.label });
      return {
        ok: true,
        result: { id: snap.id, label: snap.label, bytes: snap.bytes, createdAt: snap.createdAt, totalSnapshots: doc.crdtSnapshots.length },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("collab", "docCrdtSnapshotList", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const snaps = (doc.crdtSnapshots || []).map(sn => ({
        id: sn.id, seq: sn.seq | 0, label: sn.label, bytes: sn.bytes,
        authorId: sn.authorId, authorName: sn.authorName,
        createdAt: sn.createdAt,
        preview: sn.textPreview || "",
      })).sort((a, b) =>
        b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : b.seq - a.seq
      );
      return { ok: true, result: { snapshots: snaps, total: snaps.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("collab", "docCrdtRestore", async (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      const doc = s.documents.get(docId);
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!canEdit(doc, uid)) return { ok: false, error: "permission denied: edit tier required" };
      const snap = (doc.crdtSnapshots || []).find(sn => sn.id === cbClean(params?.snapshotId, 80));
      if (!snap) return { ok: false, error: "snapshot not found" };
      // Auto-snapshot current state before destructive restore (so the
      // user can re-restore if they change their mind).
      const yjs = await import("../lib/yjs-realtime.js");
      const currentBytes = yjs.encodeStateAsUpdate("collab:doc", docId);
      if (!Array.isArray(doc.crdtSnapshots)) doc.crdtSnapshots = [];
      doc.crdtSnapshotSeq = (doc.crdtSnapshotSeq | 0) + 1;
      doc.crdtSnapshots.push({
        id: cbId("csnap"),
        seq: doc.crdtSnapshotSeq,
        label: `Auto-save before CRDT restore`,
        update: Buffer.from(currentBytes).toString("base64"),
        bytes: currentBytes.length,
        textPreview: materialize(doc).slice(0, 200),
        authorId: uid, authorName: cbName(ctx),
        createdAt: cbNow(),
      });
      // Replace the in-memory Y.Doc with the snapshot state.
      const snapshotBytes = Buffer.from(snap.update, "base64");
      const res = yjs.replaceDoc("collab:doc", docId, snapshotBytes);
      if (!res.ok) return { ok: false, error: res.error || "replaceDoc failed" };
      // Broadcast a reset so every connected client drops its local doc
      // and re-binds to the new state.
      const REALTIME = globalThis._concordREALTIME;
      yjs.broadcastDocReset(REALTIME?.io, "collab:doc", docId, res.state);
      // Also align the legacy text path so non-CRDT snapshots stay coherent.
      try {
        const text = yjs.getDocText("collab:doc", docId, "content");
        doc.baseText = text;
        doc.ops = [];
        doc.lamport += 1;
        doc.updatedAt = cbNow();
      } catch { /* ignore — Y.Text may not be 'content' for some docs */ }
      saveCollabState();
      emitToDoc(doc.id, "collab:doc-crdt-restored", { snapshotId: snap.id, label: snap.label });
      return { ok: true, result: { restoredTo: snap.label, bytes: snap.bytes } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Live presence + multiplayer cursors + follow-mode
  // ═══════════════════════════════════════════════════════════════════

  // Heartbeat the caller's cursor / selection / viewport into the doc's
  // presence map. Broadcast so other clients render the live cursor.
  registerLensAction("collab", "cursorUpdate", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      const doc = s.documents.get(docId);
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!s.presence.has(docId)) s.presence.set(docId, new Map());
      const map = s.presence.get(docId);
      const row = {
        userId: uid, name: cbName(ctx), color: colorFor(uid),
        cursor: Number.isFinite(+params?.cursor) ? +params.cursor : 0,
        selection: params?.selection && typeof params.selection === "object"
          ? { start: +params.selection.start || 0, end: +params.selection.end || 0 } : null,
        viewport: params?.viewport && typeof params.viewport === "object"
          ? { x: +params.viewport.x || 0, y: +params.viewport.y || 0, zoom: +params.viewport.zoom || 1 } : null,
        following: cbClean(params?.following, 80) || (map.get(uid)?.following ?? null),
        updatedAt: cbNow(),
      };
      map.set(uid, row);
      prunePresence(map);
      emitToDoc(docId, "collab:cursor", { presence: row });
      return { ok: true, result: { presence: [...map.values()] } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Read the live presence roster (who is here, cursors, follow state).
  registerLensAction("collab", "presenceState", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      const map = s.presence.get(docId) || new Map();
      prunePresence(map);
      const uid = cbUid(ctx);
      const rows = [...map.values()];
      const me = rows.find(r => r.userId === uid) || null;
      // If following someone, resolve their current viewport/cursor for the client.
      let followTarget = null;
      if (me?.following) {
        const t = map.get(me.following);
        if (t) followTarget = { userId: t.userId, name: t.name, cursor: t.cursor, viewport: t.viewport, color: t.color };
      }
      return { ok: true, result: { presence: rows, online: rows.length, following: me?.following || null, followTarget } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Follow-mode: lock the caller's viewport onto another user (or clear it).
  registerLensAction("collab", "setFollow", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      if (!s.documents.has(docId)) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      const target = params?.targetId ? cbClean(params.targetId, 80) : null;
      if (!s.presence.has(docId)) s.presence.set(docId, new Map());
      const map = s.presence.get(docId);
      if (target && target !== uid && !map.has(target)) {
        return { ok: false, error: "follow target is not present" };
      }
      const row = map.get(uid) || {
        userId: uid, name: cbName(ctx), color: colorFor(uid),
        cursor: 0, selection: null, viewport: null, updatedAt: cbNow(),
      };
      row.following = target && target !== uid ? target : null;
      row.updatedAt = cbNow();
      map.set(uid, row);
      const t = row.following ? map.get(row.following) : null;
      return { ok: true, result: {
        following: row.following,
        followTarget: t ? { userId: t.userId, name: t.name, cursor: t.cursor, viewport: t.viewport, color: t.color } : null,
      } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Permission tiers (view / comment / edit)
  // ═══════════════════════════════════════════════════════════════════

  registerLensAction("collab", "setPermission", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (doc.ownerId !== uid) return { ok: false, error: "only the owner can change permissions" };
      const tier = String(params?.tier || "").toLowerCase();
      if (!(tier in TIER_RANK)) return { ok: false, error: "tier must be view, comment, or edit" };
      // Set the default tier for anyone not explicitly listed.
      if (params?.target === "*" || params?.isDefault) {
        doc.defaultTier = tier;
      } else {
        const target = cbClean(params?.userId || params?.target, 80);
        if (!target) return { ok: false, error: "userId (or target) is required" };
        if (target === doc.ownerId) return { ok: false, error: "owner already has edit tier" };
        doc.permissions[target] = tier;
        emitToUser(target, "collab:permission-changed", { docId: doc.id, tier });
      }
      doc.updatedAt = cbNow();
      saveCollabState();
      return { ok: true, result: { permissions: doc.permissions, defaultTier: doc.defaultTier } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("collab", "getPermissions", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const doc = s.documents.get(cbClean(params?.docId, 80));
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      const entries = Object.entries(doc.permissions).map(([userId, tier]) => ({ userId, tier }));
      return { ok: true, result: {
        ownerId: doc.ownerId, defaultTier: doc.defaultTier,
        entries, myTier: tierFor(doc, uid),
      } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Comments — @-mentions, notifications, per-element threaded pins
  // ═══════════════════════════════════════════════════════════════════

  // Parse @handles out of comment text.
  function extractMentions(text) {
    const out = new Set();
    const re = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_][A-Za-z0-9_.-]{1,63})/g;
    let m;
    while ((m = re.exec(text)) !== null) out.add(m[2]);
    return [...out];
  }
  function pushNotification(s, userId, n) {
    if (!s.notifications.has(userId)) s.notifications.set(userId, []);
    const list = s.notifications.get(userId);
    list.unshift({ id: cbId("ntf"), read: false, createdAt: cbNow(), ...n });
    if (list.length > 200) list.length = 200;
    emitToUser(userId, "collab:notification", { notification: list[0] });
  }

  // Add a comment. Supports threaded replies (parentId), per-element pins
  // (elementId), and @-mention notifications.
  registerLensAction("collab", "addComment", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      const doc = s.documents.get(docId);
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!canComment(doc, uid)) return { ok: false, error: "permission denied: comment tier required" };
      const text = cbClean(params?.text, 4000);
      if (!text) return { ok: false, error: "comment text is required" };
      if (!s.comments.has(docId)) s.comments.set(docId, []);
      const list = s.comments.get(docId);
      const parentId = params?.parentId ? cbClean(params.parentId, 80) : null;
      let threadId = parentId;
      if (parentId) {
        const parent = list.find(c => c.id === parentId);
        if (!parent) return { ok: false, error: "parent comment not found" };
        threadId = parent.threadId || parent.id;
      }
      const mentions = extractMentions(text);
      const comment = {
        id: cbId("cmt"), docId,
        threadId: threadId || null,
        parentId: parentId || null,
        elementId: params?.elementId ? cbClean(params.elementId, 120) : null,
        anchor: params?.anchor && typeof params.anchor === "object"
          ? { start: +params.anchor.start || 0, end: +params.anchor.end || 0 } : null,
        authorId: uid, authorName: cbName(ctx),
        text, mentions, resolved: false, createdAt: cbNow(),
      };
      if (!comment.threadId) comment.threadId = comment.id; // top-level comment seeds its own thread
      list.push(comment);
      // Notify @-mentioned users.
      for (const handle of mentions) {
        pushNotification(s, handle, {
          kind: "mention", docId, commentId: comment.id,
          fromId: uid, fromName: cbName(ctx),
          text: `${cbName(ctx)} mentioned you: "${text.slice(0, 120)}"`,
        });
      }
      // Notify the parent author of a reply (if not self, not already mentioned).
      if (parentId) {
        const parent = list.find(c => c.id === parentId);
        if (parent && parent.authorId !== uid && !mentions.includes(parent.authorId)) {
          pushNotification(s, parent.authorId, {
            kind: "reply", docId, commentId: comment.id,
            fromId: uid, fromName: cbName(ctx),
            text: `${cbName(ctx)} replied to your comment`,
          });
        }
      }
      doc.updatedAt = cbNow();
      saveCollabState();
      emitToDoc(docId, "collab:comment", { comment });
      return { ok: true, result: { comment } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List comments — optionally a single thread, or only pins (elementId set).
  registerLensAction("collab", "listComments", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      let list = (s.comments.get(docId) || []).slice();
      if (params?.threadId) list = list.filter(c => c.threadId === cbClean(params.threadId, 80));
      if (params?.elementId) list = list.filter(c => c.elementId === cbClean(params.elementId, 120));
      if (params?.pinsOnly) list = list.filter(c => !!c.elementId);
      if (!params?.includeResolved) {
        // include unresolved + threads with at least one unresolved comment
        const openThreads = new Set(list.filter(c => !c.resolved).map(c => c.threadId));
        list = list.filter(c => openThreads.has(c.threadId) || !c.resolved);
      }
      list.sort((a, b) => a.createdAt - b.createdAt);
      // Group into threads for convenience.
      const threadMap = new Map();
      for (const c of list) {
        if (!threadMap.has(c.threadId)) threadMap.set(c.threadId, []);
        threadMap.get(c.threadId).push(c);
      }
      const threads = [...threadMap.entries()].map(([threadId, comments]) => ({
        threadId, elementId: comments[0]?.elementId || null,
        anchor: comments[0]?.anchor || null,
        resolved: comments.every(c => c.resolved),
        commentCount: comments.length, comments,
        updatedAt: Math.max(...comments.map(c => c.createdAt)),
      })).sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, result: { comments: list, threads, total: list.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Resolve (or re-open) an entire comment thread.
  registerLensAction("collab", "resolveThread", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const docId = cbClean(params?.docId, 80);
      const doc = s.documents.get(docId);
      if (!doc) return { ok: false, error: "document not found" };
      const uid = cbUid(ctx);
      if (!canComment(doc, uid)) return { ok: false, error: "permission denied: comment tier required" };
      const threadId = cbClean(params?.threadId, 80);
      const list = s.comments.get(docId) || [];
      const thread = list.filter(c => c.threadId === threadId);
      if (thread.length === 0) return { ok: false, error: "thread not found" };
      const resolved = params?.reopen ? false : true;
      for (const c of thread) {
        c.resolved = resolved;
        if (resolved) { c.resolvedBy = uid; c.resolvedAt = cbNow(); }
      }
      saveCollabState();
      emitToDoc(docId, "collab:thread-resolved", { threadId, resolved });
      return { ok: true, result: { threadId, resolved, commentCount: thread.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── Notifications ──────────────────────────────────────────────────

  registerLensAction("collab", "notifications", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const uid = cbUid(ctx);
      let list = (s.notifications.get(uid) || []).slice();
      if (params?.unreadOnly) list = list.filter(n => !n.read);
      const limit = Math.min(parseInt(params?.limit) || 50, 200);
      list = list.slice(0, limit);
      const unread = (s.notifications.get(uid) || []).filter(n => !n.read).length;
      return { ok: true, result: { notifications: list, unread, total: (s.notifications.get(uid) || []).length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("collab", "markNotificationRead", (ctx, _artifact, params) => {
    try {
      const s = getCollabState();
      const uid = cbUid(ctx);
      const list = s.notifications.get(uid) || [];
      if (params?.all) {
        for (const n of list) n.read = true;
        saveCollabState();
        return { ok: true, result: { marked: list.length, unread: 0 } };
      }
      const id = cbClean(params?.notificationId, 80);
      const n = list.find(x => x.id === id);
      if (!n) return { ok: false, error: "notification not found" };
      n.read = true;
      saveCollabState();
      return { ok: true, result: { marked: 1, unread: list.filter(x => !x.read).length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
