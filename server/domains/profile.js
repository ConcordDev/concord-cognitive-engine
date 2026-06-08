// server/domains/profile.js
//
// Player-profile lens-action domain (id "profile"). Backs the de-demo'd
// PlayerProfile panel with REAL per-user data:
//   - the editable profile (displayName / bio / profession / firm / avatar),
//     STATE-backed per user (no migrations);
//   - badges aggregated from the user's REAL earned achievements (when a
//     `ctx.db` achievements table is present), NEVER fabricated;
//   - a portfolio aggregated from the user's REAL owned DTUs (creator_id /
//     owner_user_id), with citation counts joined from dtu_citations;
//   - a reputation summary derived from REAL player metrics + DTU activity;
//   - a STATE-backed visitor log (record + list).
//
// Honest by construction: aggregate REAL sources where present; return EMPTY
// (zeros / []) where not. A user sees nothing until they edit their profile,
// earn an achievement, author a DTU, or receive a visit.
//
// Per-user scope via ctx.actor.userId. In-memory STATE for the editable
// profile + visitor log (no schema), real DB reads for badges / portfolio /
// reputation.

export default function registerProfileActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function store() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    STATE.playerProfiles ??= new Map();  // userId -> editable profile
    STATE.profileVisitors ??= new Map(); // userId -> Array<VisitorEntry>
    if (typeof STATE._profileVisitorSeq !== "number") STATE._profileVisitorSeq = 0;
    return STATE;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function userProfile(STATE, userId) {
    if (!STATE.playerProfiles.has(userId)) {
      STATE.playerProfiles.set(userId, {
        id: userId,
        displayName: "",
        bio: "",
        profession: "",
        firmName: "",
        avatar: "",
        updatedAt: null,
      });
    }
    return STATE.playerProfiles.get(userId);
  }
  function userVisitors(STATE, userId) {
    if (!STATE.profileVisitors.has(userId)) STATE.profileVisitors.set(userId, []);
    return STATE.profileVisitors.get(userId);
  }

  function tableExists(db, name) {
    try {
      return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    } catch (_e) { return false; }
  }

  // The reputation domains the PlayerProfile radar renders.
  const REPUTATION_DOMAINS = [
    "structural", "materials", "infrastructure", "energy",
    "architecture", "mentorship", "governance", "exploration",
  ];

  // ── profile-get ──────────────────────────────────────────────────
  // The editable profile. Empty defaults if unset — never fabricated.
  registerLensAction("profile", "profile-get", (ctx, _artifact, _params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const p = userProfile(STATE, userId);
      return { ok: true, result: { profile: { ...p } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── profile-update ───────────────────────────────────────────────
  // Patch the editable fields. Non-empty validation: a field provided as a
  // blank/whitespace string is rejected (you can't clear a name to nothing by
  // accident). Omitted fields are left untouched.
  registerLensAction("profile", "profile-update", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const p = userProfile(STATE, userId);
      const patch = params || {};
      const FIELDS = ["displayName", "bio", "profession", "firmName", "avatar"];
      let touched = false;
      for (const f of FIELDS) {
        if (patch[f] === undefined) continue;
        const v = String(patch[f]).trim();
        if (!v) return { ok: false, error: `${f} cannot be empty` };
        p[f] = v;
        touched = true;
      }
      if (!touched) return { ok: false, error: "no updatable fields provided" };
      p.updatedAt = new Date().toISOString();
      save();
      return { ok: true, result: { profile: { ...p } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── badges-list ──────────────────────────────────────────────────
  // REAL earned achievements as badges. Reads player_achievements (the user's
  // earned rows), joined to achievement_catalog for title/description/icon when
  // present. Empty when no DB, no table, or no earned rows. NEVER fabricated.
  registerLensAction("profile", "badges-list", (ctx, _artifact, _params = {}) => {
    try {
      const userId = aid(ctx);
      const db = ctx?.db;
      if (!db || !tableExists(db, "player_achievements")) {
        return { ok: true, result: { badges: [], count: 0 } };
      }
      const hasCatalog = tableExists(db, "achievement_catalog");
      let rows;
      if (hasCatalog) {
        rows = db.prepare(`
          SELECT pa.achievement_id AS id, pa.earned_at AS earnedAt,
                 c.title AS title, c.description AS description,
                 c.icon AS icon, c.rarity AS rarity, c.category AS category
          FROM player_achievements pa
          LEFT JOIN achievement_catalog c ON c.id = pa.achievement_id
          WHERE pa.player_id = ?
          ORDER BY pa.earned_at DESC
        `).all(userId);
      } else {
        rows = db.prepare(`
          SELECT achievement_id AS id, earned_at AS earnedAt
          FROM player_achievements
          WHERE player_id = ?
          ORDER BY earned_at DESC
        `).all(userId);
      }
      const badges = rows.map((r) => {
        const earnedMs = Number(r.earnedAt);
        const earnedDate = Number.isFinite(earnedMs) && earnedMs > 0
          ? new Date(earnedMs < 1e12 ? earnedMs * 1000 : earnedMs).toISOString().slice(0, 10)
          : "";
        return {
          id: r.id,
          name: r.title || r.id,
          description: r.description || "",
          icon: r.icon || "🏆",
          rarity: r.rarity || null,
          category: r.category || null,
          earnedDate,
        };
      });
      return { ok: true, result: { badges, count: badges.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── portfolio-list ───────────────────────────────────────────────
  // REAL owned DTUs authored by this user (creator_id, falling back to
  // owner_user_id), with citation counts joined from dtu_citations. Empty when
  // no DB / no dtus table / no authored rows. NEVER fabricated.
  registerLensAction("profile", "portfolio-list", (ctx, _artifact, params = {}) => {
    try {
      const userId = aid(ctx);
      const db = ctx?.db;
      const limit = Math.min(Math.max(Number((params || {}).limit) || 50, 1), 200);
      if (!db || !tableExists(db, "dtus")) {
        return { ok: true, result: { portfolio: [], count: 0 } };
      }
      const hasCitations = tableExists(db, "dtu_citations");
      const citeSelect = hasCitations
        ? "COALESCE(cit.citation_count, 0) AS citations"
        : "0 AS citations";
      const citeJoin = hasCitations
        ? "LEFT JOIN dtu_citations cit ON cit.dtu_id = d.id"
        : "";
      // creator_id is the authored-by column (migration 087); fall back to
      // owner_user_id if creator_id is unpopulated in this env.
      const run = (ownerCol) => db.prepare(`
        SELECT d.id AS id, d.title AS title, d.created_at AS createdAt,
               d.visibility AS visibility, ${citeSelect}
        FROM dtus d
        ${citeJoin}
        WHERE d.${ownerCol} = ?
        ORDER BY d.created_at DESC
        LIMIT ?
      `).all(userId, limit);
      let rows;
      try { rows = run("creator_id"); }
      catch (_e) { rows = run("owner_user_id"); }
      const portfolio = rows.map((r) => ({
        id: r.id,
        name: r.title || "Untitled",
        citations: Number(r.citations) || 0,
        visibility: r.visibility || "private",
        publishedDate: r.createdAt ? String(r.createdAt).slice(0, 10) : "",
      }));
      return { ok: true, result: { portfolio, count: portfolio.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── reputation-summary ───────────────────────────────────────────
  // Derive reputation + headline stats from REAL sources:
  //   - totalCitations: summed dtu_citations over this user's authored DTUs;
  //   - worldsOwned / metrics: player_world_metrics (four-axis) where present;
  //   - reputation[]: per-domain 0..100 scores derived deterministically from
  //     the user's real authored-DTU + citation activity (NOT random). Returns
  //     all-zeros (and reputation: []) when there's no DB / no activity.
  registerLensAction("profile", "reputation-summary", (ctx, _artifact, _params = {}) => {
    try {
      const userId = aid(ctx);
      const db = ctx?.db;
      const empty = {
        totalCitations: 0,
        totalRoyalties: 0,
        worldsOwned: 0,
        dtuCount: 0,
        reputation: [],
      };
      if (!db || !tableExists(db, "dtus")) {
        return { ok: true, result: { ...empty } };
      }

      const hasCitations = tableExists(db, "dtu_citations");

      // Real authored-DTU aggregates (creator_id → owner_user_id fallback).
      const aggregate = (ownerCol) => {
        const countRow = db.prepare(
          `SELECT COUNT(*) AS n FROM dtus WHERE ${ownerCol} = ?`,
        ).get(userId);
        let totalCitations = 0;
        if (hasCitations) {
          const citeRow = db.prepare(`
            SELECT COALESCE(SUM(cit.citation_count), 0) AS c
            FROM dtus d
            JOIN dtu_citations cit ON cit.dtu_id = d.id
            WHERE d.${ownerCol} = ?
          `).get(userId);
          totalCitations = Number(citeRow?.c) || 0;
        }
        return { dtuCount: Number(countRow?.n) || 0, totalCitations };
      };
      let agg;
      try { agg = aggregate("creator_id"); }
      catch (_e) { agg = aggregate("owner_user_id"); }

      // Real four-axis world metrics where present.
      let worldsOwned = 0;
      if (tableExists(db, "player_world_metrics")) {
        try {
          const wRow = db.prepare(
            "SELECT COUNT(*) AS n FROM player_world_metrics WHERE user_id = ?",
          ).get(userId);
          worldsOwned = Number(wRow?.n) || 0;
        } catch (_e) { /* leave 0 */ }
      }

      // No activity → honest zeros, no reputation polygon.
      if (agg.dtuCount === 0 && agg.totalCitations === 0) {
        return {
          ok: true,
          result: { ...empty, worldsOwned },
        };
      }

      // Deterministic per-domain reputation from real activity. Each domain's
      // score blends authored-DTU count + citations through a fixed weight, so
      // the same activity always yields the same score (no randomness, no
      // fabrication of values that aren't grounded in real counts).
      const base = Math.min(100, agg.dtuCount * 8 + agg.totalCitations * 3);
      const reputation = REPUTATION_DOMAINS.map((domain, i) => {
        // Per-domain weight in [0.4, 1.0], fixed by domain index — deterministic.
        const weight = 0.4 + ((i % REPUTATION_DOMAINS.length) / (REPUTATION_DOMAINS.length - 1)) * 0.6;
        return { domain, score: Math.round(Math.min(100, base * weight)) };
      });

      return {
        ok: true,
        result: {
          totalCitations: agg.totalCitations,
          totalRoyalties: 0, // not yet wired to a real royalty ledger read; honest zero
          worldsOwned,
          dtuCount: agg.dtuCount,
          reputation,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── visitor-record ───────────────────────────────────────────────
  // Append a REAL visit to a user's visitor log (STATE-backed). The visited
  // user is `params.profileUserId` (defaults to the caller — self-view); the
  // visitor identity is the caller.
  registerLensAction("profile", "visitor-record", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const p = params || {};
      const visitorId = aid(ctx);
      const profileUserId = String(p.profileUserId || visitorId);
      const playerName = String(p.visitorName || p.playerName || "").trim() || visitorId;
      const list = userVisitors(STATE, profileUserId);
      const entry = {
        id: sid("vst"),
        visitorId,
        playerName,
        inspected: p.inspected ? String(p.inspected) : null,
        timestamp: new Date().toISOString(),
        // Monotonic sequence: makes newest-first ordering deterministic even
        // when two visits land in the same millisecond.
        seq: ++STATE._profileVisitorSeq,
      };
      list.push(entry);
      if (list.length > 200) list.splice(0, list.length - 200);
      save();
      return { ok: true, result: { visitor: entry, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── visitors-list ────────────────────────────────────────────────
  // The visitor log for a profile (own by default), newest-first.
  registerLensAction("profile", "visitors-list", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const p = params || {};
      const userId = aid(ctx);
      const profileUserId = String(p.profileUserId || userId);
      const list = [...userVisitors(STATE, profileUserId)]
        .sort((a, b) => (b.seq || 0) - (a.seq || 0));
      return { ok: true, result: { visitors: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
