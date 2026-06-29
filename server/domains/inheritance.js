// server/domains/inheritance.js
//
// NEW DOMAIN FILE — estate-planning surface for the inheritance lens.
//
// The death-derivatives heir-slot market (inheritance.open_listing /
// claim_slot / list_open) is registered inline in server.js and DB-backed.
// This file adds the general estate-planning primitives the lens was
// missing (per docs/lens-specs/inheritance.md):
//   - Beneficiary designation builder (name heirs + split % + contingency)
//   - Will / directive document authoring with versioning
//   - Asset inventory
//   - Executor assignment + multi-party consent workflow
//   - Revoke / amend an already-locked heir slot
//   - Probate / resolution timeline view
//   - Heir notification + acceptance flow
//
// Persistent per-user data lives in globalThis._concordSTATE Maps keyed
// by userId. Handlers never throw — every path is wrapped in try/catch
// and returns { ok, result? , error? }.

function estateState() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const S = g._concordSTATE;
  if (!S.inheritanceEstates) S.inheritanceEstates = new Map();   // userId -> estate record
  if (!S.inheritanceNotices) S.inheritanceNotices = new Map();   // heirUserId -> notice[]
  return S;
}

function blankEstate(userId) {
  return {
    userId,
    beneficiaries: [],   // { id, name, relationship, sharePct, contingent, contingentOn }
    assets: [],          // { id, label, category, valueCc, location, notes }
    wills: [],           // { version, title, body, status, authoredAt }
    executors: [],       // { id, name, role, consentStatus, invitedAt, respondedAt }
    locks: [],           // { id, listingId, npcName, priceCc, status, lockedAt, amendedAt }
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getEstate(userId) {
  const S = estateState();
  let e = S.inheritanceEstates.get(userId);
  if (!e) {
    e = blankEstate(userId);
    S.inheritanceEstates.set(userId, e);
  }
  return e;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Fail-CLOSED money guard. Returns true when `v` is NOT a usable CC amount so
// the caller can reject BEFORE the value lands in a value column (asset value,
// escrow price). The old `Math.max(0, Number(v) || 0)` pattern was fail-OPEN:
// Number(Infinity)||0 === Infinity and Number(1e308) is a finite absurdity that
// `Math.max(0, …)` happily passes through into estate-value / escrow sums.
// MAX_CC bounds a single CC amount at 1e6 (one million) — the same ceiling the
// sibling economy lenses (bounties.create) reject above.
const MAX_CC = 1e6;
function badCc(v) {
  if (v === undefined || v === null) return false; // omitted → caller defaults to 0
  const n = Number(v);
  return !Number.isFinite(n) || n < 0 || n > MAX_CC;
}

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || null;
}

function pushNotice(heirUserId, notice) {
  if (!heirUserId) return;
  const S = estateState();
  const arr = S.inheritanceNotices.get(heirUserId) || [];
  arr.unshift(notice);
  S.inheritanceNotices.set(heirUserId, arr.slice(0, 100));
}

export default function registerInheritanceActions(registerLensAction) {
  // ── Estate overview ───────────────────────────────────────────────
  registerLensAction("inheritance", "estate_overview", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const totalShare = e.beneficiaries.reduce((a, b) => a + (Number(b.sharePct) || 0), 0);
      const totalAssetValue = e.assets.reduce((a, x) => a + (Number(x.valueCc) || 0), 0);
      const activeWill = e.wills.find((w) => w.status === "active") || e.wills[e.wills.length - 1] || null;
      return {
        ok: true,
        result: {
          beneficiaryCount: e.beneficiaries.length,
          assetCount: e.assets.length,
          willCount: e.wills.length,
          executorCount: e.executors.length,
          lockCount: e.locks.length,
          totalSharePct: totalShare,
          shareBalanced: totalShare === 100,
          totalAssetValueCc: totalAssetValue,
          activeWillVersion: activeWill ? activeWill.version : null,
          executorsConsented: e.executors.filter((x) => x.consentStatus === "accepted").length,
          updatedAt: e.updatedAt,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ── Beneficiary designation builder ───────────────────────────────
  registerLensAction("inheritance", "add_beneficiary", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "missing_name" };
      const sharePct = Math.max(0, Math.min(100, Number(params.sharePct) || 0));
      const e = getEstate(userId);
      const ben = {
        id: uid("ben"),
        name,
        relationship: String(params.relationship || "unspecified").trim(),
        sharePct,
        contingent: !!params.contingent,
        contingentOn: params.contingentOn ? String(params.contingentOn).trim() : null,
        heirUserId: params.heirUserId ? String(params.heirUserId) : null,
        addedAt: Date.now(),
      };
      e.beneficiaries.push(ben);
      e.updatedAt = Date.now();
      return { ok: true, result: { beneficiary: ben, beneficiaries: e.beneficiaries } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "update_beneficiary", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const ben = e.beneficiaries.find((b) => b.id === params.beneficiaryId);
      if (!ben) return { ok: false, error: "beneficiary_not_found" };
      if (params.name !== undefined) ben.name = String(params.name).trim() || ben.name;
      if (params.relationship !== undefined) ben.relationship = String(params.relationship).trim();
      if (params.sharePct !== undefined) ben.sharePct = Math.max(0, Math.min(100, Number(params.sharePct) || 0));
      if (params.contingent !== undefined) ben.contingent = !!params.contingent;
      if (params.contingentOn !== undefined) ben.contingentOn = params.contingentOn ? String(params.contingentOn).trim() : null;
      e.updatedAt = Date.now();
      return { ok: true, result: { beneficiary: ben, beneficiaries: e.beneficiaries } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "remove_beneficiary", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const before = e.beneficiaries.length;
      e.beneficiaries = e.beneficiaries.filter((b) => b.id !== params.beneficiaryId);
      if (e.beneficiaries.length === before) return { ok: false, error: "beneficiary_not_found" };
      e.updatedAt = Date.now();
      return { ok: true, result: { beneficiaries: e.beneficiaries } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "list_beneficiaries", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const totalShare = e.beneficiaries.reduce((a, b) => a + (Number(b.sharePct) || 0), 0);
      return {
        ok: true,
        result: {
          beneficiaries: e.beneficiaries,
          totalSharePct: totalShare,
          balanced: totalShare === 100,
          remainderPct: Math.max(0, 100 - totalShare),
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ── Will / directive document authoring with versioning ───────────
  registerLensAction("inheritance", "author_will", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const body = String(params.body || "").trim();
      if (!body) return { ok: false, error: "missing_body" };
      const e = getEstate(userId);
      const version = e.wills.length + 1;
      // Prior active will becomes superseded.
      for (const w of e.wills) if (w.status === "active") w.status = "superseded";
      const will = {
        version,
        title: String(params.title || `Will v${version}`).trim(),
        body,
        kind: String(params.kind || "will").trim(),   // will | living_directive | power_of_attorney
        status: "active",
        authoredAt: Date.now(),
      };
      e.wills.push(will);
      e.updatedAt = Date.now();
      return { ok: true, result: { will, version, totalVersions: e.wills.length } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "list_will_versions", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      return {
        ok: true,
        result: {
          versions: e.wills.map((w) => ({ ...w, bodyPreview: w.body.slice(0, 160) })),
          activeVersion: (e.wills.find((w) => w.status === "active") || {}).version || null,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "get_will_version", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const will = e.wills.find((w) => w.version === Number(params.version));
      if (!will) return { ok: false, error: "version_not_found" };
      return { ok: true, result: { will } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "restore_will_version", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const src = e.wills.find((w) => w.version === Number(params.version));
      if (!src) return { ok: false, error: "version_not_found" };
      const version = e.wills.length + 1;
      for (const w of e.wills) if (w.status === "active") w.status = "superseded";
      const will = {
        version,
        title: `${src.title} (restored)`,
        body: src.body,
        kind: src.kind,
        status: "active",
        authoredAt: Date.now(),
        restoredFrom: src.version,
      };
      e.wills.push(will);
      e.updatedAt = Date.now();
      return { ok: true, result: { will } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ── Asset inventory ───────────────────────────────────────────────
  registerLensAction("inheritance", "add_asset", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const label = String(params.label || "").trim();
      if (!label) return { ok: false, error: "missing_label" };
      if (badCc(params.valueCc)) return { ok: false, error: "invalid numeric field: valueCc" };
      const e = getEstate(userId);
      const asset = {
        id: uid("ast"),
        label,
        category: String(params.category || "other").trim(),   // property | recipe | currency | artifact | other
        valueCc: Math.max(0, Number(params.valueCc) || 0),
        location: String(params.location || "").trim(),
        notes: String(params.notes || "").trim(),
        assignedTo: params.assignedTo ? String(params.assignedTo) : null,
        addedAt: Date.now(),
      };
      e.assets.push(asset);
      e.updatedAt = Date.now();
      return { ok: true, result: { asset, assets: e.assets } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "remove_asset", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const before = e.assets.length;
      e.assets = e.assets.filter((a) => a.id !== params.assetId);
      if (e.assets.length === before) return { ok: false, error: "asset_not_found" };
      e.updatedAt = Date.now();
      return { ok: true, result: { assets: e.assets } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "list_assets", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const byCategory = {};
      for (const a of e.assets) {
        byCategory[a.category] = byCategory[a.category] || { count: 0, valueCc: 0 };
        byCategory[a.category].count += 1;
        byCategory[a.category].valueCc += Number(a.valueCc) || 0;
      }
      return {
        ok: true,
        result: {
          assets: e.assets,
          totalValueCc: e.assets.reduce((a, x) => a + (Number(x.valueCc) || 0), 0),
          byCategory,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ── Executor assignment + multi-party consent workflow ────────────
  registerLensAction("inheritance", "assign_executor", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "missing_name" };
      const e = getEstate(userId);
      const exec = {
        id: uid("exe"),
        name,
        role: String(params.role || "executor").trim(),   // executor | co_executor | trustee | witness
        executorUserId: params.executorUserId ? String(params.executorUserId) : null,
        consentStatus: "pending",   // pending | accepted | declined
        invitedAt: Date.now(),
        respondedAt: null,
      };
      e.executors.push(exec);
      e.updatedAt = Date.now();
      if (exec.executorUserId) {
        pushNotice(exec.executorUserId, {
          id: uid("ntc"),
          kind: "executor_invite",
          fromUserId: userId,
          executorId: exec.id,
          message: `You have been invited as ${exec.role} of an estate.`,
          status: "unread",
          createdAt: Date.now(),
        });
      }
      return { ok: true, result: { executor: exec, executors: e.executors } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "respond_executor_consent", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const decision = String(params.decision || "").trim();
      if (!["accepted", "declined"].includes(decision)) return { ok: false, error: "bad_decision" };
      // The consenting party may be the estate owner (self-managed) or an invited executor user.
      const ownerId = params.estateUserId ? String(params.estateUserId) : userId;
      const e = getEstate(ownerId);
      const exec = e.executors.find((x) => x.id === params.executorId);
      if (!exec) return { ok: false, error: "executor_not_found" };
      exec.consentStatus = decision;
      exec.respondedAt = Date.now();
      e.updatedAt = Date.now();
      const allConsented = e.executors.length > 0
        && e.executors.every((x) => x.consentStatus === "accepted");
      return { ok: true, result: { executor: exec, allExecutorsConsented: allConsented } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "list_executors", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      return {
        ok: true,
        result: {
          executors: e.executors,
          consentSummary: {
            pending: e.executors.filter((x) => x.consentStatus === "pending").length,
            accepted: e.executors.filter((x) => x.consentStatus === "accepted").length,
            declined: e.executors.filter((x) => x.consentStatus === "declined").length,
          },
          fullyConsented: e.executors.length > 0
            && e.executors.every((x) => x.consentStatus === "accepted"),
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "remove_executor", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const before = e.executors.length;
      e.executors = e.executors.filter((x) => x.id !== params.executorId);
      if (e.executors.length === before) return { ok: false, error: "executor_not_found" };
      e.updatedAt = Date.now();
      return { ok: true, result: { executors: e.executors } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ── Revoke / amend an already-locked heir slot ────────────────────
  // Locks are tracked locally as estate-side bookkeeping for the heir
  // slots the player has claimed in the death-derivatives market.
  registerLensAction("inheritance", "track_lock", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      if (badCc(params.priceCc)) return { ok: false, error: "invalid numeric field: priceCc" };
      const e = getEstate(userId);
      const lock = {
        id: uid("lck"),
        listingId: params.listingId != null ? Number(params.listingId) : null,
        npcName: String(params.npcName || "unknown NPC").trim(),
        priceCc: Math.max(0, Number(params.priceCc) || 0),
        status: "locked",   // locked | amended | revoked | resolved
        lockedAt: Date.now(),
        amendedAt: null,
      };
      e.locks.push(lock);
      e.updatedAt = Date.now();
      return { ok: true, result: { lock, locks: e.locks } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "amend_lock", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const lock = e.locks.find((l) => l.id === params.lockId);
      if (!lock) return { ok: false, error: "lock_not_found" };
      if (lock.status === "revoked" || lock.status === "resolved") {
        return { ok: false, error: "lock_not_amendable" };
      }
      if (badCc(params.priceCc)) return { ok: false, error: "invalid numeric field: priceCc" };
      if (params.priceCc !== undefined) lock.priceCc = Math.max(0, Number(params.priceCc) || 0);
      if (params.npcName !== undefined) lock.npcName = String(params.npcName).trim() || lock.npcName;
      lock.status = "amended";
      lock.amendedAt = Date.now();
      e.updatedAt = Date.now();
      return { ok: true, result: { lock } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "revoke_lock", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const lock = e.locks.find((l) => l.id === params.lockId);
      if (!lock) return { ok: false, error: "lock_not_found" };
      if (lock.status === "resolved") return { ok: false, error: "lock_already_resolved" };
      if (lock.status === "revoked") return { ok: false, error: "lock_already_revoked" };
      lock.status = "revoked";
      lock.amendedAt = Date.now();
      e.updatedAt = Date.now();
      return { ok: true, result: { lock, refundedCc: lock.priceCc } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "list_locks", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const escrowedCc = e.locks
        .filter((l) => l.status === "locked" || l.status === "amended")
        .reduce((a, l) => a + (Number(l.priceCc) || 0), 0);
      return { ok: true, result: { locks: e.locks, escrowedCc } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ── Probate / resolution timeline ─────────────────────────────────
  registerLensAction("inheritance", "probate_timeline", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const e = getEstate(userId);
      const events = [];
      for (const w of e.wills) {
        events.push({
          id: `will-${w.version}`,
          time: w.authoredAt,
          label: `${w.title} authored`,
          kind: "will",
          tone: w.status === "active" ? "good" : "default",
        });
      }
      for (const x of e.executors) {
        events.push({
          id: `exec-${x.id}`,
          time: x.invitedAt,
          label: `Executor ${x.name} invited (${x.consentStatus})`,
          kind: "executor",
          tone: x.consentStatus === "accepted" ? "good"
            : x.consentStatus === "declined" ? "bad" : "warn",
        });
      }
      for (const l of e.locks) {
        events.push({
          id: `lock-${l.id}`,
          time: l.lockedAt,
          label: `Heir slot for ${l.npcName} — ${l.status}`,
          kind: "lock",
          tone: l.status === "revoked" ? "bad"
            : l.status === "resolved" ? "good"
              : l.status === "amended" ? "warn" : "info",
        });
      }
      events.sort((a, b) => a.time - b.time);
      const pendingTransfers = e.locks.filter((l) => l.status === "locked" || l.status === "amended").length;
      return {
        ok: true,
        result: {
          events,
          pendingTransfers,
          resolvedTransfers: e.locks.filter((l) => l.status === "resolved").length,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ── Heir notification + acceptance flow ───────────────────────────
  registerLensAction("inheritance", "notify_heir", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const heirUserId = String(params.heirUserId || "").trim();
      if (!heirUserId) return { ok: false, error: "missing_heir" };
      const e = getEstate(userId);
      const ben = params.beneficiaryId
        ? e.beneficiaries.find((b) => b.id === params.beneficiaryId)
        : null;
      const notice = {
        id: uid("ntc"),
        kind: "inheritance_designation",
        fromUserId: userId,
        beneficiaryId: ben ? ben.id : null,
        sharePct: ben ? ben.sharePct : (Number(params.sharePct) || null),
        message: String(params.message
          || `You have been designated as a beneficiary${ben ? ` (${ben.sharePct}% share)` : ""}.`).trim(),
        status: "unread",
        acceptance: "pending",   // pending | accepted | declined
        createdAt: Date.now(),
      };
      pushNotice(heirUserId, notice);
      return { ok: true, result: { notice } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "list_notices", (ctx) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const S = estateState();
      const notices = S.inheritanceNotices.get(userId) || [];
      return {
        ok: true,
        result: {
          notices,
          unreadCount: notices.filter((n) => n.status === "unread").length,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("inheritance", "respond_notice", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const decision = String(params.decision || "").trim();
      if (!["accepted", "declined"].includes(decision)) return { ok: false, error: "bad_decision" };
      const S = estateState();
      const notices = S.inheritanceNotices.get(userId) || [];
      const notice = notices.find((n) => n.id === params.noticeId);
      if (!notice) return { ok: false, error: "notice_not_found" };
      notice.status = "read";
      notice.acceptance = decision;
      notice.respondedAt = Date.now();
      // Reflect acceptance back onto the estate owner's beneficiary record.
      if (notice.fromUserId && notice.beneficiaryId) {
        const owner = getEstate(notice.fromUserId);
        const ben = owner.beneficiaries.find((b) => b.id === notice.beneficiaryId);
        if (ben) {
          ben.acceptanceStatus = decision;
          owner.updatedAt = Date.now();
        }
      }
      return { ok: true, result: { notice } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
}
