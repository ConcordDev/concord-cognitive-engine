// server/domains/identity.js
//
// Universal Move System — verified-human badge macros. The world is
// indistinguishable by default; these let a player opt in and query status.
// (The actual human-verification challenge is the route layer's concern; this
// records the result + toggles display.)

import { verifyHuman, setBadgeVisible, statusFor, filterVerifiedHuman } from "../lib/verified-human.js";

export default function registerIdentityMacros(register) {
  register("identity", "verify_human", async (ctx) => {
    const db = ctx?.db; const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return verifyHuman(db, userId);
  }, { note: "record completion of the one-time human verification (opt-in badge)" });

  register("identity", "set_badge_visible", async (ctx, input = {}) => {
    const db = ctx?.db; const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return setBadgeVisible(db, userId, input.visible !== false);
  }, { note: "show/hide the verified-human badge (verified but private is allowed)" });

  register("identity", "status", async (ctx) => {
    const db = ctx?.db; const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    return statusFor(db, userId);
  }, { note: "this user's verified-human + badge-visibility state" });

  register("identity", "filter_verified", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, verified: filterVerifiedHuman(db, Array.isArray(input.userIds) ? input.userIds : []) };
  }, { note: "verified-human-only filter for trade/party/rally surfaces" });
}
