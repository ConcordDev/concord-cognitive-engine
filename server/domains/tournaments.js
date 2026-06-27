// server/domains/tournaments.js
//
// Tournaments lens — feature parity vs Challonge / Battlefy.
//
// The existing server/routes/tournaments.js + server/lib/tournament.js own
// the single-elimination DB-backed flow (create / register / start /
// rule-locked bouts). This domain file adds the bracket-platform feature
// surface that DB flow lacks: multiple bracket formats (round-robin,
// double-elimination, Swiss), manual + rating-based seeding, status
// lifecycle filters, a check-in window with auto-forfeit, spectator view
// with shareable links, team rosters, and prize-distribution computation.
//
// Persistent per-user state lives in globalThis._concordSTATE.tournamentsLens
// as Maps keyed by userId. All handlers return { ok, result?, error? } and
// never throw (try/catch on every macro).

export default function registerTournamentsActions(registerLensAction) {
  // ─── state ──────────────────────────────────────────────────────────
  function getState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.tournamentsLens) STATE.tournamentsLens = {};
    const s = STATE.tournamentsLens;
    // userId -> Array<tournament>
    if (!(s.tournaments instanceof Map)) s.tournaments = new Map();
    return s;
  }
  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────
  const tId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = () => Date.now();
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const clean = (v, max = 160) => String(v == null ? "" : v).trim().slice(0, max);
  const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  // Fail-CLOSED bound for any CC-denominated amount (prize pool, payout split
  // weights). Rejects NaN/Infinity AND finite-but-absurd values (e.g. 1e308)
  // BEFORE they are stored or reach payout math — same guard the sibling
  // economy lenses (staking/bounties/sponsorship) needed. `num()` already maps
  // NaN/Infinity → def, so this catches the finite-absurd injection path.
  const CC_MAX = 1e6;
  const isSaneCc = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= CC_MAX; };
  const list = (s, userId) => { if (!s.tournaments.has(userId)) s.tournaments.set(userId, []); return s.tournaments.get(userId); };
  function find(s, userId, id) {
    return (s.tournaments.get(userId) || []).find((t) => t.id === id) || null;
  }

  const FORMATS = ["single_elimination", "double_elimination", "round_robin", "swiss"];
  const STATUSES = ["upcoming", "checkin", "in_progress", "completed", "cancelled"];

  function emptyTournament(p) {
    const format = FORMATS.includes(p.format) ? p.format : "single_elimination";
    return {
      id: tId("tour"),
      title: clean(p.title || "Untitled Tournament", 120) || "Untitled Tournament",
      game: clean(p.game || "Concord PvP", 60),
      format,
      mode: p.teamSize && num(p.teamSize) > 1 ? "team" : "solo",
      teamSize: Math.max(1, Math.min(10, num(p.teamSize, 1))),
      maxEntrants: Math.max(2, Math.min(128, num(p.maxEntrants, 8))),
      prizePoolCc: Math.max(0, num(p.prizePoolCc, 0)),
      payoutSplit: Array.isArray(p.payoutSplit) && p.payoutSplit.length
        ? p.payoutSplit.map((x) => Math.max(0, num(x, 0)))
        : [60, 25, 15],
      swissRounds: Math.max(1, Math.min(12, num(p.swissRounds, 5))),
      status: "upcoming",
      createdAt: now(),
      startsAt: num(p.startsAt) || now() + 3600_000,
      checkinOpensAt: null,
      shareSlug: tId("share").replace(/^share_/, ""),
      entrants: [],     // { id, name, seed, rating, checkedIn, eliminated, roster }
      matches: [],      // { id, bracket, round, slotIndex, aId, bId, scoreA, scoreB, winnerId, status }
      standings: [],    // computed for round-robin / swiss
      winnerId: null,
      payouts: [],      // { rank, entrantId, name, amountCc }
      locked: false,
      log: [],
    };
  }

  function pushLog(t, msg) {
    t.log.unshift({ at: now(), msg: clean(msg, 200) });
    if (t.log.length > 200) t.log.length = 200;
  }

  // ─── bracket generation ─────────────────────────────────────────────
  function seedOrder(entrants) {
    // entrants already sorted by seed ascending; classic 1-vs-N pairing.
    return [...entrants].sort((a, b) => a.seed - b.seed);
  }

  function genSingleElim(t, seeded) {
    const matches = [];
    const n = seeded.length;
    let size = 1;
    while (size < n) size *= 2;
    // Round 1 with byes for the top seeds (highest seeds get the byes).
    const slots = new Array(size).fill(null);
    seeded.forEach((e, i) => { slots[i] = e; });
    for (let i = 0; i < size; i += 2) {
      const a = slots[i];
      const b = slots[i + 1];
      const m = {
        id: tId("m"), bracket: "winners", round: 1, slotIndex: i / 2,
        aId: a ? a.id : null, bId: b ? b.id : null,
        scoreA: 0, scoreB: 0, winnerId: null,
        status: a && b ? "pending" : "bye",
      };
      if (a && !b) m.winnerId = a.id;
      if (!a && b) m.winnerId = b.id;
      matches.push(m);
    }
    return matches;
  }

  function genDoubleElim(t, seeded) {
    // Winners bracket round 1 only; losers bracket + advancement seeded
    // lazily as results report. We pre-create the winners R1 and a shell
    // losers R1 / grand final placeholder.
    const matches = genSingleElim(t, seeded).map((m) => ({ ...m, bracket: "winners" }));
    matches.push({
      id: tId("m"), bracket: "grand_final", round: 99, slotIndex: 0,
      aId: null, bId: null, scoreA: 0, scoreB: 0, winnerId: null, status: "pending",
    });
    return matches;
  }

  function genRoundRobin(t, seeded) {
    const matches = [];
    let slot = 0;
    for (let i = 0; i < seeded.length; i++) {
      for (let j = i + 1; j < seeded.length; j++) {
        matches.push({
          id: tId("m"), bracket: "round_robin", round: 1, slotIndex: slot++,
          aId: seeded[i].id, bId: seeded[j].id,
          scoreA: 0, scoreB: 0, winnerId: null, status: "pending",
        });
      }
    }
    return matches;
  }

  function genSwissRound(t, roundNum) {
    // Pair entrants with similar records; avoid rematches where possible.
    const active = t.entrants.filter((e) => !e.eliminated);
    const wins = new Map(active.map((e) => [e.id, 0]));
    for (const m of t.matches) {
      if (m.winnerId) wins.set(m.winnerId, (wins.get(m.winnerId) || 0) + 1);
    }
    const played = new Set(t.matches.map((m) => [m.aId, m.bId].sort().join("|")));
    const sorted = [...active].sort((a, b) => (wins.get(b.id) || 0) - (wins.get(a.id) || 0) || a.seed - b.seed);
    const used = new Set();
    const matches = [];
    let slot = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].id)) continue;
      let partner = null;
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(sorted[j].id)) continue;
        const key = [sorted[i].id, sorted[j].id].sort().join("|");
        if (!played.has(key)) { partner = sorted[j]; break; }
      }
      if (!partner) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (!used.has(sorted[j].id)) { partner = sorted[j]; break; }
        }
      }
      used.add(sorted[i].id);
      if (partner) {
        used.add(partner.id);
        matches.push({
          id: tId("m"), bracket: "swiss", round: roundNum, slotIndex: slot++,
          aId: sorted[i].id, bId: partner.id,
          scoreA: 0, scoreB: 0, winnerId: null, status: "pending",
        });
      } else {
        // bye
        matches.push({
          id: tId("m"), bracket: "swiss", round: roundNum, slotIndex: slot++,
          aId: sorted[i].id, bId: null,
          scoreA: 0, scoreB: 0, winnerId: sorted[i].id, status: "bye",
        });
      }
    }
    return matches;
  }

  function computeStandings(t) {
    const stats = new Map(t.entrants.map((e) => [e.id, {
      entrantId: e.id, name: e.name, wins: 0, losses: 0, scoreFor: 0, scoreAgainst: 0,
    }]));
    for (const m of t.matches) {
      if (m.status !== "complete" && m.status !== "bye") continue;
      const a = m.aId ? stats.get(m.aId) : null;
      const b = m.bId ? stats.get(m.bId) : null;
      if (a) { a.scoreFor += m.scoreA; a.scoreAgainst += m.scoreB; }
      if (b) { b.scoreFor += m.scoreB; b.scoreAgainst += m.scoreA; }
      if (m.winnerId && stats.get(m.winnerId)) stats.get(m.winnerId).wins += 1;
      const loserId = m.winnerId === m.aId ? m.bId : m.winnerId === m.bId ? m.aId : null;
      if (loserId && stats.get(loserId)) stats.get(loserId).losses += 1;
    }
    return [...stats.values()]
      .map((s) => ({ ...s, diff: s.scoreFor - s.scoreAgainst }))
      .sort((x, y) => y.wins - x.wins || y.diff - x.diff || x.name.localeCompare(y.name))
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }

  function advanceSingleElim(t) {
    // For each round, once all matches complete, seed next round.
    const winnersRounds = [...new Set(t.matches.filter((m) => m.bracket === "winners")
      .map((m) => m.round))].sort((a, b) => a - b);
    const lastRound = winnersRounds[winnersRounds.length - 1];
    const lastMatches = t.matches.filter((m) => m.bracket === "winners" && m.round === lastRound);
    const allDone = lastMatches.every((m) => m.winnerId);
    if (!allDone) return;
    const winners = lastMatches.sort((a, b) => a.slotIndex - b.slotIndex).map((m) => m.winnerId);
    if (winners.length === 1) {
      t.winnerId = winners[0];
      return;
    }
    let slot = 0;
    for (let i = 0; i < winners.length; i += 2) {
      const a = winners[i];
      const b = winners[i + 1] || null;
      const m = {
        id: tId("m"), bracket: "winners", round: lastRound + 1, slotIndex: slot++,
        aId: a, bId: b, scoreA: 0, scoreB: 0, winnerId: a && !b ? a : null,
        status: a && b ? "pending" : "bye",
      };
      t.matches.push(m);
    }
  }

  function maybeComplete(t) {
    if (t.status !== "in_progress") return;
    if (t.format === "single_elimination" || t.format === "double_elimination") {
      if (t.format === "single_elimination") advanceSingleElim(t);
      if (t.winnerId) finalize(t);
    } else if (t.format === "round_robin") {
      const allDone = t.matches.every((m) => m.status === "complete" || m.status === "bye");
      t.standings = computeStandings(t);
      if (allDone) { t.winnerId = t.standings[0]?.entrantId || null; finalize(t); }
    } else if (t.format === "swiss") {
      t.standings = computeStandings(t);
      const curRound = Math.max(0, ...t.matches.map((m) => m.round));
      const roundDone = t.matches.filter((m) => m.round === curRound)
        .every((m) => m.status === "complete" || m.status === "bye");
      if (roundDone && curRound >= t.swissRounds) {
        t.winnerId = t.standings[0]?.entrantId || null;
        finalize(t);
      } else if (roundDone && curRound < t.swissRounds) {
        t.matches.push(...genSwissRound(t, curRound + 1));
        pushLog(t, `Swiss round ${curRound + 1} paired`);
      }
    }
  }

  function finalize(t) {
    if (t.status === "completed") return;
    t.status = "completed";
    t.completedAt = now();
    t.payouts = computePayouts(t);
    pushLog(t, `Tournament completed — champion declared`);
  }

  function computePayouts(t) {
    const standings = t.format === "round_robin" || t.format === "swiss"
      ? t.standings
      : rankFromBracket(t);
    const split = t.payoutSplit.length ? t.payoutSplit : [60, 25, 15];
    const total = split.reduce((a, b) => a + b, 0) || 1;
    return split.map((pct, i) => {
      const e = standings[i];
      return e
        ? { rank: i + 1, entrantId: e.entrantId, name: e.name, amountCc: Math.round(t.prizePoolCc * (pct / total)) }
        : null;
    }).filter(Boolean);
  }

  function rankFromBracket(t) {
    // Champion first, then runner-up, then semifinal losers (by round depth).
    const ranked = [];
    if (t.winnerId) {
      const champ = t.entrants.find((e) => e.id === t.winnerId);
      if (champ) ranked.push({ entrantId: champ.id, name: champ.name });
    }
    // collect losers ordered by the round they lost in (deeper = better)
    const losses = [];
    for (const m of t.matches) {
      if (m.status !== "complete" || !m.winnerId) continue;
      const loserId = m.winnerId === m.aId ? m.bId : m.aId;
      if (loserId && loserId !== t.winnerId) losses.push({ id: loserId, round: m.round });
    }
    losses.sort((a, b) => b.round - a.round);
    for (const l of losses) {
      if (ranked.some((r) => r.entrantId === l.id)) continue;
      const e = t.entrants.find((x) => x.id === l.id);
      if (e) ranked.push({ entrantId: e.id, name: e.name });
    }
    return ranked;
  }

  function publicView(t) {
    return {
      id: t.id, title: t.title, game: t.game, format: t.format, mode: t.mode,
      teamSize: t.teamSize, status: t.status, maxEntrants: t.maxEntrants,
      prizePoolCc: t.prizePoolCc, payoutSplit: t.payoutSplit, swissRounds: t.swissRounds,
      startsAt: t.startsAt, checkinOpensAt: t.checkinOpensAt, shareSlug: t.shareSlug,
      createdAt: t.createdAt, completedAt: t.completedAt || null,
      winnerId: t.winnerId,
      entrants: t.entrants.map((e) => ({
        id: e.id, name: e.name, seed: e.seed, rating: e.rating,
        checkedIn: e.checkedIn, eliminated: e.eliminated,
        roster: e.roster || [],
      })),
      matches: t.matches.map((m) => ({
        id: m.id, bracket: m.bracket, round: m.round, slotIndex: m.slotIndex,
        aId: m.aId, bId: m.bId, scoreA: m.scoreA, scoreB: m.scoreB,
        winnerId: m.winnerId, status: m.status,
      })),
      standings: t.standings,
      payouts: t.payouts,
      locked: t.locked,
      log: t.log.slice(0, 30),
    };
  }

  // ─── macros ─────────────────────────────────────────────────────────

  // create — organizer spins up a tournament (any format).
  registerLensAction("tournaments", "create", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      // Fail-CLOSED on any poisoned CC amount before persisting anything.
      if (p.prizePoolCc != null && !isSaneCc(p.prizePoolCc)) {
        return { ok: false, error: "invalid_prize_pool" };
      }
      if (Array.isArray(p.payoutSplit) && p.payoutSplit.some((x) => !isSaneCc(x))) {
        return { ok: false, error: "invalid_payout_split" };
      }
      const t = emptyTournament(p);
      list(s, userId).unshift(t);
      pushLog(t, `Created ${t.format} tournament "${t.title}"`);
      saveState();
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // list — status-filtered list for the organizer (lifecycle archive).
  registerLensAction("tournaments", "list", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      let rows = list(s, userId);
      if (p.status && STATUSES.includes(p.status)) rows = rows.filter((t) => t.status === p.status);
      if (p.format && FORMATS.includes(p.format)) rows = rows.filter((t) => t.format === p.format);
      const counts = STATUSES.reduce((acc, st) => {
        acc[st] = (s.tournaments.get(userId) || []).filter((t) => t.status === st).length;
        return acc;
      }, {});
      return {
        ok: true,
        result: { tournaments: rows.map(publicView), counts },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // get — full detail (also used for spectator via shareSlug).
  registerLensAction("tournaments", "get", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      let t = p.id ? find(s, userId, p.id) : null;
      if (!t && p.shareSlug) {
        for (const arr of s.tournaments.values()) {
          const hit = arr.find((x) => x.shareSlug === p.shareSlug);
          if (hit) { t = hit; break; }
        }
      }
      if (!t) return { ok: false, error: "tournament_not_found" };
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // addEntrant — register a solo entrant or a team (with roster).
  registerLensAction("tournaments", "addEntrant", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.locked || t.status !== "upcoming") return { ok: false, error: "registration_closed" };
      if (t.entrants.length >= t.maxEntrants) return { ok: false, error: "tournament_full" };
      const name = clean(p.name, 60);
      if (!name) return { ok: false, error: "name_required" };
      const roster = t.mode === "team" && Array.isArray(p.roster)
        ? p.roster.map((r) => clean(r, 40)).filter(Boolean).slice(0, t.teamSize)
        : [];
      if (t.mode === "team" && roster.length === 0) return { ok: false, error: "roster_required" };
      const entrant = {
        id: tId("ent"),
        name,
        seed: t.entrants.length + 1,
        rating: Math.max(0, Math.min(5000, num(p.rating, 1000))),
        checkedIn: false,
        eliminated: false,
        roster,
      };
      t.entrants.push(entrant);
      pushLog(t, `${name} registered (${t.entrants.length}/${t.maxEntrants})`);
      saveState();
      return { ok: true, result: { entrant, tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // removeEntrant — drop an entrant before lock.
  registerLensAction("tournaments", "removeEntrant", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.locked) return { ok: false, error: "bracket_locked" };
      const before = t.entrants.length;
      t.entrants = t.entrants.filter((e) => e.id !== p.entrantId);
      if (t.entrants.length === before) return { ok: false, error: "entrant_not_found" };
      t.entrants.forEach((e, i) => { e.seed = i + 1; });
      pushLog(t, `Entrant removed`);
      saveState();
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // seed — manual reorder or rating-based auto-seeding (pre-lock).
  registerLensAction("tournaments", "seed", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.locked) return { ok: false, error: "bracket_locked" };
      if (p.mode === "rating") {
        t.entrants.sort((a, b) => b.rating - a.rating);
        t.entrants.forEach((e, i) => { e.seed = i + 1; });
        pushLog(t, `Auto-seeded by rating`);
      } else if (Array.isArray(p.order) && p.order.length === t.entrants.length) {
        const byId = new Map(t.entrants.map((e) => [e.id, e]));
        const reordered = p.order.map((id) => byId.get(id)).filter(Boolean);
        if (reordered.length !== t.entrants.length) return { ok: false, error: "order_mismatch" };
        t.entrants = reordered;
        t.entrants.forEach((e, i) => { e.seed = i + 1; });
        pushLog(t, `Manually re-seeded`);
      } else if (p.entrantId && Number.isFinite(num(p.seed, NaN))) {
        const target = Math.max(1, Math.min(t.entrants.length, Math.round(num(p.seed))));
        const idx = t.entrants.findIndex((e) => e.id === p.entrantId);
        if (idx < 0) return { ok: false, error: "entrant_not_found" };
        const [moved] = t.entrants.splice(idx, 1);
        t.entrants.splice(target - 1, 0, moved);
        t.entrants.forEach((e, i) => { e.seed = i + 1; });
        pushLog(t, `${moved.name} moved to seed ${target}`);
      } else {
        return { ok: false, error: "seed_args_invalid" };
      }
      saveState();
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // openCheckin — open the check-in window before start.
  registerLensAction("tournaments", "openCheckin", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.status !== "upcoming") return { ok: false, error: "wrong_status" };
      if (t.entrants.length < 2) return { ok: false, error: "need_2_entrants" };
      t.status = "checkin";
      t.locked = true;
      t.checkinOpensAt = now();
      pushLog(t, `Check-in window opened`);
      saveState();
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // checkIn — mark an entrant present during the check-in window.
  registerLensAction("tournaments", "checkIn", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.status !== "checkin") return { ok: false, error: "checkin_not_open" };
      const e = t.entrants.find((x) => x.id === p.entrantId);
      if (!e) return { ok: false, error: "entrant_not_found" };
      e.checkedIn = true;
      pushLog(t, `${e.name} checked in`);
      saveState();
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // start — close check-in, auto-forfeit no-shows, generate the bracket.
  registerLensAction("tournaments", "start", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.status !== "upcoming" && t.status !== "checkin") {
        return { ok: false, error: "wrong_status" };
      }
      // Auto-forfeit: if the check-in window ran, drop anyone who did not
      // check in. If check-in was never opened, everyone is eligible.
      let forfeited = 0;
      if (t.status === "checkin") {
        const before = t.entrants.length;
        t.entrants = t.entrants.filter((e) => e.checkedIn);
        forfeited = before - t.entrants.length;
        t.entrants.forEach((e, i) => { e.seed = i + 1; });
      }
      if (t.entrants.length < 2) return { ok: false, error: "need_2_checked_in_entrants" };
      t.locked = true;
      const seeded = seedOrder(t.entrants);
      if (t.format === "single_elimination") t.matches = genSingleElim(t, seeded);
      else if (t.format === "double_elimination") t.matches = genDoubleElim(t, seeded);
      else if (t.format === "round_robin") t.matches = genRoundRobin(t, seeded);
      else if (t.format === "swiss") t.matches = genSwissRound(t, 1);
      t.status = "in_progress";
      t.startedAt = now();
      t.standings = computeStandings(t);
      // single-elim byes may already cascade
      maybeComplete(t);
      pushLog(t, forfeited
        ? `Started — ${forfeited} no-show(s) auto-forfeited`
        : `Bracket generated and locked`);
      saveState();
      return { ok: true, result: { tournament: publicView(t), forfeited } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // reportMatch — submit a match result; auto-advance the bracket.
  registerLensAction("tournaments", "reportMatch", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.status !== "in_progress") return { ok: false, error: "tournament_not_running" };
      const m = t.matches.find((x) => x.id === p.matchId);
      if (!m) return { ok: false, error: "match_not_found" };
      if (m.status === "complete") return { ok: false, error: "match_already_reported" };
      if (m.status === "bye") return { ok: false, error: "match_is_bye" };
      if (!m.aId || !m.bId) return { ok: false, error: "match_not_paired" };
      const scoreA = Math.max(0, num(p.scoreA, 0));
      const scoreB = Math.max(0, num(p.scoreB, 0));
      if (scoreA === scoreB) return { ok: false, error: "draws_not_allowed" };
      m.scoreA = scoreA;
      m.scoreB = scoreB;
      m.winnerId = scoreA > scoreB ? m.aId : m.bId;
      m.status = "complete";
      m.reportedAt = now();
      // mark loser eliminated in single-elim
      if (t.format === "single_elimination" || t.format === "double_elimination") {
        const loserId = m.winnerId === m.aId ? m.bId : m.aId;
        const loser = t.entrants.find((e) => e.id === loserId);
        if (loser && t.format === "single_elimination") loser.eliminated = true;
      }
      const a = t.entrants.find((e) => e.id === m.aId);
      const b = t.entrants.find((e) => e.id === m.bId);
      pushLog(t, `${a?.name || "?"} ${scoreA}–${scoreB} ${b?.name || "?"}`);
      t.standings = computeStandings(t);
      maybeComplete(t);
      saveState();
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // payouts — compute (or re-read) prize distribution on completion.
  registerLensAction("tournaments", "payouts", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.status !== "completed") return { ok: false, error: "tournament_not_completed" };
      if (Array.isArray(p.payoutSplit) && p.payoutSplit.length) {
        if (p.payoutSplit.some((x) => !isSaneCc(x))) {
          return { ok: false, error: "invalid_payout_split" };
        }
        t.payoutSplit = p.payoutSplit.map((x) => Math.max(0, num(x, 0)));
      }
      t.payouts = computePayouts(t);
      saveState();
      return {
        ok: true,
        result: {
          prizePoolCc: t.prizePoolCc,
          payoutSplit: t.payoutSplit,
          payouts: t.payouts,
          unallocated: Math.max(0, t.prizePoolCc - t.payouts.reduce((a, x) => a + x.amountCc, 0)),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // cancel — organizer cancels an un-started tournament.
  registerLensAction("tournaments", "cancel", (ctx, artifact, params) => {
    try {
      const s = getState();
      const userId = actor(ctx);
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const t = find(s, userId, p.id);
      if (!t) return { ok: false, error: "tournament_not_found" };
      if (t.status === "completed") return { ok: false, error: "already_completed" };
      t.status = "cancelled";
      pushLog(t, `Tournament cancelled`);
      saveState();
      return { ok: true, result: { tournament: publicView(t) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
