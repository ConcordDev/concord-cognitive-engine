// server/domains/market-showcase.js
//
// The hourly showcase: the Auction House's front window, filled by lot, never
// by an algorithm. Rules (owner-approved, 2026-11-19):
//
//   • Any creator with at least one active lot may enter for the NEXT hour.
//     Entries for an hour close when that hour begins, and are final (no
//     leaving and re-entering to steer the draw).
//   • Who has entered is not shown until the draw (only how many have), so
//     nobody can compute the outcome before entries close.
//   • At the hour the draw runs once and is stored. Six are drawn. A creator
//     drawn in the 24 hours before cannot win again (they are listed as
//     excluded, with the reason), and an entrant with no active lot left at
//     draw time is excluded too.
//   • seed  = sha256("concord-house-showcase/1|" + hour + "|" + previousSeed + "|" + eligible ids joined by ",")
//     score = sha256(seed + "|" + userId); the six lowest scores win.
//     Everything needed to redo it (hour, previous seed, eligible list) is
//     published with the result. Sales, ratings and popularity play no part.

import { createHash } from "node:crypto";
import { publicRead, actorOf, activeLotsBySeller, cardsFor, userNames } from "./market-house.js";

export const WINNERS_PER_HOUR = 6;
export const COOLDOWN_HOURS = 24;
const HOUR = 3_600_000;
const GENESIS = "genesis";

export const hourKey = (t) => new Date(t).toISOString().slice(0, 13);
const hourStart = (key) => Date.parse(`${key}:00:00.000Z`);
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** The draw, as a pure function, so a test (or a reader) can redo it. */
export function drawWinners(hour, prevSeed, eligible, n = WINNERS_PER_HOUR) {
  const ids = [...new Set(eligible.map(String))].sort();
  const seed = sha(`concord-house-showcase/1|${hour}|${prevSeed}|${ids.join(",")}`);
  const ranked = ids.map((id) => ({ id, score: sha(`${seed}|${id}`) })).sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0));
  return { seed, ids, ranked, winners: ranked.slice(0, n).map((r) => r.id) };
}

function hasActiveLot(db, userId) {
  try { return !!db.prepare("SELECT 1 FROM marketplace_economy_listings WHERE seller_id = ? AND status = 'active' LIMIT 1").get(userId); } catch { return false; }
}

/** Hours (keys) in which this user was drawn, within `hours` before `beforeKey`. */
function recentWins(db, beforeKey, hours = COOLDOWN_HOURS) {
  const from = hourKey(hourStart(beforeKey) - hours * HOUR);
  const rows = db.prepare("SELECT hour_key, winners_json FROM house_showcase_draws WHERE hour_key >= ? AND hour_key < ?").all(from, beforeKey);
  const out = new Map();
  for (const r of rows) for (const id of JSON.parse(r.winners_json || "[]")) if (!out.has(id) || out.get(id) < r.hour_key) out.set(id, r.hour_key);
  return out;
}

/** Run the draw for an hour that has begun, once. */
export function ensureDraw(db, key, now = Date.now()) {
  if (hourStart(key) > now) return null;
  const existing = db.prepare("SELECT * FROM house_showcase_draws WHERE hour_key = ?").get(key);
  if (existing) return existing;
  const prev = db.prepare("SELECT seed FROM house_showcase_draws WHERE hour_key < ? ORDER BY hour_key DESC LIMIT 1").get(key);
  const prevSeed = prev?.seed || GENESIS;
  const entrants = db.prepare("SELECT user_id FROM house_showcase_entries WHERE hour_key = ? ORDER BY user_id").all(key).map((r) => r.user_id);
  const wins = recentWins(db, key);
  const excluded = [];
  const eligible = [];
  for (const id of entrants) {
    if (wins.has(id)) excluded.push({ id, reason: "won_recently", wonAt: wins.get(id) });
    else if (!hasActiveLot(db, id)) excluded.push({ id, reason: "no_active_lot" });
    else eligible.push(id);
  }
  const { seed, winners } = drawWinners(key, prevSeed, eligible);
  db.prepare(`INSERT OR IGNORE INTO house_showcase_draws (hour_key, seed, prev_seed, entrants_json, excluded_json, winners_json, drawn_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(key, seed, prevSeed, JSON.stringify(eligible), JSON.stringify(excluded), JSON.stringify(winners), new Date(now).toISOString());
  return db.prepare("SELECT * FROM house_showcase_draws WHERE hour_key = ?").get(key);
}

function drawView(db, row) {
  if (!row) return null;
  const winners = JSON.parse(row.winners_json || "[]");
  const eligible = JSON.parse(row.entrants_json || "[]");
  const excluded = JSON.parse(row.excluded_json || "[]");
  const names = userNames(db, [...winners, ...eligible, ...excluded.map((e) => e.id)]);
  return {
    hour: row.hour_key,
    seed: row.seed,
    prevSeed: row.prev_seed,
    eligible: eligible.map((id) => ({ id, name: names.get(id) || null })),
    excluded: excluded.map((e) => ({ ...e, name: names.get(e.id) || null })),
    winners: winners.map((id) => ({ id, name: names.get(id) || null, lots: cardsFor(db, activeLotsBySeller(db, id, 3)) })),
    drawnAt: row.drawn_at,
  };
}

export function registerMarketShowcase(registerLensAction) {
  /** This hour's window, the coming hour's entry state, and the caller's standing. */
  publicRead(registerLensAction, "market", "house-showcase", (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const now = Date.now();
    const cur = hourKey(now);
    const next = hourKey(now + HOUR);
    const current = drawView(db, ensureDraw(db, cur, now));
    const me = actorOf(ctx);
    const nextCount = db.prepare("SELECT COUNT(*) AS n FROM house_showcase_entries WHERE hour_key = ?").get(next).n;
    let standing = null;
    if (me) {
      const entered = !!db.prepare("SELECT 1 FROM house_showcase_entries WHERE hour_key = ? AND user_id = ?").get(next, me);
      const wins = recentWins(db, next);
      const lastWin = wins.get(me) || null;
      const active = hasActiveLot(db, me);
      standing = {
        entered,
        hasActiveLot: active,
        lastWin,
        eligibleAgainAt: lastWin ? new Date(hourStart(lastWin) + (COOLDOWN_HOURS + 1) * HOUR).toISOString() : null,
        canEnter: !entered && active && !lastWin,
        reason: entered ? "entered" : !active ? "no_active_lot" : lastWin ? "won_recently" : null,
      };
    }
    const recent = db.prepare("SELECT * FROM house_showcase_draws WHERE hour_key < ? ORDER BY hour_key DESC LIMIT 6").all(cur)
      .map((r) => ({ hour: r.hour_key, seed: r.seed, winners: JSON.parse(r.winners_json).length, eligible: JSON.parse(r.entrants_json).length }));
    return {
      ok: true,
      result: {
        rules: { winnersPerHour: WINNERS_PER_HOUR, cooldownHours: COOLDOWN_HOURS, formula: "seed = sha256(\"concord-house-showcase/1|\" + hour + \"|\" + previousSeed + \"|\" + eligible ids sorted, joined by \",\"); score = sha256(seed + \"|\" + id); lowest six scores win" },
        current,
        next: { hour: next, opensAt: new Date(hourStart(next)).toISOString(), entrants: nextCount },
        standing,
        recent,
        now: new Date(now).toISOString(),
      },
    };
  });

  /** A past drawing in full, for re-checking. */
  publicRead(registerLensAction, "market", "house-showcase-draw", (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const key = String(params.hour || "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key)) return { ok: false, error: "invalid_hour" };
    const row = db.prepare("SELECT * FROM house_showcase_draws WHERE hour_key = ?").get(key);
    if (!row) return { ok: false, error: "no_draw" };
    return { ok: true, result: drawView(db, row) };
  });

  /** Enter the coming hour. Final once made. */
  registerLensAction("market", "house-showcase-enter", (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const now = Date.now();
    const next = hourKey(now + HOUR);
    if (!hasActiveLot(db, me)) return { ok: false, error: "no_active_lot", message: "Consign at least one lot before entering the showcase." };
    const lastWin = recentWins(db, next).get(me);
    if (lastWin) return { ok: false, error: "won_recently", message: `You were drawn at ${lastWin.slice(11)}:00 UTC on ${lastWin.slice(0, 10)}. You can be drawn again from ${new Date(hourStart(lastWin) + (COOLDOWN_HOURS + 1) * HOUR).toISOString().slice(0, 13).replace("T", " ")}:00 UTC.` };
    const r = db.prepare("INSERT OR IGNORE INTO house_showcase_entries (hour_key, user_id) VALUES (?, ?)").run(next, me);
    if (!r.changes) return { ok: false, error: "already_entered", message: "You are already entered for the coming hour." };
    const entrants = db.prepare("SELECT COUNT(*) AS n FROM house_showcase_entries WHERE hour_key = ?").get(next).n;
    return { ok: true, result: { hour: next, entrants, drawsAt: new Date(hourStart(next)).toISOString() } };
  });
}
