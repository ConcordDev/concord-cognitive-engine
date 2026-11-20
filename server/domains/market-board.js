// server/domains/market-board.js
//
// The commission pay board. Someone asks for a DTU to be made, sets the
// checks it must pass and a reward in Concord Coin; the reward is held in
// __ESCROW__ on economy_ledger the moment the request is posted. Creators
// make the DTU and submit it; the server runs the checks on the DTU itself;
// the commissioner can accept only a submission that passes them, and
// accepting pays the creator from escrow and delivers the DTU.
//
// Money rules (each pinned by a test):
//   • Posting moves exactly `reward` from the poster to __ESCROW__, fee-free
//     (escrow is not a payment to anyone yet). escrow_held = reward.
//   • Accepting releases exactly escrow_held from __ESCROW__ to the creator as
//     a MARKETPLACE_PURCHASE, so the market fee applies once, here, and the
//     creator's net counts as earned income (economy/withdrawals.js).
//   • Cancelling (before an award) or expiry returns exactly escrow_held to
//     the poster, fee-free. Expiry: submissions close at the deadline; the
//     poster then has 7 days to accept one, after which the reward returns.
//   • Every move is idempotent on its refId and runs inside one SQLite
//     transaction together with the status change it belongs to.
//
// Fee-free escrow moves are written as the same two-row TRANSFER shape
// executeTransfer writes (debit half with from+to, credit half with from
// NULL), so balances.js#CREDIT_ROW_PREDICATE counts the credit exactly once.

import { randomUUID } from "node:crypto";
import { executeTransfer } from "../economy/transfer.js";
import { recordTransactionBatch, generateTxId, checkRefIdProcessed } from "../economy/ledger.js";
import { validateBalance } from "../economy/validators.js";
import { getBalance } from "../economy/balances.js";
import { calculateFee } from "../economy/fees.js";
import { publicRead, actorOf, loadDtu, ownerOf, unsellableReason, dtuFacts, userNames } from "./market-house.js";
import { getAncestorChain } from "../economy/royalty-cascade.js";

export const ESCROW = "__ESCROW__";
export const ACCEPT_GRACE_DAYS = 7;
const DAY = 86_400_000;
const MAX_REWARD = 100_000;
const MAX_ACTIVE_SUBMISSIONS = 3;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Move CC fee-free (escrow hold / return). Two-row TRANSFER, balance checked inside the transaction. */
export function escrowMove(db, { from, to, amount, refId, metadata = {} }) {
  if (checkRefIdProcessed(db, refId).exists) return { ok: true, idempotent: true };
  const batchId = generateTxId();
  const run = db.transaction(() => {
    const bal = validateBalance(db, from, amount);
    if (!bal.ok) throw new Error(`insufficient_balance:${bal.balance}`);
    recordTransactionBatch(db, [
      { type: "TRANSFER", from, to, amount, fee: 0, net: amount, status: "complete", refId, metadata: { ...metadata, batchId, role: "debit" } },
      { type: "TRANSFER", from: null, to, amount, fee: 0, net: amount, status: "complete", refId, metadata: { ...metadata, batchId, role: "credit" } },
    ]);
  });
  try { run(); return { ok: true, batchId }; } catch (e) {
    const m = String(e?.message || e);
    if (m.startsWith("insufficient_balance:")) return { ok: false, error: "insufficient_balance", balance: Number(m.split(":")[1]) };
    throw e;
  }
}

// ── criteria ─────────────────────────────────────────────────────────────

const TIERS = new Set(["regular", "mega", "hyper"]);

/** Validate and normalise what a commissioner may ask for. */
export function normaliseCriteria(raw = {}, db) {
  const c = {};
  if (raw.kind != null && raw.kind !== "") {
    if (!TIERS.has(raw.kind)) return { error: "invalid_kind" };
    c.kind = raw.kind;
  }
  if (raw.domain) c.domain = String(raw.domain).trim().toLowerCase().slice(0, 60);
  if (raw.tags != null) {
    const tags = (Array.isArray(raw.tags) ? raw.tags : String(raw.tags).split(",")).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    if (tags.length > 8) return { error: "too_many_tags" };
    if (tags.length) c.tags = [...new Set(tags)];
  }
  for (const [k, max] of [["minClaims", 50], ["minWords", 20000]]) {
    if (raw[k] == null || raw[k] === "" || Number(raw[k]) === 0) continue;
    const n = Number(raw[k]);
    if (!Number.isInteger(n) || n < 0 || n > max) return { error: `invalid_${k}` };
    c[k] = n;
  }
  if (raw.mustCite) {
    const id = String(raw.mustCite).trim();
    if (!loadDtu(db, id)) return { error: "cite_target_not_found" };
    c.mustCite = id;
  }
  if (raw.hasFile) c.hasFile = true;
  c.madeAfterPost = raw.madeAfterPost !== false;
  return { criteria: c };
}

/** Run a commission's checks on a DTU. Every check reads the DTU itself. */
export function runChecks(db, dtu, commission, creatorId) {
  const crit = typeof commission.criteria_json === "string" ? JSON.parse(commission.criteria_json || "{}") : commission.criteria || {};
  const f = dtuFacts(dtu);
  const checks = [];
  const add = (key, label, pass, detail) => checks.push({ key, label, pass: !!pass, detail });
  add("owner", "Made by the submitter", ownerOf(dtu) === creatorId && !dtu.meta?.purchasedFrom, ownerOf(dtu) === creatorId ? (dtu.meta?.purchasedFrom ? "a bought copy" : "yes") : "someone else's DTU");
  if (crit.madeAfterPost) {
    const made = Date.parse(f.createdAt || "");
    const posted = Date.parse(String(commission.created_at).replace(" ", "T") + (String(commission.created_at).endsWith("Z") ? "" : "Z"));
    add("madeAfterPost", "Made after the request was posted", Number.isFinite(made) && made >= posted, Number.isFinite(made) ? `made ${new Date(made).toISOString().slice(0, 16).replace("T", " ")} UTC` : "no creation time");
  }
  if (crit.kind) add("kind", `A ${crit.kind} DTU`, f.tier === crit.kind, `is ${f.tier}`);
  if (crit.domain) add("domain", `In ${crit.domain}`, (f.domain || "").toLowerCase() === crit.domain, f.domain ? `is in ${f.domain}` : "no domain");
  if (crit.tags?.length) {
    const have = new Set(f.tags.map((t) => t.toLowerCase()));
    const missing = crit.tags.filter((t) => !have.has(t));
    add("tags", `Tagged ${crit.tags.join(", ")}`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "all present");
  }
  if (crit.minClaims) add("minClaims", `At least ${crit.minClaims} claims`, f.claims.length >= crit.minClaims, `${f.claims.length} claims`);
  if (crit.minWords) add("minWords", `At least ${crit.minWords} words`, f.words >= crit.minWords, `${f.words} words`);
  if (crit.mustCite) {
    let cites = f.parents.includes(crit.mustCite);
    if (!cites) { try { cites = getAncestorChain(db, dtu.id).some((a) => a.contentId === crit.mustCite); } catch { /* */ } }
    add("mustCite", "Cites the named DTU", cites, cites ? "cited" : "not cited");
  }
  if (crit.hasFile) add("hasFile", "Carries a file", !!f.file, f.file ? f.file.type || "file" : "no file");
  return { checks, passed: checks.every((c) => c.pass) };
}

// ── lifecycle ────────────────────────────────────────────────────────────

const parseTime = (s) => Date.parse(String(s).includes("T") ? s : `${String(s).replace(" ", "T")}Z`);

/** Return the reward on commissions nobody accepted in time. */
export function sweepExpired(db, now = Date.now()) {
  const rows = db.prepare("SELECT * FROM house_commissions WHERE status = 'open'").all();
  let n = 0;
  for (const c of rows) {
    if (parseTime(c.deadline) + ACCEPT_GRACE_DAYS * DAY > now) continue;
    const done = db.transaction(() => {
      const r = escrowMove(db, { from: ESCROW, to: c.poster_id, amount: c.escrow_held, refId: `house_commission_return:${c.id}`, metadata: { houseCommissionId: c.id, role: "escrow_return", reason: "expired" } });
      if (!r.ok) throw new Error(r.error);
      db.prepare("UPDATE house_commissions SET status = 'expired', refunded = ?, updated_at = datetime('now') WHERE id = ? AND status = 'open'").run(c.escrow_held, c.id);
      db.prepare("UPDATE house_commission_submissions SET status = 'declined', note = COALESCE(note, 'The request expired.'), updated_at = datetime('now') WHERE commission_id = ? AND status = 'submitted'").run(c.id);
    });
    try { done(); n++; } catch { /* leave it open; the next read retries */ }
  }
  return n;
}

function view(db, c, me) {
  const crit = JSON.parse(c.criteria_json || "{}");
  const subs = db.prepare("SELECT status, passed FROM house_commission_submissions WHERE commission_id = ? AND status != 'withdrawn'").all(c.id);
  const names = userNames(db, [c.poster_id]);
  const deadline = parseTime(c.deadline);
  return {
    id: c.id,
    title: c.title,
    brief: c.brief,
    reward: c.reward,
    escrowHeld: c.escrow_held,
    creatorNet: calculateFee("MARKETPLACE_PURCHASE", c.escrow_held).net,
    criteria: crit,
    status: c.status,
    poster: { id: c.poster_id, name: names.get(c.poster_id) || null },
    mine: !!me && me === c.poster_id,
    deadline: new Date(deadline).toISOString(),
    acceptBy: new Date(deadline + ACCEPT_GRACE_DAYS * DAY).toISOString(),
    submissionsOpen: c.status === "open" && Date.now() < deadline,
    submissions: subs.length,
    passing: subs.filter((s) => s.passed && s.status === "submitted").length,
    createdAt: c.created_at,
    releasedNet: c.released_net,
    refunded: c.refunded,
  };
}

function subView(db, s, { full }) {
  const d = loadDtu(db, s.dtu_id);
  const f = d ? dtuFacts(d) : null;
  const names = userNames(db, [s.creator_id]);
  return {
    id: s.id,
    creator: { id: s.creator_id, name: names.get(s.creator_id) || null },
    dtu: f ? { id: s.dtu_id, title: f.title || "(untitled)", excerpt: f.summary.slice(0, 280), tier: f.tier, domain: f.domain, tags: f.tags, claims: f.claims.length, words: f.words } : { id: s.dtu_id, missing: true },
    checks: JSON.parse(s.checks_json || "[]"),
    passed: !!s.passed,
    status: s.status,
    note: s.note,
    createdAt: s.created_at,
    ...(full ? {} : {}),
  };
}

export function registerMarketBoard(registerLensAction) {
  const need = (ctx) => (ctx?.db ? null : { ok: false, error: "no_db" });

  /** Open requests. params: { q, domain, minReward, sort (reward|deadline|newest) }. */
  publicRead(registerLensAction, "market", "board-list", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    sweepExpired(db);
    const me = actorOf(ctx);
    const now = Date.now();
    let rows = db.prepare("SELECT * FROM house_commissions WHERE status = 'open' ORDER BY created_at DESC LIMIT 500").all()
      .filter((c) => parseTime(c.deadline) > now);
    const q = String(params.q || "").toLowerCase();
    if (q) rows = rows.filter((c) => `${c.title} ${c.brief}`.toLowerCase().includes(q));
    if (params.domain) rows = rows.filter((c) => (JSON.parse(c.criteria_json || "{}").domain || "") === String(params.domain).toLowerCase());
    if (params.minReward) rows = rows.filter((c) => c.reward >= Number(params.minReward));
    const sort = params.sort === "deadline" ? (a, b) => parseTime(a.deadline) - parseTime(b.deadline) : params.sort === "newest" ? (a, b) => String(b.created_at).localeCompare(String(a.created_at)) : (a, b) => b.reward - a.reward;
    rows.sort(sort);
    const list = rows.map((c) => view(db, c, me));
    return { ok: true, result: { commissions: list, total: list.length, escrowTotal: round2(list.reduce((s, c) => s + c.escrowHeld, 0)) } };
  });

  /** One request. The commissioner sees every submission; a creator sees their own. */
  publicRead(registerLensAction, "market", "board-get", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    sweepExpired(db);
    const me = actorOf(ctx);
    const c = db.prepare("SELECT * FROM house_commissions WHERE id = ?").get(String(params.id || ""));
    if (!c) return { ok: false, error: "commission_not_found" };
    const subs = db.prepare("SELECT * FROM house_commission_submissions WHERE commission_id = ? ORDER BY created_at ASC").all(c.id);
    const visible = me === c.poster_id ? subs.filter((s) => s.status !== "withdrawn") : subs.filter((s) => s.creator_id === me);
    return { ok: true, result: { commission: view(db, c, me), submissions: visible.map((s) => subView(db, s, { full: false })), balance: me ? getBalance(db, me).balance : null } };
  });

  /** Post a request and hold the reward in escrow. */
  registerLensAction("market", "board-post", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const title = String(params.title || "").trim();
    const brief = String(params.brief || "").trim();
    if (title.length < 3 || title.length > 120) return { ok: false, error: "invalid_title", message: "Give the request a title of 3 to 120 characters." };
    if (brief.length < 10 || brief.length > 4000) return { ok: false, error: "invalid_brief", message: "Describe what you want in 10 to 4,000 characters." };
    const reward = round2(Number(params.reward));
    if (!Number.isFinite(reward) || reward < 1 || reward > MAX_REWARD) return { ok: false, error: "invalid_reward", message: `The reward is 1 to ${MAX_REWARD.toLocaleString()} CC.` };
    const deadline = Date.parse(String(params.deadline || ""));
    const now = Date.now();
    if (!Number.isFinite(deadline) || deadline < now + 3_600_000 || deadline > now + 90 * DAY) return { ok: false, error: "invalid_deadline", message: "The deadline is between one hour and 90 days from now." };
    const norm = normaliseCriteria(params.criteria || {}, db);
    if (norm.error) return { ok: false, error: norm.error };
    const id = `hc_${randomUUID()}`;
    try {
      db.transaction(() => {
        const r = escrowMove(db, { from: me, to: ESCROW, amount: reward, refId: `house_commission_hold:${id}`, metadata: { houseCommissionId: id, role: "escrow_hold" } });
        if (!r.ok) throw Object.assign(new Error(r.error), { result: r });
        db.prepare(`INSERT INTO house_commissions (id, poster_id, title, brief, reward, escrow_held, hold_fee, criteria_json, status, deadline) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'open', ?)`)
          .run(id, me, title, brief, reward, reward, JSON.stringify(norm.criteria), new Date(deadline).toISOString());
      })();
    } catch (e) {
      if (e.result?.error === "insufficient_balance") return { ok: false, error: "insufficient_balance", message: `Posting holds ${reward} CC in escrow; your balance is ${e.result.balance} CC.` };
      throw e;
    }
    const c = db.prepare("SELECT * FROM house_commissions WHERE id = ?").get(id);
    return { ok: true, result: { commission: view(db, c, me), balance: getBalance(db, me).balance } };
  });

  /** Submit a DTU you made. The checks run now and are stored with it. */
  registerLensAction("market", "board-submit", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    sweepExpired(db);
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const c = db.prepare("SELECT * FROM house_commissions WHERE id = ?").get(String(params.commissionId || ""));
    if (!c) return { ok: false, error: "commission_not_found" };
    if (c.poster_id === me) return { ok: false, error: "own_commission", message: "You cannot fill your own request." };
    if (c.status !== "open" || parseTime(c.deadline) <= Date.now()) return { ok: false, error: "submissions_closed", message: "This request is no longer taking submissions." };
    const d = loadDtu(db, String(params.dtuId || ""));
    const why = unsellableReason(d, me);
    if (why) return { ok: false, error: why, message: { dtu_not_found: "That DTU could not be found.", not_owner: "Submit a DTU you made.", bought_copy: "A copy you bought cannot be submitted.", system_record: "System records cannot be submitted." }[why] };
    const active = db.prepare("SELECT COUNT(*) AS n FROM house_commission_submissions WHERE commission_id = ? AND creator_id = ? AND status = 'submitted'").get(c.id, me).n;
    if (active >= MAX_ACTIVE_SUBMISSIONS) return { ok: false, error: "too_many_submissions", message: `You can have ${MAX_ACTIVE_SUBMISSIONS} submissions open on one request.` };
    const { checks, passed } = runChecks(db, d, c, me);
    const id = `hs_${randomUUID()}`;
    const r = db.prepare(`INSERT OR IGNORE INTO house_commission_submissions (id, commission_id, creator_id, dtu_id, checks_json, passed, status, note) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)`)
      .run(id, c.id, me, d.id, JSON.stringify(checks), passed ? 1 : 0, String(params.note || "").slice(0, 500) || null);
    if (!r.changes) return { ok: false, error: "already_submitted", message: "That DTU is already submitted to this request." };
    return { ok: true, result: { submission: subView(db, db.prepare("SELECT * FROM house_commission_submissions WHERE id = ?").get(id), { full: false }) } };
  });

  /** Re-run the checks after changing the DTU. */
  registerLensAction("market", "board-recheck", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    const s = db.prepare("SELECT * FROM house_commission_submissions WHERE id = ?").get(String(params.submissionId || ""));
    if (!s || s.creator_id !== me) return { ok: false, error: "submission_not_found" };
    if (s.status !== "submitted") return { ok: false, error: "not_open" };
    const c = db.prepare("SELECT * FROM house_commissions WHERE id = ?").get(s.commission_id);
    const d = loadDtu(db, s.dtu_id);
    if (!d) return { ok: false, error: "dtu_not_found" };
    const { checks, passed } = runChecks(db, d, c, me);
    db.prepare("UPDATE house_commission_submissions SET checks_json = ?, passed = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(checks), passed ? 1 : 0, s.id);
    return { ok: true, result: { submission: subView(db, db.prepare("SELECT * FROM house_commission_submissions WHERE id = ?").get(s.id), { full: false }) } };
  });

  /** The commissioner accepts a passing submission: the creator is paid from escrow and the DTU is delivered. */
  registerLensAction("market", "board-accept", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    sweepExpired(db);
    const me = actorOf(ctx);
    const s = db.prepare("SELECT * FROM house_commission_submissions WHERE id = ?").get(String(params.submissionId || ""));
    if (!s) return { ok: false, error: "submission_not_found" };
    const c = db.prepare("SELECT * FROM house_commissions WHERE id = ?").get(s.commission_id);
    if (!c || c.poster_id !== me) return { ok: false, error: "not_commissioner" };
    if (c.status !== "open") return { ok: false, error: "commission_closed", message: "This request is already closed." };
    if (s.status !== "submitted") return { ok: false, error: "submission_not_open" };
    const d = loadDtu(db, s.dtu_id);
    if (!d) return { ok: false, error: "dtu_not_found" };
    const { checks, passed } = runChecks(db, d, c, s.creator_id); // run again: the DTU may have changed since it was submitted
    db.prepare("UPDATE house_commission_submissions SET checks_json = ?, passed = ? WHERE id = ?").run(JSON.stringify(checks), passed ? 1 : 0, s.id);
    if (!passed) return { ok: false, error: "checks_failed", message: "This submission no longer passes every check.", checks };
    let released;
    try {
      db.transaction(() => {
        const r = executeTransfer(db, { from: ESCROW, to: s.creator_id, amount: c.escrow_held, type: "MARKETPLACE_PURCHASE", metadata: { houseCommissionId: c.id, submissionId: s.id, role: "escrow_release" }, refId: `house_commission_release:${c.id}` });
        if (!r.ok) throw Object.assign(new Error(r.error), { result: r });
        released = { fee: r.fee ?? calculateFee("MARKETPLACE_PURCHASE", c.escrow_held).fee, net: r.net ?? calculateFee("MARKETPLACE_PURCHASE", c.escrow_held).net };
        const u = db.prepare("UPDATE house_commissions SET status = 'awarded', awarded_submission_id = ?, released_net = ?, released_fee = ?, updated_at = datetime('now') WHERE id = ? AND status = 'open'").run(s.id, released.net, released.fee, c.id);
        if (!u.changes) throw new Error("commission_closed");
        db.prepare("UPDATE house_commission_submissions SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(s.id);
        db.prepare("UPDATE house_commission_submissions SET status = 'declined', note = COALESCE(note, 'Another submission was accepted.'), updated_at = datetime('now') WHERE commission_id = ? AND id != ? AND status = 'submitted'").run(c.id, s.id);
      })();
    } catch (e) {
      if (e.message === "commission_closed") return { ok: false, error: "commission_closed" };
      if (e.result) return { ok: false, error: e.result.error || "release_failed" };
      throw e;
    }
    return { ok: true, result: { commissionId: c.id, submissionId: s.id, paid: released.net, fee: released.fee, gross: c.escrow_held } };
  });

  /** The commissioner declines a submission, with a note to the creator. */
  registerLensAction("market", "board-decline", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    const s = db.prepare("SELECT s.*, c.poster_id FROM house_commission_submissions s JOIN house_commissions c ON c.id = s.commission_id WHERE s.id = ?").get(String(params.submissionId || ""));
    if (!s || s.poster_id !== me) return { ok: false, error: "not_commissioner" };
    if (s.status !== "submitted") return { ok: false, error: "submission_not_open" };
    db.prepare("UPDATE house_commission_submissions SET status = 'declined', note = ?, updated_at = datetime('now') WHERE id = ?").run(String(params.note || "").trim().slice(0, 500) || null, s.id);
    return { ok: true, result: { submissionId: s.id, status: "declined" } };
  });

  /** A creator withdraws their own submission. */
  registerLensAction("market", "board-withdraw", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    const s = db.prepare("SELECT * FROM house_commission_submissions WHERE id = ?").get(String(params.submissionId || ""));
    if (!s || s.creator_id !== me) return { ok: false, error: "submission_not_found" };
    if (s.status !== "submitted") return { ok: false, error: "submission_not_open" };
    db.prepare("UPDATE house_commission_submissions SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?").run(s.id);
    return { ok: true, result: { submissionId: s.id, status: "withdrawn" } };
  });

  /** The commissioner cancels before accepting anything; the escrow returns in full. */
  registerLensAction("market", "board-cancel", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    const c = db.prepare("SELECT * FROM house_commissions WHERE id = ?").get(String(params.id || ""));
    if (!c || c.poster_id !== me) return { ok: false, error: "not_commissioner" };
    if (c.status !== "open") return { ok: false, error: "commission_closed" };
    db.transaction(() => {
      const r = escrowMove(db, { from: ESCROW, to: me, amount: c.escrow_held, refId: `house_commission_return:${c.id}`, metadata: { houseCommissionId: c.id, role: "escrow_return", reason: "cancelled" } });
      if (!r.ok) throw new Error(r.error);
      db.prepare("UPDATE house_commissions SET status = 'cancelled', refunded = ?, updated_at = datetime('now') WHERE id = ?").run(c.escrow_held, c.id);
      db.prepare("UPDATE house_commission_submissions SET status = 'declined', note = COALESCE(note, 'The request was cancelled.'), updated_at = datetime('now') WHERE commission_id = ? AND status = 'submitted'").run(c.id);
    })();
    return { ok: true, result: { id: c.id, status: "cancelled", refunded: c.escrow_held, balance: getBalance(db, me).balance } };
  });

  /** The caller's side of the board: requests they posted and work they submitted. */
  registerLensAction("market", "board-mine", (ctx) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    sweepExpired(db);
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const posted = db.prepare("SELECT * FROM house_commissions WHERE poster_id = ? ORDER BY created_at DESC LIMIT 200").all(me).map((c) => view(db, c, me));
    const subs = db.prepare(`SELECT s.*, c.title AS ctitle, c.reward, c.status AS cstatus FROM house_commission_submissions s JOIN house_commissions c ON c.id = s.commission_id WHERE s.creator_id = ? ORDER BY s.created_at DESC LIMIT 200`).all(me)
      .map((s) => ({ ...subView(db, s, { full: false }), commission: { id: s.commission_id, title: s.ctitle, reward: s.reward, status: s.cstatus } }));
    return { ok: true, result: { posted, submitted: subs } };
  });
}
