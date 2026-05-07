// server/routes/tournaments.js
//
// REST surface for the tournament toolkit. Player-organized brackets
// with rule-set enforcement (control-scheme lock, procedural-combo
// disable, hp cap, time limit) and CC prize-pool escrow.
//
// Routes:
//   POST   /api/tournaments           — create
//   GET    /api/tournaments?status=…  — list
//   GET    /api/tournaments/:id       — detail (entrants + bracket tree)
//   POST   /api/tournaments/:id/register   — join
//   POST   /api/tournaments/:id/start      — organizer kicks off
//   POST   /api/tournaments/:id/forfeit    — entrant withdraws
//   GET    /api/tournaments/:id/bracket    — bracket nodes only
//
// Bout-level routes go through training-match (existing). When a
// training-match's `tournament_bracket_id` is set, the match-end
// handler calls `completeBracket` to advance the winner.

import { Router } from "express";
import {
  createTournament,
  registerEntrant,
  startTournament,
  validateBoutRules,
  DEFAULT_RULES,
} from "../lib/tournament.js";

export default function createTournamentRouter({ requireAuth, db }) {
  const router = Router();

  // POST /api/tournaments
  router.post("/", requireAuth, (req, res) => {
    try {
      const { title, worldId, districtId, bracketKind, rules, maxEntrants, organizerSeedCC } = req.body || {};
      // Bound user-provided strings — pre-this-fix a 10MB title was
      // happily inserted and rendered to all viewers of the tournaments
      // lens, plus a malformed worldId could route into restricted
      // worlds. Trim defensively here even though the DB has no length
      // constraint; cheap and prevents DoS-via-title.
      const safeTitle    = String(title || "").slice(0, 120).trim();
      const safeWorldId  = String(worldId || "concordia-hub").slice(0, 64).trim();
      const safeDistrict = districtId ? String(districtId).slice(0, 64).trim() : null;
      if (!safeTitle) return res.status(400).json({ ok: false, error: "title_required" });
      const result = createTournament(db, {
        title: safeTitle,
        organizerId: req.user.id,
        worldId: safeWorldId,
        districtId: safeDistrict,
        bracketKind,
        rules,
        maxEntrants: Math.max(2, Math.min(64, Number(maxEntrants) || 8)),
        organizerSeedCC: Math.max(0, Number(organizerSeedCC) || 0),
      });
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/tournaments?status=open|in_progress|completed
  router.get("/", requireAuth, (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      const worldId = req.query.worldId ? String(req.query.worldId) : null;
      let sql = `SELECT * FROM tournaments WHERE 1=1`;
      const params = [];
      if (status) { sql += " AND status = ?"; params.push(status); }
      if (worldId) { sql += " AND world_id = ?"; params.push(worldId); }
      sql += " ORDER BY created_at DESC LIMIT 50";
      const rows = db.prepare(sql).all(...params);
      res.json({ ok: true, tournaments: rows.map((r) => ({ ...r, rules: JSON.parse(r.rules_json || "{}") })) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/tournaments/:id
  router.get("/:id", requireAuth, (req, res) => {
    try {
      const t = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(req.params.id);
      if (!t) return res.status(404).json({ ok: false, error: "tournament_not_found" });
      const entrants = db.prepare(`SELECT * FROM tournament_entrants WHERE tournament_id = ? ORDER BY seed`).all(req.params.id);
      const brackets = db.prepare(`SELECT * FROM tournament_brackets WHERE tournament_id = ? ORDER BY round_number, slot_index`).all(req.params.id);
      res.json({
        ok: true,
        tournament: { ...t, rules: JSON.parse(t.rules_json || "{}") },
        entrants,
        brackets,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/tournaments/:id/register
  router.post("/:id/register", requireAuth, (req, res) => {
    try {
      const result = registerEntrant(db, req.params.id, req.user.id);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/tournaments/:id/start
  router.post("/:id/start", requireAuth, (req, res) => {
    try {
      const result = startTournament(db, req.params.id, req.user.id);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/tournaments/:id/forfeit
  router.post("/:id/forfeit", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      db.prepare(`
        UPDATE tournament_entrants
        SET status = 'withdrew'
        WHERE tournament_id = ? AND user_id = ? AND status IN ('registered','active')
      `).run(req.params.id, userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/tournaments/:id/bracket
  router.get("/:id/bracket", requireAuth, (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM tournament_brackets WHERE tournament_id = ? ORDER BY round_number, slot_index`).all(req.params.id);
      res.json({ ok: true, bracket: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/tournaments/:id/validate-bout
  router.post("/:id/validate-bout", requireAuth, (req, res) => {
    try {
      const { bracketId, fighterAId, fighterBId, declaredScheme } = req.body || {};
      const result = validateBoutRules(db, bracketId, fighterAId, fighterBId, declaredScheme);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/tournaments/_defaults — exposed so the UI can prefill the
  // create-tournament form with the canonical default rules.
  router.get("/_defaults/rules", requireAuth, (_req, res) => {
    res.json({ ok: true, defaults: DEFAULT_RULES });
  });

  return router;
}
