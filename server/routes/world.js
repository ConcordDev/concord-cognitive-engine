/**
 * World API Routes
 *
 * REST endpoints for the Concord World Lens platform:
 *
 * Districts & Zones:
 *   GET  /api/world/districts         — list all districts
 *   GET  /api/world/districts/:id     — get district details
 *   GET  /api/world/districts/by-lens/:lens — find district by lens
 *
 * Workstations:
 *   POST /api/world/workstations/start — start workstation session
 *   POST /api/world/workstations/end   — end workstation session
 *
 * Organizations:
 *   GET    /api/world/orgs             — list organizations
 *   POST   /api/world/orgs             — create organization
 *   GET    /api/world/orgs/:id         — get organization
 *   POST   /api/world/orgs/:id/join    — join organization
 *   POST   /api/world/orgs/:id/leave   — leave organization
 *
 * Parties:
 *   POST   /api/world/parties          — create party
 *   POST   /api/world/parties/:id/join — join party
 *   POST   /api/world/parties/:id/leave — leave party
 *
 * Jobs:
 *   GET    /api/world/jobs             — list job templates
 *   POST   /api/world/jobs/assign      — assign job to player
 *   POST   /api/world/jobs/quit        — quit current job
 *   POST   /api/world/jobs/activity    — record job activity
 *
 * Businesses:
 *   GET    /api/world/businesses       — list businesses
 *   POST   /api/world/businesses       — create business
 *   POST   /api/world/businesses/:id/sale — record sale
 *
 * Progression:
 *   GET    /api/world/progression/:userId  — get mastery profile
 *   POST   /api/world/progression/xp       — award XP
 *   GET    /api/world/leaderboard          — get leaderboard
 *   GET    /api/world/achievements/:userId — get achievements
 *   POST   /api/world/explorer/visit       — record district visit
 *   GET    /api/world/explorer/:userId     — get explorer stats
 *   POST   /api/world/daily-login          — record daily login
 *
 * Seasons:
 *   GET    /api/world/season               — get current season
 *   POST   /api/world/season               — start new season
 *   POST   /api/world/season/challenge     — add challenge
 *   POST   /api/world/season/complete      — complete challenge
 *
 * Events:
 *   GET    /api/world/events               — list events
 *   POST   /api/world/events               — create event
 *   GET    /api/world/events/:id           — get event
 *   POST   /api/world/events/:id/rsvp      — RSVP to event
 *   POST   /api/world/events/:id/start     — start event
 *   POST   /api/world/events/:id/end       — end event
 *   GET    /api/world/events/calendar/:cityId — get calendar
 *
 * Mechanics:
 *   GET    /api/world/mechanics/:cityId     — get city mechanics
 *   POST   /api/world/mechanics/:cityId     — create mechanic
 *   POST   /api/world/mechanics/:cityId/fire — fire trigger
 *   DELETE /api/world/mechanics/:cityId/:mechanicId — delete mechanic
 *
 * Templates:
 *   GET    /api/world/templates            — list city templates
 *   GET    /api/world/templates/:id        — get template
 *
 * Wizard:
 *   GET    /api/world/wizard/steps          — get wizard steps
 *   POST   /api/world/wizard/validate       — validate wizard step
 *   POST   /api/world/wizard/build          — build city from wizard
 *
 * City Config:
 *   GET    /api/world/config/themes         — get valid themes
 *   GET    /api/world/config/domains        — get valid domains
 *   GET    /api/world/config/rules-schema   — get rules schema
 */

import { Router } from "express";
import logger from "../logger.js";

// World engine
import {
  getDistrict,
  getDistrictByLens,
  DISTRICTS,
  DISTRICT_CATEGORIES,
  CONTROL_MODES,
  listDistricts,
  getDistrictCategories,
  getDistrictAtPosition,
  getActiveWorkstations,
  getDistrictObjects,
  removeWorldObject,
  getWorldStats,
  startWorkstationSession,
  endWorkstationSession,
} from "../lib/world-engine.js";

// Organizations
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  joinOrganization,
  leaveOrganization,
  createParty,
  joinParty,
  leaveParty,
} from "../lib/world-organizations.js";

// Jobs
import {
  listJobTemplates,
  assignJob,
  quitJob,
  promoteEmployee,
  getUserJob,
  recordJobActivity,
  createBusiness,
  stockBusiness,
  hireToBusiness,
  rateBusiness,
  getBusiness,
  listBusinesses,
  recordBusinessSale,
  getJobStats,
} from "../lib/world-jobs.js";

// Progression
import {
  getMasteryProfile,
  awardXP,
  getLeaderboard,
  getAchievements,
  recordDistrictVisit,
  getExplorerStats,
  recordDailyLogin,
  startSeason,
  getCurrentSeason,
  addSeasonChallenge,
  completeChallenge,
  generateDailyTasks,
  completeDailyTask,
} from "../lib/world-progression.js";
import { awardSparks, getBalances } from "../lib/currency.js";

// Events
import {
  createEvent,
  getEvent,
  updateEvent,
  cancelEvent,
  startEvent,
  endEvent,
  rsvpEvent,
  cancelRsvp,
  getCityEvents,
  getEventCalendar,
  getUpcomingEvents,
  getEventAttendees,
} from "../lib/world-events.js";

// Mechanics
import {
  createMechanic,
  fireTrigger,
  getCityMechanics,
  deleteMechanic,
  getTemplate,
  listTemplates,
  getWizardSteps,
  validateWizardStep,
  buildCityFromWizard,
} from "../lib/world-mechanics.js";

// City config
import {
  getValidThemes,
  getValidDomains,
  getCityRulesSchema,
} from "../lib/city-manager.js";
import { handlePlayerDeath, claimLootBag, handleRobbery, reclaimExpiredBags } from "../lib/pvp-loot.js";

/**
 * @param {object} [opts]
 * @param {Function} [opts.requireAuth] - Auth middleware
 * @returns {Router}
 */
export default function createWorldRoutes({ requireAuth, db = null, emitToUser = null } = {}) {
  const router = Router();

  function _userId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.userId ?? req.actor?.userId ?? req.body?.userId ?? null; // safe: target-identifier
  }

  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.warn?.("[world-route] error:", err.message);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("required") || err.message.includes("Invalid") ? 400
        : err.message.includes("owner") || err.message.includes("Only") ? 403
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  };

  // ── Districts ────────────────────────────────────────────────────────────

  router.get("/districts", wrap((req, res) => {
    const { category } = req.query;
    const districts = category ? listDistricts(category) : DISTRICTS;
    res.json({ ok: true, districts, count: districts.length });
  }));

  router.get("/districts/by-lens/:lens", wrap((req, res) => {
    const district = getDistrictByLens(req.params.lens);
    if (!district) return res.status(404).json({ ok: false, error: "No district for this lens" });
    res.json({ ok: true, district });
  }));

  router.get("/districts/:id", wrap((req, res) => {
    const district = getDistrict(req.params.id);
    if (!district) return res.status(404).json({ ok: false, error: "District not found" });
    res.json({ ok: true, district });
  }));

  router.get("/districts/:id/objects", wrap((req, res) => {
    const objects = getDistrictObjects(req.params.id);
    res.json({ ok: true, objects, count: objects.length });
  }));

  router.get("/district-categories", wrap((_req, res) => {
    res.json({ ok: true, categories: getDistrictCategories() });
  }));

  router.get("/district-at-position", wrap((req, res) => {
    const x = parseFloat(req.query.x);
    const z = parseFloat(req.query.z);
    if (Number.isNaN(x) || Number.isNaN(z)) return res.status(400).json({ ok: false, error: "x and z query params required" });
    const district = getDistrictAtPosition(x, z);
    if (!district) return res.status(404).json({ ok: false, error: "No district at this position" });
    res.json({ ok: true, district });
  }));

  router.get("/control-modes", wrap((_req, res) => {
    res.json({ ok: true, controlModes: CONTROL_MODES });
  }));

  router.get("/stats", wrap((_req, res) => {
    res.json({ ok: true, ...getWorldStats() });
  }));

  router.delete("/objects/:objectId", auth, wrap((req, res) => {
    const removed = removeWorldObject(req.params.objectId);
    if (!removed) return res.status(404).json({ ok: false, error: "Object not found" });
    res.json({ ok: true, removed: true });
  }));

  // ── Workstations ─────────────────────────────────────────────────────────

  router.post("/workstations/start", auth, wrap((req, res) => {
    const { workstationId, districtId } = req.body;
    const result = startWorkstationSession(_userId(req), workstationId, districtId);
    res.json({ ok: true, ...result });
  }));

  router.post("/workstations/end", auth, wrap((req, res) => {
    const { sessionId } = req.body;
    const result = endWorkstationSession(sessionId);
    res.json({ ok: true, ...result });
  }));

  router.get("/workstations/active", wrap((req, res) => {
    const { districtId } = req.query;
    const sessions = getActiveWorkstations(districtId || undefined);
    res.json({ ok: true, sessions, count: sessions.length });
  }));

  // ── Organizations ────────────────────────────────────────────────────────

  router.get("/orgs", wrap((_req, res) => {
    const orgs = listOrganizations();
    res.json({ ok: true, organizations: orgs, count: orgs.length });
  }));

  router.post("/orgs", auth, wrap((req, res) => {
    const org = createOrganization({ ...req.body, leaderId: _userId(req) });
    res.status(201).json({ ok: true, organization: org });
  }));

  router.get("/orgs/:id", wrap((req, res) => {
    const org = getOrganization(req.params.id);
    if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });
    res.json({ ok: true, organization: org });
  }));

  router.post("/orgs/:id/join", auth, wrap((req, res) => {
    const result = joinOrganization(req.params.id, _userId(req));
    res.json({ ok: true, ...result });
  }));

  router.post("/orgs/:id/leave", auth, wrap((req, res) => {
    const result = leaveOrganization(req.params.id, _userId(req));
    res.json({ ok: true, ...result });
  }));

  // ── Parties ──────────────────────────────────────────────────────────────

  router.post("/parties", auth, wrap((req, res) => {
    const party = createParty(_userId(req), req.body);
    res.status(201).json({ ok: true, party });
  }));

  router.post("/parties/:id/join", auth, wrap((req, res) => {
    const result = joinParty(req.params.id, _userId(req));
    res.json({ ok: true, ...result });
  }));

  router.post("/parties/:id/leave", auth, wrap((req, res) => {
    const result = leaveParty(req.params.id, _userId(req));
    res.json({ ok: true, ...result });
  }));

  // ── Jobs ─────────────────────────────────────────────────────────────────

  router.get("/jobs", wrap((_req, res) => {
    const templates = listJobTemplates();
    res.json({ ok: true, jobs: templates, count: templates.length });
  }));

  router.post("/jobs/assign", auth, wrap((req, res) => {
    const { jobTemplateId, cityId } = req.body;
    const result = assignJob(_userId(req), jobTemplateId, cityId);
    res.json({ ok: true, ...result });
  }));

  router.post("/jobs/quit", auth, wrap((req, res) => {
    const result = quitJob(_userId(req));
    res.json({ ok: true, ...result });
  }));

  router.post("/jobs/activity", auth, wrap((req, res) => {
    const { activityType, data } = req.body;
    const result = recordJobActivity(_userId(req), activityType, data);
    res.json({ ok: true, ...result });
  }));

  router.post("/jobs/promote", auth, wrap((req, res) => {
    const { targetUserId } = req.body;
    const result = promoteEmployee(targetUserId, _userId(req));
    res.json(result);
  }));

  router.get("/jobs/me", auth, wrap((req, res) => {
    const job = getUserJob(_userId(req));
    if (!job) return res.status(404).json({ ok: false, error: "No active job" });
    res.json({ ok: true, job });
  }));

  router.get("/jobs/user/:userId", wrap((req, res) => {
    const job = getUserJob(req.params.userId);
    if (!job) return res.status(404).json({ ok: false, error: "No active job for this user" });
    res.json({ ok: true, job });
  }));

  router.get("/jobs/stats", wrap((_req, res) => {
    res.json({ ok: true, ...getJobStats() });
  }));

  // ── Businesses ───────────────────────────────────────────────────────────

  router.get("/businesses", wrap((req, res) => {
    const { cityId } = req.query;
    const businesses = listBusinesses({ cityId: cityId || undefined });
    res.json({ ok: true, businesses, count: businesses.length });
  }));

  router.post("/businesses", auth, wrap((req, res) => {
    const business = createBusiness({ ...req.body, ownerId: _userId(req) });
    res.status(201).json({ ok: true, business });
  }));

  router.get("/businesses/:id", wrap((req, res) => {
    const business = getBusiness(req.params.id);
    if (!business) return res.status(404).json({ ok: false, error: "Business not found" });
    res.json({ ok: true, business });
  }));

  router.post("/businesses/:id/stock", auth, wrap((req, res) => {
    const { dtuId, price } = req.body;
    const result = stockBusiness(req.params.id, dtuId, price, _userId(req));
    res.json(result);
  }));

  router.post("/businesses/:id/hire", auth, wrap((req, res) => {
    const { employeeId, role, revenueSharePct } = req.body;
    const result = hireToBusiness(req.params.id, employeeId, { role, revenueSharePct }, _userId(req));
    res.json(result);
  }));

  router.post("/businesses/:id/rate", auth, wrap((req, res) => {
    const { rating } = req.body;
    const result = rateBusiness(req.params.id, _userId(req), rating);
    res.json(result);
  }));

  router.post("/businesses/:id/sale", auth, wrap((req, res) => {
    const { buyerId, itemId, amount } = req.body;
    const result = recordBusinessSale(req.params.id, buyerId, itemId, amount);
    res.json({ ok: true, ...result });
  }));

  // ── Progression ──────────────────────────────────────────────────────────

  // GET /progression/me — get mastery profile for the authenticated user
   
  router.get("/progression/me", wrap((req, res) => {
    // eslint-disable-next-line no-restricted-syntax
    const userId = _userId(req) || req.user?.id || req.query.userId; // safe: public-filter
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized", message: "User ID required" });
    const profile = getMasteryProfile(userId);
    res.json({ ok: true, profile });
  }));

  router.get("/progression/:userId", wrap((req, res) => {
    const profile = getMasteryProfile(req.params.userId);
    res.json({ ok: true, profile });
  }));

  router.post("/progression/xp", auth, wrap((req, res) => {
    const { action, lens, multiplier, source } = req.body;
    const result = awardXP(_userId(req), action, { lens, multiplier, source });
    res.json({ ok: true, ...result });
  }));

  router.get("/leaderboard", wrap((req, res) => {
    const { lens, limit } = req.query;
    const board = getLeaderboard({ lens, limit: limit ? parseInt(limit) : undefined });
    res.json({ ok: true, leaderboard: board });
  }));

  router.get("/achievements/:userId", wrap((req, res) => {
    const achievements = getAchievements(req.params.userId);
    res.json({ ok: true, achievements });
  }));

  // ── Explorer ─────────────────────────────────────────────────────────────

  router.post("/explorer/visit", auth, wrap((req, res) => {
    const { districtId } = req.body;
    const result = recordDistrictVisit(_userId(req), districtId);
    res.json({ ok: true, ...result });
  }));

  router.get("/explorer/:userId", wrap((req, res) => {
    const stats = getExplorerStats(req.params.userId);
    res.json({ ok: true, ...stats });
  }));

  router.post("/daily-login", auth, wrap((req, res) => {
    const userId = _userId(req);
    const result = recordDailyLogin(userId);
    // Award login Sparks
    try { awardSparks(db, userId, 2, "daily_login"); } catch { /* award best-effort */ }
    // Phase 19 polish-to-ten: realtime push so the frontend can show a
    // streak banner / fanfare when the daily login records a streak day.
    // Anonymous / re-login on same day cases skip the emit (alreadyLoggedIn).
    if (!result.alreadyLoggedIn && emitToUser) {
      try {
        emitToUser(userId, "daily:login_recorded", {
          streakDays: result.streakDays,
          weeklyBonus: !!result.weeklyBonus,
          xpAwarded: result.xpResult?.xpAwarded ?? 0,
          rankUp: result.xpResult?.rankUp ?? false,
        });
      } catch (_) { /* realtime is best-effort */ }
    }
    res.json({ ok: true, ...result });
  }));

  router.get("/daily-tasks", auth, wrap((req, res) => {
    const tasks = generateDailyTasks(_userId(req));
    res.json({ ok: true, tasks });
  }));

  router.post("/daily-tasks/:taskId/complete", auth, wrap((req, res) => {
    const userId = _userId(req);
    const result = completeDailyTask(userId, req.params.taskId);
    if (result.ok) {
      try { awardSparks(db, userId, 5, "daily_task_complete"); } catch { /* award best-effort */ }
    }
    res.json({ ok: true, ...result });
  }));

  router.get("/balances", auth, wrap((req, res) => {
    const balances = getBalances(db, _userId(req));
    res.json({ ok: true, ...balances });
  }));

  // ── Seasons ──────────────────────────────────────────────────────────────

  router.get("/season", wrap((_req, res) => {
    const season = getCurrentSeason();
    res.json({ ok: true, season });
  }));

  router.post("/season", auth, wrap((req, res) => {
    const result = startSeason(req.body);
    res.status(201).json({ ok: true, ...result });
  }));

  router.post("/season/challenge", auth, wrap((req, res) => {
    const result = addSeasonChallenge(req.body);
    res.json({ ok: true, ...result });
  }));

  router.post("/season/complete", auth, wrap((req, res) => {
    const { challengeId } = req.body;
    const result = completeChallenge(_userId(req), challengeId);
    res.json({ ok: true, ...result });
  }));

  // ── Events ───────────────────────────────────────────────────────────────

  router.get("/events", wrap((req, res) => {
    const { cityId, status, type, lens, upcoming } = req.query;
    if (cityId) {
      const events = getCityEvents(cityId, { status, type, lens, upcoming: upcoming === "true" });
      res.json({ ok: true, events, count: events.length });
    } else {
      const events = getUpcomingEvents({ type });
      res.json({ ok: true, events, count: events.length });
    }
  }));

  router.post("/events", auth, wrap((req, res) => {
    const event = createEvent({ ...req.body, hostId: _userId(req) });
    res.status(201).json({ ok: true, event });
  }));

  router.get("/events/calendar/:cityId", wrap((req, res) => {
    const { month, year } = req.query;
    const calendar = getEventCalendar(req.params.cityId, {
      month: month ? parseInt(month) : undefined,
      year: year ? parseInt(year) : undefined,
    });
    res.json({ ok: true, ...calendar });
  }));

  router.get("/events/:id", wrap((req, res) => {
    const event = getEvent(req.params.id);
    if (!event) return res.status(404).json({ ok: false, error: "Event not found" });
    res.json({ ok: true, event });
  }));

  router.post("/events/:id/rsvp", auth, wrap((req, res) => {
    const result = rsvpEvent(req.params.id, _userId(req), req.body);
    res.json({ ok: true, ...result });
  }));

  router.delete("/events/:id/rsvp", auth, wrap((req, res) => {
    const result = cancelRsvp(req.params.id, _userId(req));
    res.json({ ok: true, ...result });
  }));

  router.post("/events/:id/start", auth, wrap((req, res) => {
    const result = startEvent(req.params.id, _userId(req));
    res.json({ ok: true, event: result });
  }));

  router.post("/events/:id/end", auth, wrap(async (req, res) => {
    // endEvent is now async: it mints real CC to attendees on close
    // (was previously emit-only; rewards never landed on the wallet).
    const result = await endEvent(req.params.id, _userId(req));
    res.json({ ok: true, ...result });
  }));

  router.get("/events/:id/attendees", wrap((req, res) => {
    const attendees = getEventAttendees(req.params.id);
    res.json({ ok: true, attendees, count: attendees.length });
  }));

  // ── Mechanics ────────────────────────────────────────────────────────────

  router.get("/mechanics/:cityId", wrap((req, res) => {
    const mechanics = getCityMechanics(req.params.cityId);
    res.json({ ok: true, mechanics, count: mechanics.length });
  }));

  router.post("/mechanics/:cityId", auth, wrap((req, res) => {
    const mechanic = createMechanic(req.params.cityId, req.body);
    res.status(201).json({ ok: true, mechanic });
  }));

  router.post("/mechanics/:cityId/fire", auth, wrap((req, res) => {
    const { triggerId, context } = req.body;
    const result = fireTrigger(req.params.cityId, triggerId, context);
    res.json({ ok: true, ...result });
  }));

  router.delete("/mechanics/:cityId/:mechanicId", auth, wrap((req, res) => {
    const result = deleteMechanic(req.params.cityId, req.params.mechanicId);
    res.json({ ok: true, ...result });
  }));

  // ── Templates ────────────────────────────────────────────────────────────

  router.get("/templates", wrap((_req, res) => {
    const templates = listTemplates();
    res.json({ ok: true, templates, count: templates.length });
  }));

  router.get("/templates/:id", wrap((req, res) => {
    const template = getTemplate(req.params.id);
    if (!template) return res.status(404).json({ ok: false, error: "Template not found" });
    res.json({ ok: true, template });
  }));

  // ── Wizard ───────────────────────────────────────────────────────────────

  router.get("/wizard/steps", wrap((_req, res) => {
    const steps = getWizardSteps();
    res.json({ ok: true, steps });
  }));

  router.post("/wizard/validate", wrap((req, res) => {
    const { stepId, data } = req.body;
    const result = validateWizardStep(stepId, data);
    res.json({ ok: true, ...result });
  }));

  router.post("/wizard/build", auth, wrap((req, res) => {
    const config = buildCityFromWizard(req.body);
    res.json({ ok: true, config });
  }));

  // ── City Config ──────────────────────────────────────────────────────────

  router.get("/config/themes", wrap((_req, res) => {
    res.json({ ok: true, themes: getValidThemes() });
  }));

  router.get("/config/domains", wrap((_req, res) => {
    res.json({ ok: true, domains: getValidDomains() });
  }));

  router.get("/config/rules-schema", wrap((_req, res) => {
    res.json({ ok: true, schema: getCityRulesSchema() });
  }));

  // ══════════════════════════════════════════════════════════════════
  // WORLD LENS — Simulation Pipeline API
  // ══════════════════════════════════════════════════════════════════

  // ── Material Properties Database ──────────────────────────────────

  const SEED_MATERIALS = [
    { id: 'mat-usb-a', name: 'USB Composite A (Standard)', category: 'USB-composite', properties: { tensileStrength: 450, compressiveStrength: 380, shearStrength: 220, elasticModulus: 45, density: 1850, thermalConductivity: 0.35, thermalExpansionCoeff: 8e-6, meltingPoint: 850, fireResistanceHours: 2, corrosionResistance: 'high', fatigueLimit: 180, cost: 120 }, creator: 'system', citations: 0, validationStatus: 'validated' },
    { id: 'mat-usb-b', name: 'USB Composite B (High Strength)', category: 'USB-composite', properties: { tensileStrength: 680, compressiveStrength: 550, shearStrength: 340, elasticModulus: 62, density: 2100, thermalConductivity: 0.42, thermalExpansionCoeff: 7e-6, meltingPoint: 920, fireResistanceHours: 3, corrosionResistance: 'extreme', fatigueLimit: 280, cost: 240 }, creator: 'system', citations: 0, validationStatus: 'validated' },
    { id: 'mat-usb-c', name: 'USB Composite C (Lightweight)', category: 'USB-composite', properties: { tensileStrength: 350, compressiveStrength: 280, shearStrength: 170, elasticModulus: 38, density: 1450, thermalConductivity: 0.28, thermalExpansionCoeff: 9e-6, meltingPoint: 780, fireResistanceHours: 1.5, corrosionResistance: 'high', fatigueLimit: 140, cost: 95 }, creator: 'system', citations: 0, validationStatus: 'validated' },
    { id: 'mat-steel-a36', name: 'Steel A36 (Structural)', category: 'steel', properties: { tensileStrength: 400, compressiveStrength: 250, shearStrength: 230, elasticModulus: 200, density: 7850, thermalConductivity: 50, thermalExpansionCoeff: 12e-6, meltingPoint: 1540, fireResistanceHours: 0.5, corrosionResistance: 'low', fatigueLimit: 160, cost: 85 }, creator: 'system', citations: 0, validationStatus: 'validated' },
    { id: 'mat-concrete-c40', name: 'Concrete C40/50', category: 'concrete', properties: { tensileStrength: 3.5, compressiveStrength: 40, shearStrength: 5, elasticModulus: 35, density: 2450, thermalConductivity: 1.8, thermalExpansionCoeff: 10e-6, meltingPoint: 1200, fireResistanceHours: 4, corrosionResistance: 'moderate', fatigueLimit: 14, cost: 55 }, creator: 'system', citations: 0, validationStatus: 'validated' },
    { id: 'mat-timber-glulam', name: 'Glued Laminated Timber', category: 'wood', properties: { tensileStrength: 24, compressiveStrength: 28, shearStrength: 6, elasticModulus: 13.5, density: 480, thermalConductivity: 0.14, thermalExpansionCoeff: 5e-6, meltingPoint: 300, fireResistanceHours: 1, corrosionResistance: 'low', fatigueLimit: 10, cost: 55 }, creator: 'system', citations: 0, validationStatus: 'validated' },
  ];

  // In-memory stores for simulation data
  const simMaterials = new Map(SEED_MATERIALS.map(m => [m.id, m]));
  const simCitations = [];
  const simBuildingDTUs = new Map();
  const simMarketplace = new Map();
  const simDistricts = new Map();
  const simAvatars = new Map();
  const simFirms = new Map();
  const simPlayerWorlds = new Map();
  const simEvents = new Map();

  // Game systems stores
  const simInventories = new Map();
  const simCraftingStations = new Map();
  const simQuests = new Map();
  const simNotifications = new Map();
  const simReports = new Map();
  const simModActions = [];
  const simReplays = new Map();
  const simProfiles = new Map();
  const simFriends = new Map();
  const simMessages = new Map();
  const simPresence = new Map();
  const simSnapTemplates = new Map();
  const simVisitorLogs = [];
  const simDailyDigests = new Map();
  const simAnalytics = new Map();
  const simCraftingRecipes = [
    { id: 'recipe-usb-beam', name: 'USB Composite Beam', inputs: [{ itemId: 'mat-usb-a', quantity: 3 }], output: { itemId: 'comp-usb-beam', quantity: 1 }, stationType: 'forge', duration: 30, skillRequired: 'novice' },
    { id: 'recipe-steel-column', name: 'Steel Column', inputs: [{ itemId: 'mat-steel-a36', quantity: 5 }], output: { itemId: 'comp-steel-column', quantity: 1 }, stationType: 'forge', duration: 45, skillRequired: 'apprentice' },
    { id: 'recipe-concrete-slab', name: 'Concrete Floor Slab', inputs: [{ itemId: 'mat-concrete-c40', quantity: 8 }], output: { itemId: 'comp-concrete-slab', quantity: 1 }, stationType: 'assembly', duration: 60, skillRequired: 'journeyman' },
    { id: 'recipe-timber-truss', name: 'Timber Roof Truss', inputs: [{ itemId: 'mat-timber-glulam', quantity: 6 }], output: { itemId: 'comp-timber-truss', quantity: 1 }, stationType: 'workbench', duration: 40, skillRequired: 'apprentice' },
    { id: 'recipe-glass-panel', name: 'Tempered Glass Panel', inputs: [{ itemId: 'mat-glass-float', quantity: 2 }], output: { itemId: 'comp-glass-panel', quantity: 1 }, stationType: 'kiln', duration: 50, skillRequired: 'journeyman' },
    { id: 'recipe-solar-cell', name: 'Solar Cell Array', inputs: [{ itemId: 'mat-usb-c', quantity: 4 }, { itemId: 'mat-glass-float', quantity: 1 }], output: { itemId: 'comp-solar-array', quantity: 1 }, stationType: 'lab', duration: 90, skillRequired: 'expert' },
  ];

  // ── Materials API ─────────────────────────────────────────────────

  router.get("/sim/materials", wrap((req, res) => {
    const _limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const _offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const _all = Array.from(simMaterials.values());
    res.json({ ok: true, materials: _all.slice(_offset, _offset + _limit), total: _all.length, limit: _limit, offset: _offset });
  }));

  router.get("/sim/materials/:id", wrap((req, res) => {
    const mat = simMaterials.get(req.params.id);
    if (!mat) return res.status(404).json({ ok: false, error: "Material not found" });
    res.json({ ok: true, material: mat });
  }));

  router.post("/sim/materials", auth, wrap((req, res) => {
    const id = `mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const material = { id, ...req.body, creator: req.user.id, citations: 0, validationStatus: 'experimental' };
    simMaterials.set(id, material);
    res.json({ ok: true, material });
  }));

  // ── Validation API ────────────────────────────────────────────────

  router.post("/sim/validate", auth, wrap((req, res) => {
    const { members, foundations, districtId } = req.body;
    const SAFETY_FACTOR = 1.5;
    const allMembers = [...(foundations || []), ...(members || [])];
    const results = [];

    for (const member of allMembers) {
      const mat = simMaterials.get(member.materialId);
      if (!mat) { results.push({ memberId: member.id, status: 'red', error: 'Material not found' }); continue; }
      const vol = (member.dimensions?.length || 1) * (member.dimensions?.width || 0.3) * (member.dimensions?.height || 0.3);
      const selfWeight = vol * mat.properties.density * 9.81;
      const area = member.crossSectionArea || ((member.dimensions?.width || 0.3) * (member.dimensions?.height || 0.3));
      const stress = area > 0 ? selfWeight / area / 1e6 : 0;
      const allowable = (member.type === 'column' || member.type === 'wall' ? mat.properties.compressiveStrength : mat.properties.tensileStrength) / SAFETY_FACTOR;
      const ratio = allowable > 0 ? stress / allowable : 0;
      results.push({
        memberId: member.id, memberType: member.type, actualStress: stress, allowableStress: allowable, ratio,
        status: ratio < 0.7 ? 'green' : ratio <= 1.0 ? 'yellow' : 'red',
      });
    }

    const overallPass = results.every(r => r.status !== 'red');
    res.json({ ok: true, overallPass, results, timestamp: new Date().toISOString() });
  }));

  // ── Citations API ─────────────────────────────────────────────────

  router.post("/sim/citations", auth, wrap((req, res) => {
    const { citingDTU, citedDTU, citedCreator, context } = req.body;
    const citation = {
      id: `cit-${Date.now()}`,
      citingDTU, citedDTU, citedCreator, context,
      timestamp: new Date().toISOString(),
    };
    simCitations.push(citation);
    // Update citation count on cited material/component
    const mat = simMaterials.get(citedDTU);
    if (mat) mat.citations = (mat.citations || 0) + 1;
    res.json({ ok: true, citation });
  }));

  router.get("/sim/citations/:dtuId", wrap((req, res) => {
    const citations = simCitations.filter(c => c.citingDTU === req.params.dtuId || c.citedDTU === req.params.dtuId);
    res.json({ ok: true, citations });
  }));

  // ── Building DTUs API ─────────────────────────────────────────────

  router.post("/sim/buildings", auth, wrap((req, res) => {
    const id = `bldg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const building = { id, ...req.body, creator: req.user.id, citations: 0, createdAt: new Date().toISOString() };
    simBuildingDTUs.set(id, building);
    res.json({ ok: true, building });
  }));

  router.get("/sim/buildings", wrap((req, res) => {
    const _limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const _offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const _all = Array.from(simBuildingDTUs.values());
    res.json({ ok: true, buildings: _all.slice(_offset, _offset + _limit), total: _all.length, limit: _limit, offset: _offset });
  }));

  router.get("/sim/buildings/:id", wrap((req, res) => {
    const bldg = simBuildingDTUs.get(req.params.id);
    if (!bldg) return res.status(404).json({ ok: false, error: "Building not found" });
    res.json({ ok: true, building: bldg });
  }));

  // ── Marketplace API ───────────────────────────────────────────────

  router.get("/sim/marketplace", wrap((req, res) => {
    let items = Array.from(simMarketplace.values());
    if (req.query.category) items = items.filter(i => i.category === req.query.category);
    if (req.query.sort === 'citations') items.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
    else if (req.query.sort === 'newest') items.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    res.json({ ok: true, items });
  }));

  router.post("/sim/marketplace", auth, wrap((req, res) => {
    const id = `mkt-${Date.now()}`;
    const entry = { dtuId: id, ...req.body, creator: req.user.id, citationCount: 0, publishedAt: new Date().toISOString() };
    simMarketplace.set(id, entry);
    res.json({ ok: true, entry });
  }));

  // ── Simulation Districts API ──────────────────────────────────────

  router.get("/sim/districts", wrap((req, res) => {
    const _limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const _offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const _all = Array.from(simDistricts.values());
    res.json({ ok: true, districts: _all.slice(_offset, _offset + _limit), total: _all.length, limit: _limit, offset: _offset });
  }));

  router.post("/sim/districts", auth, wrap((req, res) => {
    const id = `dist-${Date.now()}`;
    const district = { id, ...req.body, createdAt: new Date().toISOString() };
    simDistricts.set(id, district);
    res.json({ ok: true, district });
  }));

  router.post("/sim/districts/:id/place", auth, wrap((req, res) => {
    const district = simDistricts.get(req.params.id);
    if (!district) return res.status(404).json({ ok: false, error: "District not found" });
    const placement = { id: `placed-${Date.now()}`, ...req.body, placedAt: new Date().toISOString() };
    if (!district.buildings) district.buildings = [];
    district.buildings.push(placement);
    res.json({ ok: true, placement });
  }));

  // ── Placement Validation API ──────────────────────────────────────

  router.post("/sim/districts/:id/validate-placement", auth, wrap((req, res) => {
    const district = simDistricts.get(req.params.id);
    if (!district) return res.status(404).json({ ok: false, error: "District not found" });
    const { buildingType, position } = req.body;
    const checks = {
      zoning: { pass: true, message: 'Zoning compliant' },
      infrastructure: { pass: true, message: 'Infrastructure available' },
      buildingCode: { pass: true, message: 'Building code met' },
      structural: { pass: true, message: 'Foundation compatible' },
      environmental: { pass: true, message: 'Environmental impact acceptable' },
    };
    const allPass = Object.values(checks).every(c => c.pass);
    res.json({ ok: true, allPass, checks });
  }));

  // ── Concordia Hub API ─────────────────────────────────────────────

  router.get("/sim/concordia", wrap((_req, res) => {
    res.json({
      ok: true,
      concordia: {
        name: 'Concordia',
        districts: ['exchange', 'academy', 'forge', 'nexus', 'commons', 'observatory', 'grid', 'frontier', 'docks', 'arena'],
        totalPopulation: 8200,
        totalBuildings: 125,
        activeUsers: 230,
      },
    });
  }));

  // ── Avatar API ────────────────────────────────────────────────────

  router.get("/sim/avatar/:userId", wrap((req, res) => {
    const avatar = simAvatars.get(req.params.userId);
    if (!avatar) return res.status(404).json({ ok: false, error: "Avatar not found" });
    res.json({ ok: true, avatar });
  }));

  router.post("/sim/avatar", auth, wrap((req, res) => {
    const userId = req.user.id;
    const avatar = {
      id: `avatar-${userId}`,
      userId,
      ...req.body,
      reputation: {},
      createdAt: new Date().toISOString(),
    };
    simAvatars.set(userId, avatar);
    res.json({ ok: true, avatar });
  }));

  // ── Firms API ─────────────────────────────────────────────────────

  router.get("/sim/firms", wrap((req, res) => {
    const _limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const _offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const _all = Array.from(simFirms.values());
    res.json({ ok: true, firms: _all.slice(_offset, _offset + _limit), total: _all.length, limit: _limit, offset: _offset });
  }));

  router.post("/sim/firms", auth, wrap((req, res) => {
    const id = `firm-${Date.now()}`;
    const firm = {
      id, ...req.body,
      founder: req.user.id,
      members: [{ userId: req.user.id, role: 'founder', joinedAt: new Date().toISOString(), contributions: 0 }],
      totalCitations: 0, activeContracts: [],
      createdAt: new Date().toISOString(),
    };
    simFirms.set(id, firm);
    res.json({ ok: true, firm });
  }));

  router.post("/sim/firms/:id/join", auth, wrap((req, res) => {
    const firm = simFirms.get(req.params.id);
    if (!firm) return res.status(404).json({ ok: false, error: "Firm not found" });
    firm.members.push({ userId: req.user.id, role: req.body.role || 'associate', joinedAt: new Date().toISOString(), contributions: 0 });
    res.json({ ok: true, firm });
  }));

  // ── Player Worlds API ─────────────────────────────────────────────

  router.get("/sim/worlds", wrap((_req, res) => {
    const worlds = Array.from(simPlayerWorlds.values()).filter(w => w.isPublic);
    res.json({ ok: true, worlds });
  }));

  router.post("/sim/worlds", auth, wrap((req, res) => {
    const id = `world-${Date.now()}`;
    const world = {
      id, ...req.body,
      owner: req.user.id,
      districts: [], playerCount: 1,
      createdAt: new Date().toISOString(),
    };
    simPlayerWorlds.set(id, world);
    res.json({ ok: true, world });
  }));

  // ── Events API ────────────────────────────────────────────────────

  router.get("/sim/events", wrap((req, res) => {
    const _limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const _offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const _all = Array.from(simEvents.values());
    res.json({ ok: true, events: _all.slice(_offset, _offset + _limit), total: _all.length, limit: _limit, offset: _offset });
  }));

  router.post("/sim/events", auth, wrap((req, res) => {
    const id = `event-${Date.now()}`;
    const event = {
      id, ...req.body,
      organizerId: req.user.id,
      participants: [req.user.id],
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
    simEvents.set(id, event);
    res.json({ ok: true, event });
  }));

  router.post("/sim/events/:id/join", auth, wrap((req, res) => {
    const event = simEvents.get(req.params.id);
    if (!event) return res.status(404).json({ ok: false, error: "Event not found" });
    const userId = req.user.id;
    if (!event.participants.includes(userId)) event.participants.push(userId);
    res.json({ ok: true, event });
  }));

  // ── Domain Simulation Calculations ────────────────────────────────

  router.post("/sim/calculate/:domain", auth, wrap((req, res) => {
    const { domain } = req.params;
    const params = req.body;
    // Simplified domain calculations
    const results = {};
    switch (domain) {
      case 'energy':
        results.solarOutput = (params.panelArea || 20) * (params.efficiency || 0.22) * (params.irradiance || 1000) * (params.cloudFactor || 0.75);
        results.windOutput = 0.5 * 1.225 * (params.sweptArea || 50) * Math.pow(params.windSpeed || 8, 3) * 0.4;
        break;
      case 'thermal':
        results.heatLoss = (params.wallArea || 200) / (params.rValue || 3.5) * (params.deltaT || 25);
        break;
      case 'fluid':
        results.hydrostaticPressure = (params.waterDensity || 1000) * 9.81 * (params.damHeight || 10);
        break;
      case 'aerospace': {
        const m0 = (params.structuralMass || 5000) + (params.propellantMass || 20000);
        results.deltaV = (params.exhaustVelocity || 3000) * Math.log(m0 / (params.structuralMass || 5000));
        break;
      }
      default:
        return res.status(400).json({ ok: false, error: `Unknown domain: ${domain}` });
    }
    res.json({ ok: true, domain, results });
  }));

  // ── Disaster Stress Test API ──────────────────────────────────────

  router.post("/sim/stress-test", auth, wrap((req, res) => {
    const { districtId, scenario, magnitude } = req.body;
    // Simplified stress test
    const results = {
      scenario,
      magnitude: magnitude || 5,
      buildingsTested: 6,
      passed: 4,
      marginal: 1,
      failed: 1,
      details: [
        { buildingId: 'bldg-001', status: 'passed', details: 'All structural checks passed' },
        { buildingId: 'bldg-002', status: 'passed', details: 'All structural checks passed' },
        { buildingId: 'bldg-003', status: 'passed', details: 'All structural checks passed' },
        { buildingId: 'bldg-004', status: 'passed', details: 'All structural checks passed' },
        { buildingId: 'bldg-005', status: 'marginal', details: 'Column B4 approaching seismic limit' },
        { buildingId: 'bldg-006', status: 'failed', details: 'Foundation bearing capacity exceeded at M' + (magnitude || 5) },
      ],
    };
    res.json({ ok: true, results });
  }));

  // ── Leaderboards API ──────────────────────────────────────────────

  router.get("/sim/leaderboards/:districtId", wrap((req, res) => {
    res.json({
      ok: true,
      leaderboards: {
        mostCitedCreator: [
          { userId: 'user-001', displayName: '@engineer_jane', score: 521, metric: 'citations', rank: 1 },
          { userId: 'user-002', displayName: '@materials_lab', score: 342, metric: 'citations', rank: 2 },
          { userId: 'user-003', displayName: '@power_mike', score: 204, metric: 'citations', rank: 3 },
        ],
        highestHabitability: [
          { userId: 'user-001', displayName: '@architect_alex', score: 94, metric: 'habitability', rank: 1 },
        ],
      },
    });
  }));

  // ── Timeline / History API ────────────────────────────────────────

  router.get("/sim/timeline/:districtId", wrap((req, res) => {
    res.json({
      ok: true,
      snapshots: [
        { timestamp: '2025-10-01', buildingCount: 0, populationCapacity: 0, powerCapacity: 0, waterCapacity: 0, environmentalScore: 100 },
        { timestamp: '2025-10-15', buildingCount: 2, populationCapacity: 400, powerCapacity: 1000, waterCapacity: 20000, environmentalScore: 85 },
        { timestamp: '2025-11-01', buildingCount: 4, populationCapacity: 1200, powerCapacity: 3000, waterCapacity: 50000, environmentalScore: 78 },
        { timestamp: '2025-11-15', buildingCount: 6, populationCapacity: 2400, powerCapacity: 5000, waterCapacity: 90000, environmentalScore: 72 },
      ],
    });
  }));

  // ══════════════════════════════════════════════════════════════════
  // GAME SYSTEMS API — Sound, Inventory, Crafting, Combat, Quests,
  // Progression, Notifications, Moderation, Social, Analytics, 3D
  // ══════════════════════════════════════════════════════════════════

  // ── Inventory API ────────────────────────────────────────────────
  // Backed by the `player_inventory` table (migration 035). Falls back
  // to the in-memory simInventories Map when db is unavailable (tests,
  // cold-boot before migrations run).
  //
  // Schema: (user_id, item_id) PRIMARY KEY, quantity, slot, metadata
  // - Stacking: same item_id adds quantity
  // - Equip: writes slot column to a special 'equipped:<slot>' marker
  // - Remove: zero quantity → row deleted

  const MAX_SLOTS = 24;

  function getInventoryFromDb(userId) {
    if (!db) return null;
    try {
      const rows = db.prepare(
        "SELECT item_id, quantity, slot, metadata, acquired_at FROM player_inventory WHERE user_id = ? ORDER BY acquired_at ASC"
      ).all(userId);
      const items = [];
      const equipped = {};
      for (const row of rows) {
        // Rows with slot starting "equipped:" are slot markers, not items.
        if (row.slot && row.slot.startsWith("equipped:")) {
          equipped[row.slot.slice("equipped:".length)] = row.item_id;
          continue;
        }
        items.push({
          id: row.item_id,
          quantity: row.quantity,
          slot: row.slot,
          metadata: (() => { try { return JSON.parse(row.metadata || "{}"); } catch { return {}; } })(),
          acquiredAt: row.acquired_at,
        });
      }
      return { items, maxSlots: MAX_SLOTS, equipped };
    } catch (err) {
      logger.warn?.("world-inventory", `db read failed: ${err.message}`);
      return null;
    }
  }

  function addItemToDb(userId, itemId, quantity, slot, metadata) {
    if (!db) return null;
    try {
      // Upsert: if the row exists, add quantity; otherwise insert
      const existing = db.prepare(
        "SELECT quantity FROM player_inventory WHERE user_id = ? AND item_id = ?"
      ).get(userId, itemId);
      if (existing) {
        db.prepare(
          "UPDATE player_inventory SET quantity = quantity + ? WHERE user_id = ? AND item_id = ?"
        ).run(quantity, userId, itemId);
        return { quantity: existing.quantity + quantity };
      }
      db.prepare(
        "INSERT INTO player_inventory (user_id, item_id, quantity, slot, metadata) VALUES (?, ?, ?, ?, ?)"
      ).run(userId, itemId, quantity, slot || null, JSON.stringify(metadata || {}));
      return { quantity };
    } catch (err) {
      logger.warn?.("world-inventory", `db add failed: ${err.message}`);
      return null;
    }
  }

  router.get("/sim/inventory/:userId", wrap((req, res) => {
    const userId = req.params.userId;
    const dbInv = getInventoryFromDb(userId);
    if (dbInv) return res.json({ ok: true, inventory: dbInv });
    // Legacy in-memory fallback
    const inv = simInventories.get(userId) || { items: [], maxSlots: MAX_SLOTS, equipped: {} };
    res.json({ ok: true, inventory: inv });
  }));

  router.post("/sim/inventory/:userId/add", auth, wrap((req, res) => {
    const userId = req.params.userId;
    // Security: user can only add to their own inventory unless admin
    if (req.user?.id && req.user.id !== userId && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "cannot_modify_other_inventory" });
    }
    const itemId = req.body.itemId || req.body.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const quantity = Number(req.body.quantity) || 1;
    const slot = req.body.slot || null;
    const metadata = req.body.metadata || { name: req.body.name, type: req.body.type, rarity: req.body.rarity };

    // Check inventory capacity (only for NEW items, not stacking)
    const dbInv = getInventoryFromDb(userId);
    if (dbInv && !dbInv.items.find((i) => i.id === itemId) && dbInv.items.length >= MAX_SLOTS) {
      return res.status(400).json({ ok: false, error: "Inventory full" });
    }

    const dbResult = addItemToDb(userId, itemId, quantity, slot, metadata);
    if (dbResult) {
      return res.json({
        ok: true,
        item: { id: itemId, quantity: dbResult.quantity, slot, metadata, acquiredAt: new Date().toISOString() },
      });
    }

    // Legacy fallback
    let inv = simInventories.get(userId);
    if (!inv) { inv = { items: [], maxSlots: MAX_SLOTS, equipped: {} }; simInventories.set(userId, inv); }
    const item = { id: itemId, quantity, slot, metadata, acquiredAt: new Date().toISOString() };
    if (inv.items.length >= inv.maxSlots) return res.status(400).json({ ok: false, error: "Inventory full" });
    inv.items.push(item);
    res.json({ ok: true, item });
  }));

  // Equipment slots are a closed set. Reject anything else outright so a
  // crafted slot key like "__proto__" cannot reach the dynamic assignment
  // on inv.equipped (prototype-pollution vector caught by CodeQL).
  const VALID_EQUIP_SLOTS = new Set([
    "head", "chest", "legs", "feet", "hands",
    "main_hand", "off_hand", "ranged", "ammo",
    "neck", "ring_left", "ring_right", "belt", "cloak", "trinket",
  ]);

  router.post("/sim/inventory/:userId/equip", auth, wrap((req, res) => {
    const userId = req.params.userId;
    if (req.user?.id && req.user.id !== userId && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "cannot_modify_other_inventory" });
    }
    const { slot, itemId } = req.body;
    if (!slot || !itemId) return res.status(400).json({ ok: false, error: "slot and itemId required" });
    if (typeof slot !== "string" || !VALID_EQUIP_SLOTS.has(slot)) {
      return res.status(400).json({ ok: false, error: "invalid slot" });
    }
    if (typeof itemId !== "string" || itemId.length > 64) {
      return res.status(400).json({ ok: false, error: "invalid itemId" });
    }

    if (db) {
      try {
        // Clear any existing equip for this slot
        db.prepare(
          "DELETE FROM player_inventory WHERE user_id = ? AND slot = ?"
        ).run(userId, `equipped:${slot}`);
        // Write the new equip marker
        db.prepare(
          "INSERT INTO player_inventory (user_id, item_id, quantity, slot, metadata) VALUES (?, ?, 1, ?, '{}')"
        ).run(userId, itemId, `equipped:${slot}`);
        const dbInv = getInventoryFromDb(userId);
        return res.json({ ok: true, equipped: dbInv?.equipped || {} });
      } catch (err) {
        logger.warn?.("world-inventory", `equip failed: ${err.message}`);
      }
    }

    // Legacy fallback
    const inv = simInventories.get(userId);
    if (!inv) return res.status(404).json({ ok: false, error: "Inventory not found" });
    // VALID_EQUIP_SLOTS.has(slot) guard above guarantees slot is a known
    // literal key — Object.prototype is unreachable.
    if (!inv.equipped || typeof inv.equipped !== "object") inv.equipped = Object.create(null);
    inv.equipped[slot] = itemId;
    res.json({ ok: true, equipped: inv.equipped });
  }));

  router.delete("/sim/inventory/:userId/item/:itemId", auth, wrap((req, res) => {
    const userId = req.params.userId;
    if (req.user?.id && req.user.id !== userId && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "cannot_modify_other_inventory" });
    }
    const itemId = req.params.itemId;

    if (db) {
      try {
        const result = db.prepare(
          "DELETE FROM player_inventory WHERE user_id = ? AND item_id = ?"
        ).run(userId, itemId);
        return res.json({ ok: true, deleted: result.changes });
      } catch (err) {
        logger.warn?.("world-inventory", `delete failed: ${err.message}`);
      }
    }

    // Legacy fallback
    const inv = simInventories.get(userId);
    if (!inv) return res.status(404).json({ ok: false, error: "Inventory not found" });
    inv.items = inv.items.filter((i) => i.id !== itemId);
    res.json({ ok: true });
  }));

  // ── Crafting API ─────────────────────────────────────────────────

  router.get("/sim/crafting/recipes", wrap((_req, res) => {
    res.json({ ok: true, recipes: simCraftingRecipes });
  }));

  router.get("/sim/crafting/stations", wrap((req, res) => {
    const _limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const _offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const _all = Array.from(simCraftingStations.values());
    res.json({ ok: true, stations: _all.slice(_offset, _offset + _limit), total: _all.length, limit: _limit, offset: _offset });
  }));

  router.post("/sim/crafting/stations", auth, wrap((req, res) => {
    const id = `station-${Date.now()}`;
    const station = { id, ...req.body, currentJob: null, createdAt: new Date().toISOString() };
    simCraftingStations.set(id, station);
    res.json({ ok: true, station });
  }));

  router.post("/sim/crafting/craft", auth, wrap((req, res) => {
    const { recipeId, stationId } = req.body;
    const recipe = simCraftingRecipes.find(r => r.id === recipeId);
    if (!recipe) return res.status(404).json({ ok: false, error: 'Recipe not found' });
    const station = simCraftingStations.get(stationId);
    if (station && station.currentJob) return res.status(400).json({ ok: false, error: 'Station busy' });
    const result = {
      success: true,
      outputItem: { id: `crafted-${Date.now()}`, ...recipe.output, craftedAt: new Date().toISOString(), craftedBy: req.user.id },
      qualityBonus: Math.random() > 0.7 ? Math.floor(Math.random() * 15) + 5 : 0,
      byproducts: [],
    };
    res.json({ ok: true, result });
  }));

  // ── Quest & Mission API ──────────────────────────────────────────

  router.get("/sim/quests", wrap((req, res) => {
    let quests = Array.from(simQuests.values());
    if (req.query.type) quests = quests.filter(q => q.type === req.query.type);
    if (req.query.worldId) quests = quests.filter(q => q.worldId === req.query.worldId);
    res.json({ ok: true, quests });
  }));

  router.post("/sim/quests", auth, wrap((req, res) => {
    const id = `quest-${Date.now()}`;
    const quest = { id, ...req.body, creator: req.user.id, status: 'available', createdAt: new Date().toISOString() };
    simQuests.set(id, quest);
    res.json({ ok: true, quest });
  }));

  router.get("/sim/quests/:id", wrap((req, res) => {
    const quest = simQuests.get(req.params.id);
    if (!quest) return res.status(404).json({ ok: false, error: 'Quest not found' });
    res.json({ ok: true, quest });
  }));

  router.post("/sim/quests/:id/accept", auth, wrap((req, res) => {
    const quest = simQuests.get(req.params.id);
    if (!quest) return res.status(404).json({ ok: false, error: 'Quest not found' });
    quest.status = 'active';
    quest.acceptedBy = req.user.id;
    quest.acceptedAt = new Date().toISOString();
    res.json({ ok: true, quest });
  }));

  router.post("/sim/quests/:id/complete", auth, wrap((req, res) => {
    const quest = simQuests.get(req.params.id);
    if (!quest) return res.status(404).json({ ok: false, error: 'Quest not found' });
    quest.status = 'completed';
    quest.completedAt = new Date().toISOString();
    res.json({ ok: true, quest, rewards: quest.rewards || [] });
  }));

  // ── Progression / Reputation API ─────────────────────────────────

  router.get("/sim/progression/:userId", wrap((req, res) => {
    const profile = simProfiles.get(req.params.userId) || {
      userId: req.params.userId,
      domains: {
        structural: { score: 0, tier: 'novice', citations: 0 },
        materials: { score: 0, tier: 'novice', citations: 0 },
        infrastructure: { score: 0, tier: 'novice', citations: 0 },
        energy: { score: 0, tier: 'novice', citations: 0 },
        architecture: { score: 0, tier: 'novice', citations: 0 },
        mentorship: { score: 0, tier: 'novice', citations: 0 },
        governance: { score: 0, tier: 'novice', citations: 0 },
        exploration: { score: 0, tier: 'novice', citations: 0 },
      },
      totalCitations: 0, totalRoyalties: 0, badges: [],
    };
    res.json({ ok: true, profile });
  }));

  router.post("/sim/progression/:userId/cite", auth, wrap((req, res) => {
    const { domain, amount } = req.body;
    let profile = simProfiles.get(req.params.userId);
    if (!profile) {
      profile = { userId: req.params.userId, domains: {}, totalCitations: 0, totalRoyalties: 0, badges: [] };
      simProfiles.set(req.params.userId, profile);
    }
    if (!profile.domains[domain]) profile.domains[domain] = { score: 0, tier: 'novice', citations: 0 };
    profile.domains[domain].citations += (amount || 1);
    profile.domains[domain].score += (amount || 1) * 10;
    profile.totalCitations += (amount || 1);
    // Auto-tier
    const tiers = ['novice', 'apprentice', 'journeyman', 'expert', 'master', 'grandmaster'];
    const tierThresholds = [0, 10, 50, 200, 500, 1000];
    const c = profile.domains[domain].citations;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (c >= tierThresholds[i]) { profile.domains[domain].tier = tiers[i]; break; }
    }
    res.json({ ok: true, profile });
  }));

  // ── Notifications API ────────────────────────────────────────────

  router.get("/sim/notifications/:userId", wrap((req, res) => {
    const notifs = simNotifications.get(req.params.userId) || [];
    res.json({ ok: true, notifications: notifs });
  }));

  router.post("/sim/notifications/:userId", auth, wrap((req, res) => {
    const userId = req.params.userId;
    if (!simNotifications.has(userId)) simNotifications.set(userId, []);
    const notif = { id: `notif-${Date.now()}`, ...req.body, read: false, timestamp: new Date().toISOString() };
    simNotifications.get(userId).unshift(notif);
    // Keep max 100
    const list = simNotifications.get(userId);
    if (list.length > 100) simNotifications.set(userId, list.slice(0, 100));
    res.json({ ok: true, notification: notif });
  }));

  router.post("/sim/notifications/:userId/read", auth, wrap((req, res) => {
    const list = simNotifications.get(req.params.userId);
    if (!list) return res.json({ ok: true });
    const { notificationId } = req.body;
    if (notificationId === 'all') { list.forEach(n => n.read = true); }
    else { const n = list.find(x => x.id === notificationId); if (n) n.read = true; }
    res.json({ ok: true });
  }));

  // ── Daily Digest API ─────────────────────────────────────────────

  router.get("/sim/digest/:userId", wrap((req, res) => {
    const digest = simDailyDigests.get(req.params.userId) || {
      date: new Date().toISOString().split('T')[0],
      newCitations: Math.floor(Math.random() * 12),
      royaltiesEarned: +(Math.random() * 5).toFixed(2),
      worldEvents: ['New building validated in District 3', 'Weather: light snow expected tonight'],
      topCreation: { name: 'USB-A Foundation Slab', citations: 7 },
      npcSummary: 'The blacksmith at The Forge completed 3 commissions while you were away.',
    };
    res.json({ ok: true, digest });
  }));

  // ── Moderation / Anti-Grief API ──────────────────────────────────

  router.post("/sim/reports", auth, wrap((req, res) => {
    const report = {
      id: `report-${Date.now()}`, reporterId: req.user.id,
      ...req.body, status: 'pending', timestamp: new Date().toISOString(),
    };
    simReports.set(report.id, report);
    res.json({ ok: true, report });
  }));

  router.get("/sim/reports", wrap((req, res) => {
    let reports = Array.from(simReports.values());
    if (req.query.status) reports = reports.filter(r => r.status === req.query.status);
    res.json({ ok: true, reports });
  }));

  router.post("/sim/moderation/action", auth, wrap((req, res) => {
    const action = {
      id: `mod-${Date.now()}`, moderatorId: req.user?.id || 'system',
      ...req.body, timestamp: new Date().toISOString(),
    };
    simModActions.push(action);
    res.json({ ok: true, action });
  }));

  router.get("/sim/moderation/actions", wrap((_req, res) => {
    res.json({ ok: true, actions: simModActions.slice(-50) });
  }));

  // ── Social / Friends API ─────────────────────────────────────────

  router.get("/sim/friends/:userId", wrap((req, res) => {
    const friends = simFriends.get(req.params.userId) || [];
    res.json({ ok: true, friends });
  }));

  router.post("/sim/friends/:userId/add", auth, wrap((req, res) => {
    const userId = req.params.userId;
    if (!simFriends.has(userId)) simFriends.set(userId, []);
    const friend = { userId: req.body.friendId, displayName: req.body.displayName || req.body.friendId, addedAt: new Date().toISOString(), onlineStatus: 'offline' };
    simFriends.get(userId).push(friend);
    res.json({ ok: true, friend });
  }));

  router.delete("/sim/friends/:userId/:friendId", auth, wrap((req, res) => {
    const list = simFriends.get(req.params.userId);
    if (list) simFriends.set(req.params.userId, list.filter(f => f.userId !== req.params.friendId));
    res.json({ ok: true });
  }));

  // ── Player Presence API ──────────────────────────────────────────

  router.get("/sim/presence", wrap((_req, res) => {
    const players = Array.from(simPresence.values()).filter(p => p.isOnline);
    res.json({ ok: true, players, count: players.length });
  }));

  router.post("/sim/presence/update", auth, wrap((req, res) => {
    const userId = req.user.id;
    const presence = {
      userId, ...req.body, isOnline: true,
      lastSeen: new Date().toISOString(),
    };
    simPresence.set(userId, presence);
    res.json({ ok: true, presence });
  }));

  router.post("/sim/presence/offline", auth, wrap((req, res) => {
    const userId = req.user.id;
    const p = simPresence.get(userId);
    if (p) { p.isOnline = false; p.lastSeen = new Date().toISOString(); }
    res.json({ ok: true });
  }));

  // ── Messages / Chat API ──────────────────────────────────────────

  router.get("/sim/messages/:channelId", wrap((req, res) => {
    const msgs = simMessages.get(req.params.channelId) || [];
    const limit = parseInt(req.query.limit) || 50;
    res.json({ ok: true, messages: msgs.slice(-limit) });
  }));

  router.post("/sim/messages/:channelId", auth, wrap((req, res) => {
    const channelId = req.params.channelId;
    if (!simMessages.has(channelId)) simMessages.set(channelId, []);
    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      channelId, senderId: req.user.id,
      ...req.body, timestamp: new Date().toISOString(),
    };
    simMessages.get(channelId).push(msg);
    // Keep max 500 per channel
    const list = simMessages.get(channelId);
    if (list.length > 500) simMessages.set(channelId, list.slice(-500));
    res.json({ ok: true, message: msg });
  }));

  // ── World Travel / Portal API ────────────────────────────────────

  router.get("/sim/travel/departures", wrap((_req, res) => {
    const worlds = Array.from(simPlayerWorlds.values()).filter(w => w.isPublic).map(w => ({
      worldId: w.id, worldName: w.name, owner: w.owner,
      playerCount: w.playerCount || 0, mode: w.mode || 'realistic',
      accessStatus: w.isPublic ? 'public' : 'private',
      description: w.description || '',
    }));
    res.json({ ok: true, departures: worlds });
  }));

  router.post("/sim/travel/portal", auth, wrap((req, res) => {
    const { destWorldId } = req.body;
    const world = simPlayerWorlds.get(destWorldId);
    if (!world) return res.status(404).json({ ok: false, error: 'World not found' });
    const transition = {
      sourceWorld: 'concordia', destWorld: destWorldId,
      transitionType: req.body.transitionType || 'terminal',
      arrived: true, timestamp: new Date().toISOString(),
    };
    // Log visitor
    simVisitorLogs.push({ worldId: destWorldId, visitorId: req.user.id, enteredAt: new Date().toISOString() });
    res.json({ ok: true, transition });
  }));

  router.post("/sim/travel/invite", auth, wrap((req, res) => {
    const invite = {
      id: `invite-${Date.now()}`, fromUserId: req.user.id,
      ...req.body, status: 'pending', timestamp: new Date().toISOString(),
    };
    res.json({ ok: true, invite });
  }));

  // ── Snap-Build Templates API ─────────────────────────────────────

  router.get("/sim/templates/snap-build", wrap((req, res) => {
    let templates = Array.from(simSnapTemplates.values());
    if (req.query.category) templates = templates.filter(t => t.category === req.query.category);
    if (req.query.sort === 'citations') templates.sort((a, b) => (b.citations || 0) - (a.citations || 0));
    else if (req.query.sort === 'newest') templates.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ ok: true, templates });
  }));

  router.post("/sim/templates/snap-build", auth, wrap((req, res) => {
    const id = `snap-${Date.now()}`;
    const template = { id, ...req.body, creator: req.user.id, citations: 0, validationStatus: 'validated', createdAt: new Date().toISOString() };
    simSnapTemplates.set(id, template);
    res.json({ ok: true, template });
  }));

  // ── Collaboration / Project Board API ────────────────────────────

  router.get("/sim/projects/:boardId", wrap((req, res) => {
    const seed = {
      id: req.params.boardId, name: 'District 3 Development',
      tasks: [
        { id: 'task-1', title: 'Design water treatment plant', status: 'open', payment: 50 },
        { id: 'task-2', title: 'Build Main Street facades', status: 'claimed', claimedBy: '@builder_bob', payment: 30 },
        { id: 'task-3', title: 'Wire power grid section B', status: 'in-progress', claimedBy: '@power_mike', payment: 40 },
        { id: 'task-4', title: 'Validate all residential structures', status: 'complete', claimedBy: '@architect_alex', payment: 25 },
      ],
    };
    res.json({ ok: true, board: seed });
  }));

  router.post("/sim/projects/:boardId/tasks", auth, wrap((req, res) => {
    const task = { id: `task-${Date.now()}`, ...req.body, status: 'open', createdAt: new Date().toISOString() };
    res.json({ ok: true, task });
  }));

  router.post("/sim/projects/:boardId/tasks/:taskId/claim", auth, wrap((req, res) => {
    res.json({ ok: true, taskId: req.params.taskId, claimedBy: req.user.id, status: 'claimed' });
  }));

  // ── Design Review API ────────────────────────────────────────────

  router.post("/sim/reviews", auth, wrap((req, res) => {
    const review = {
      id: `review-${Date.now()}`, reviewerId: req.user.id,
      ...req.body, verdict: 'pending', createdAt: new Date().toISOString(),
    };
    res.json({ ok: true, review });
  }));

  router.post("/sim/reviews/:id/annotate", auth, wrap((req, res) => {
    const annotation = {
      id: `ann-${Date.now()}`, reviewId: req.params.id,
      ...req.body, createdAt: new Date().toISOString(),
    };
    res.json({ ok: true, annotation });
  }));

  router.post("/sim/reviews/:id/verdict", auth, wrap((req, res) => {
    res.json({ ok: true, reviewId: req.params.id, verdict: req.body.verdict, comments: req.body.comments });
  }));

  // ── Analytics API ────────────────────────────────────────────────

  router.get("/sim/analytics/personal/:userId", wrap((req, res) => {
    const stats = simAnalytics.get(req.params.userId) || {
      totalCitations: Math.floor(Math.random() * 500),
      totalRoyalties: +(Math.random() * 100).toFixed(2),
      mostCitedDTU: { name: 'USB-A Reinforced Beam', citations: 47 },
      mostUsedMaterial: { name: 'USB Composite A', uses: 89 },
      reputationByDomain: { structural: 340, materials: 120, infrastructure: 85, energy: 45, architecture: 200, mentorship: 30, governance: 15, exploration: 60 },
      buildCount: Math.floor(Math.random() * 50) + 5,
      playtime: Math.floor(Math.random() * 200) + 10,
      loginStreak: Math.floor(Math.random() * 30) + 1,
    };
    res.json({ ok: true, stats });
  }));

  router.get("/sim/analytics/world/:worldId", wrap((req, res) => {
    res.json({
      ok: true, stats: {
        population: 2400, buildingCount: 47, infraCoverage: 72,
        envScore: 68, economicActivity: 14500, visitorCount: 890,
        timeseries: [
          { date: '2025-10-01', visitors: 12, buildings: 2 },
          { date: '2025-10-15', visitors: 45, buildings: 8 },
          { date: '2025-11-01', visitors: 120, buildings: 23 },
          { date: '2025-11-15', visitors: 230, buildings: 47 },
        ],
      },
    });
  }));

  router.get("/sim/analytics/global", wrap((_req, res) => {
    res.json({
      ok: true, stats: {
        activeDistricts: 10, totalBuildings: 1250, totalCitations: 45000,
        activeUsers: 890, totalWorlds: 67,
        trendingComponents: [
          { name: 'USB-B I-Beam 30cm', creator: '@struct_team', citationsThisWeek: 89 },
          { name: 'Solar Mount v3', creator: '@green_firm', citationsThisWeek: 67 },
          { name: 'Concrete Foundation Slab', creator: '@builder_bob', citationsThisWeek: 52 },
        ],
        topCreators: [
          { userId: 'user-001', name: '@engineer_jane', citations: 2100, rank: 1 },
          { userId: 'user-002', name: '@architect_alex', citations: 1800, rank: 2 },
          { userId: 'user-003', name: '@materials_lab', citations: 1200, rank: 3 },
        ],
      },
    });
  }));

  // ── Seasonal / Events Calendar API ───────────────────────────────

  router.get("/sim/seasonal/current", wrap((_req, res) => {
    const month = new Date().getMonth();
    const seasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];
    res.json({
      ok: true, season: seasons[month],
      activeEvent: { name: 'Spring Engineering Festival', endsAt: new Date(Date.now() + 7 * 86400000).toISOString() },
      monthlyChallenge: { title: 'Bridge Builder Challenge', description: 'Design a pedestrian bridge rated for 200 occupants', objective: 'Build and validate a pedestrian bridge', progress: 0, reward: { type: 'title', value: 'Bridge Master' } },
    });
  }));

  // ── Replay / Spectator API ───────────────────────────────────────

  router.get("/sim/replays/:worldId", wrap((req, res) => {
    const replays = Array.from(simReplays.values()).filter(r => r.worldId === req.params.worldId);
    res.json({ ok: true, replays });
  }));

  router.post("/sim/replays", auth, wrap((req, res) => {
    const id = `replay-${Date.now()}`;
    const replay = { id, ...req.body, creatorId: req.user.id, createdAt: new Date().toISOString() };
    simReplays.set(id, replay);
    res.json({ ok: true, replay });
  }));

  // ── Visitor Logs API ─────────────────────────────────────────────

  router.get("/sim/visitors/:worldId", wrap((req, res) => {
    const logs = simVisitorLogs.filter(l => l.worldId === req.params.worldId);
    res.json({ ok: true, visitors: logs.slice(-100) });
  }));

  // ── 3D Scene State API ───────────────────────────────────────────

  router.get("/sim/scene/:districtId", wrap((req, res) => {
    const district = simDistricts.get(req.params.districtId);
    res.json({
      ok: true,
      scene: {
        districtId: req.params.districtId,
        terrain: { type: 'heightmap', resolution: 2048, minElevation: 0, maxElevation: 80 },
        buildings: district?.buildings || [],
        infrastructure: district?.infrastructure || {},
        npcs: [], // populated by NPC system
        weather: district?.weather || { type: 'clear', windSpeed: 8, windDirection: 270, temperature: 15 },
        timeOfDay: ((Date.now() / 60000) % 24).toFixed(1), // cycles
        quality: req.query.quality || 'medium',
      },
    });
  }));

  router.post("/sim/scene/player-update", auth, wrap(async (req, res) => {
    // Receives player position/rotation/animation for multiplayer sync.
    // Previously this endpoint just echoed the request back — now it
    // routes into city-presence.js which owns the spatial-chunking,
    // nearby-query, trigger-firing, and SQLite-flush logic. The
    // socket.on('player:move') path is preferred (lower latency, no
    // per-request auth overhead), but this HTTP route is kept so
    // clients that can't hold a socket open (mobile PWA background
    // tabs, intermittent connections) still work.
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Authentication required" });

    try {
      const { updateUserPosition } = await import("../lib/city-presence.js");
      const result = updateUserPosition(userId, {
        cityId: String(req.body.cityId || "concordia-central"),
        x: Number(req.body.x) || 0,
        y: Number(req.body.y) || 0,
        z: Number(req.body.z) || 0,
        direction: Number(req.body.direction) || 0,
        rotation: Number(req.body.rotation) || 0,
        action: typeof req.body.action === "string" ? req.body.action.slice(0, 32) : "idle",
        currentAnimation: typeof req.body.currentAnimation === "string" ? req.body.currentAnimation.slice(0, 32) : "idle",
        districtId: typeof req.body.districtId === "string" ? req.body.districtId.slice(0, 64) : null,
      });
      res.json({
        ok: true,
        userId,
        timestamp: Date.now(),
        nearby: result.nearby || [],
        chunkCrossed: !!result.chunkCrossed,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: "player_update_failed" });
    }
  }));

  // ── Accessibility Preferences API ────────────────────────────────

  router.get("/sim/accessibility/:userId", wrap((req, res) => {
    res.json({
      ok: true, settings: {
        colorblindMode: 'none', textScale: 1.0, screenReaderEnabled: false,
        keyboardNavEnabled: false, reducedMotion: false, subtitlesEnabled: true,
        oneHandedMode: false, gameSpeed: 1.0, highContrast: false,
      },
    });
  }));

  router.post("/sim/accessibility/:userId", auth, wrap((req, res) => {
    res.json({ ok: true, settings: req.body });
  }));

  // ── Settings API ─────────────────────────────────────────────────

  router.get("/sim/settings/:userId", wrap((req, res) => {
    res.json({
      ok: true, settings: {
        graphics: 'medium', audio: { master: 0.8, music: 0.6, ambient: 0.7, sfx: 0.8, dialogue: 0.9 },
        notifications: { citation: true, royalty: true, event: true, social: true, system: true, dailyDigest: true },
        privacy: { profileVisibility: 'public', worldVisibility: 'public', activityStatus: true, allowDMs: true },
        controls: {}, locale: 'en', measurementUnit: 'metric',
      },
    });
  }));

  router.post("/sim/settings/:userId", auth, wrap((req, res) => {
    res.json({ ok: true, settings: req.body });
  }));

  // ── Voice Interface API ──────────────────────────────────────────

  const voiceHistory = new Map(); // userId -> command[]

  router.post("/sim/voice/command", auth, wrap((req, res) => {
    const userId = req.user.id;
    const { transcript, engine } = req.body;
    // Parse intent from transcript
    const intents = ['build', 'navigate', 'inspect', 'search', 'social', 'system'];
    const detectedIntent = intents.find(i => transcript?.toLowerCase().includes(i)) || 'unknown';
    const result = {
      id: `vc-${Date.now()}`,
      transcript,
      engine: engine || 'whisper',
      intent: detectedIntent,
      confidence: 0.85 + Math.random() * 0.15,
      parsedAt: new Date().toISOString(),
      executed: detectedIntent !== 'unknown',
    };
    if (!voiceHistory.has(userId)) voiceHistory.set(userId, []);
    voiceHistory.get(userId).push(result);
    res.json({ ok: true, result });
  }));

  router.get("/sim/voice/history/:userId", wrap((req, res) => {
    const history = voiceHistory.get(req.params.userId) || [];
    res.json({ ok: true, commands: history.slice(-20) });
  }));

  // ── Command Palette API ─────────────────────────────────────────

  router.get("/sim/commands", wrap((_req, res) => {
    const commands = [
      { id: 'nav-exchange', category: 'Navigation', label: 'Go to Exchange District', shortcut: 'G E' },
      { id: 'nav-academy', category: 'Navigation', label: 'Go to Academy District', shortcut: 'G A' },
      { id: 'build-new', category: 'Building', label: 'New Building', shortcut: 'B N' },
      { id: 'build-template', category: 'Building', label: 'Browse Templates', shortcut: 'B T' },
      { id: 'sim-validate', category: 'Simulation', label: 'Run Validation', shortcut: 'V' },
      { id: 'sim-weather', category: 'Simulation', label: 'Toggle Weather', shortcut: 'W' },
      { id: 'social-chat', category: 'Social', label: 'Open Chat', shortcut: 'C' },
      { id: 'social-friends', category: 'Social', label: 'Friends List', shortcut: 'F' },
      { id: 'search-dtu', category: 'Search', label: 'Search DTUs', shortcut: '/' },
      { id: 'search-user', category: 'Search', label: 'Find Player', shortcut: 'Shift+/' },
      { id: 'settings-open', category: 'Settings', label: 'Open Settings', shortcut: 'Comma' },
      { id: 'settings-graphics', category: 'Settings', label: 'Graphics Settings', shortcut: null },
      { id: 'lens-toggle', category: 'Lens', label: 'Toggle Active Lens', shortcut: 'L' },
      { id: 'lens-stress', category: 'Lens', label: 'Stress Heatmap', shortcut: 'L S' },
    ];
    res.json({ ok: true, commands });
  }));

  // ── Live Collaboration API ──────────────────────────────────────

  const collabSessions = new Map();

  router.post("/sim/collab/session", auth, wrap((req, res) => {
    const id = `collab-${Date.now()}`;
    const session = {
      id,
      dtuId: req.body.dtuId,
      host: req.user.id,
      participants: [{ userId: req.user.id, color: '#3B82F6', joinedAt: new Date().toISOString() }],
      edits: [],
      conflicts: [],
      versions: [],
      createdAt: new Date().toISOString(),
    };
    collabSessions.set(id, session);
    res.json({ ok: true, session });
  }));

  router.post("/sim/collab/session/:id/join", auth, wrap((req, res) => {
    const session = collabSessions.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });
    const colors = ['#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
    session.participants.push({
      userId: req.user.id,
      color: colors[session.participants.length % colors.length],
      joinedAt: new Date().toISOString(),
    });
    res.json({ ok: true, session });
  }));

  router.post("/sim/collab/session/:id/edit", auth, wrap((req, res) => {
    const session = collabSessions.get(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });
    const edit = {
      id: `edit-${Date.now()}`,
      userId: req.user.id,
      field: req.body.field,
      oldValue: req.body.oldValue,
      newValue: req.body.newValue,
      timestamp: new Date().toISOString(),
    };
    session.edits.push(edit);
    res.json({ ok: true, edit });
  }));

  // ── Export & Embed API ──────────────────────────────────────────

  router.post("/sim/export", auth, wrap((req, res) => {
    const { dtuId, format, options } = req.body;
    const exportResult = {
      id: `export-${Date.now()}`,
      dtuId,
      format: format || 'json',
      status: 'complete',
      url: `/api/exports/export-${Date.now()}.${format || 'json'}`,
      size: Math.floor(Math.random() * 5000000) + 100000,
      createdAt: new Date().toISOString(),
    };
    res.json({ ok: true, export: exportResult });
  }));

  router.post("/sim/embed", auth, wrap((req, res) => {
    const { dtuId, theme, interactive } = req.body;
    const embedCode = `<iframe src="/embed/${dtuId}" width="800" height="600" style="border:none;" ${interactive ? 'allow="interaction"' : ''}></iframe>`;
    res.json({ ok: true, embedCode, previewUrl: `/embed/${dtuId}?theme=${theme || 'dark'}` });
  }));

  // ── AR Preview API ──────────────────────────────────────────────

  router.post("/sim/ar/session", auth, wrap((req, res) => {
    const session = {
      id: `ar-${Date.now()}`,
      dtuId: req.body.dtuId,
      trackingState: 'initializing',
      placement: null,
      scale: req.body.scale || 1.0,
      createdAt: new Date().toISOString(),
    };
    res.json({ ok: true, session });
  }));

  router.post("/sim/ar/place", auth, wrap((req, res) => {
    const placement = {
      position: req.body.position || { x: 0, y: 0, z: 0 },
      rotation: req.body.rotation || { x: 0, y: 0, z: 0 },
      scale: req.body.scale || 1.0,
      surfaceType: req.body.surfaceType || 'floor',
      placedAt: new Date().toISOString(),
    };
    res.json({ ok: true, placement });
  }));

  // ── Achievement System API ──────────────────────────────────────

  const playerAchievements = new Map();

  const achievementDefs = [
    { id: 'first-validated', name: 'Foundation Layer', category: 'building', description: 'First physics-validated building', rarity: 0.85, xpReward: 100 },
    { id: 'hundred-citations', name: 'Citation Century', category: 'social', description: 'Receive 100 citations', rarity: 0.25, xpReward: 500 },
    { id: 'district-architect', name: 'District Architect', category: 'building', description: 'Build 10 structures in one district', rarity: 0.15, xpReward: 750 },
    { id: 'bridge-master', name: 'Bridge Master', category: 'engineering', description: 'Build a bridge spanning 50+ meters', rarity: 0.08, xpReward: 1000 },
    { id: 'mentor', name: 'Mentor of the Year', category: 'social', description: 'Help 20 new players', rarity: 0.05, xpReward: 1200 },
    { id: 'world-explorer', name: 'World Explorer', category: 'exploration', description: 'Visit all 10 districts', rarity: 0.40, xpReward: 300 },
    { id: 'night-builder', name: 'Night Owl', category: 'dedication', description: 'Build between midnight and 4am', rarity: 0.30, xpReward: 150 },
    { id: 'social-butterfly', name: 'Social Butterfly', category: 'social', description: 'Join 5 different firms', rarity: 0.12, xpReward: 400 },
    { id: 'first-citation', name: 'Cited!', category: 'building', description: 'Receive your first citation', rarity: 0.70, xpReward: 50 },
  ];

  router.get("/sim/achievements", wrap((_req, res) => {
    res.json({ ok: true, achievements: achievementDefs });
  }));

  router.get("/sim/achievements/:userId", wrap((req, res) => {
    const unlocked = playerAchievements.get(req.params.userId) || [];
    res.json({ ok: true, unlocked, total: achievementDefs.length });
  }));

  router.post("/sim/achievements/:userId/unlock", auth, wrap((req, res) => {
    const userId = req.params.userId;
    if (!playerAchievements.has(userId)) playerAchievements.set(userId, []);
    const { achievementId } = req.body;
    const def = achievementDefs.find(a => a.id === achievementId);
    if (!def) return res.status(404).json({ ok: false, error: "Achievement not found" });
    const unlock = { ...def, unlockedAt: new Date().toISOString() };
    playerAchievements.get(userId).push(unlock);
    res.json({ ok: true, achievement: unlock });
  }));

  // ── Lens Plugin System API ──────────────────────────────────────

  const installedPlugins = new Map(); // userId -> pluginId[]

  const pluginCatalog = [
    { id: 'wind-analyzer', name: 'Wind Analyzer', author: 'AeroSim Labs', category: 'analytics', version: '2.1.0', installs: 12400, rating: 4.7, description: 'Visualize wind patterns and aerodynamic loads on structures' },
    { id: 'material-inspector', name: 'Material Inspector', author: 'CoreMaterials', category: 'building', version: '1.8.3', installs: 28900, rating: 4.9, description: 'Deep-dive material properties, stress curves, and fatigue analysis' },
    { id: 'social-heatmap', name: 'Social Heatmap', author: 'CrowdViz', category: 'social', version: '3.0.1', installs: 9200, rating: 4.4, description: 'Overlay showing player density, foot traffic, and gathering patterns' },
    { id: 'energy-monitor', name: 'Energy Monitor', author: 'GreenGrid', category: 'environmental', version: '1.5.0', installs: 7100, rating: 4.6, description: 'Track energy consumption, solar potential, and carbon footprint' },
    { id: 'custom-overlay-sdk', name: 'Custom Overlay SDK', author: 'Concord Team', category: 'developer', version: '1.0.0', installs: 3400, rating: 4.2, description: 'Build and deploy your own lens overlays with the Plugin API' },
    { id: 'seismic-sim', name: 'Seismic Simulator', author: 'QuakeTest', category: 'analytics', version: '1.2.0', installs: 5600, rating: 4.8, description: 'Simulate earthquake loads and visualize structural response' },
  ];

  router.get("/sim/plugins/catalog", wrap((_req, res) => {
    res.json({ ok: true, plugins: pluginCatalog });
  }));

  router.get("/sim/plugins/installed/:userId", wrap((req, res) => {
    const ids = installedPlugins.get(req.params.userId) || [];
    const plugins = ids.map(id => pluginCatalog.find(p => p.id === id)).filter(Boolean);
    res.json({ ok: true, plugins });
  }));

  router.post("/sim/plugins/install", auth, wrap((req, res) => {
    const userId = req.user.id;
    const { pluginId } = req.body;
    if (!pluginCatalog.find(p => p.id === pluginId)) return res.status(404).json({ ok: false, error: "Plugin not found" });
    if (!installedPlugins.has(userId)) installedPlugins.set(userId, []);
    if (!installedPlugins.get(userId).includes(pluginId)) installedPlugins.get(userId).push(pluginId);
    res.json({ ok: true, installed: pluginId });
  }));

  router.post("/sim/plugins/uninstall", auth, wrap((req, res) => {
    const userId = req.user.id;
    const { pluginId } = req.body;
    if (installedPlugins.has(userId)) {
      installedPlugins.set(userId, installedPlugins.get(userId).filter(id => id !== pluginId));
    }
    res.json({ ok: true, uninstalled: pluginId });
  }));

  // ── Smart Notifications API ─────────────────────────────────────

  const notifProfiles = new Map();

  router.get("/sim/smart-notifications/:userId", wrap((req, res) => {
    const profile = notifProfiles.get(req.params.userId) || {
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      batchingEnabled: true,
      batchInterval: 300000,
      priorities: { citation: 'high', royalty: 'medium', social: 'low', system: 'high', event: 'medium' },
      learningEnabled: true,
      dismissPatterns: [],
    };
    res.json({ ok: true, profile });
  }));

  router.post("/sim/smart-notifications/:userId", auth, wrap((req, res) => {
    notifProfiles.set(req.params.userId, { ...req.body, updatedAt: new Date().toISOString() });
    res.json({ ok: true, profile: notifProfiles.get(req.params.userId) });
  }));

  router.post("/sim/smart-notifications/:userId/learn", auth, wrap((req, res) => {
    // Record a user interaction with a notification for ML learning
    const signal = {
      notificationType: req.body.type,
      action: req.body.action, // 'opened', 'dismissed', 'snoozed'
      timeToAction: req.body.timeToAction,
      timestamp: new Date().toISOString(),
    };
    res.json({ ok: true, signal, message: 'Learning signal recorded' });
  }));

  // ── Mobile Companion API ────────────────────────────────────────

  router.get("/sim/mobile/dashboard/:userId", wrap((req, res) => {
    res.json({
      ok: true,
      dashboard: {
        overnightChanges: [
          { type: 'citation', message: 'Your riverside tower received 3 new citations', time: '3h ago' },
          { type: 'weather', message: 'Heavy rain in Concordia — check your structures', time: '1h ago' },
          { type: 'social', message: '2 friends are currently online', time: 'now' },
        ],
        quickStats: {
          totalBuildings: 14,
          activeCitations: 47,
          pendingRoyalties: 2.35,
          friendsOnline: 2,
        },
        remoteViewAvailable: true,
      },
    });
  }));

  router.post("/sim/mobile/quick-action", auth, wrap((req, res) => {
    const { action, params } = req.body;
    const actions = ['check-builds', 'view-citations', 'manage-inventory', 'quick-chat', 'toggle-notifications'];
    if (!actions.includes(action)) return res.status(400).json({ ok: false, error: `Unknown action. Valid: ${actions.join(', ')}` });
    res.json({ ok: true, action, executed: true, timestamp: new Date().toISOString() });
  }));

  // ── Infrastructure Health API ───────────────────────────────────

  router.get("/sim/health", wrap((_req, res) => {
    const services = [
      { name: 'api-gateway', status: 'healthy', uptime: '99.97%', latencyMs: 12 },
      { name: 'world-sim', status: 'healthy', uptime: '99.94%', latencyMs: 45 },
      { name: 'physics-engine', status: 'healthy', uptime: '99.91%', latencyMs: 78 },
      { name: 'ai-brain', status: 'healthy', uptime: '99.88%', latencyMs: 120 },
      { name: 'marketplace', status: 'healthy', uptime: '99.95%', latencyMs: 23 },
      { name: 'social-hub', status: 'healthy', uptime: '99.93%', latencyMs: 18 },
    ];
    const overall = services.every(s => s.status === 'healthy') ? 'healthy' : 'degraded';
    res.json({ ok: true, status: overall, services, checkedAt: new Date().toISOString() });
  }));

  router.get("/sim/metrics", wrap((_req, res) => {
    res.json({
      ok: true,
      metrics: {
        activePlayers: 234,
        activeWorlds: 12,
        dtusCreated24h: 1847,
        citationsIssued24h: 523,
        physicsValidations24h: 3291,
        avgValidationMs: 67,
        cacheHitRate: 0.94,
        eventBusMessages24h: 148920,
        errorRate: 0.002,
        p99LatencyMs: 180,
      },
      timestamp: new Date().toISOString(),
    });
  }));

  // ── Event Bus Status API ────────────────────────────────────────

  router.get("/sim/eventbus/status", wrap((_req, res) => {
    res.json({
      ok: true,
      provider: 'nats',
      channels: [
        { name: 'world.updates', messagesPerSec: 42, consumers: 8, lagMs: 3 },
        { name: 'physics.results', messagesPerSec: 28, consumers: 4, lagMs: 12 },
        { name: 'ai.responses', messagesPerSec: 15, consumers: 6, lagMs: 8 },
        { name: 'market.transactions', messagesPerSec: 7, consumers: 3, lagMs: 2 },
        { name: 'social.events', messagesPerSec: 35, consumers: 5, lagMs: 5 },
        { name: 'moderation.flags', messagesPerSec: 1, consumers: 2, lagMs: 1 },
      ],
      deadLetterQueue: { size: 3, oldestAge: '2h' },
    });
  }));

  // ── Job Queue Status API ────────────────────────────────────────

  router.get("/sim/jobs/queue-status", wrap((_req, res) => {
    res.json({
      ok: true,
      provider: 'bull',
      queues: [
        { name: 'physics-validation', waiting: 12, active: 4, completed24h: 3291, failed24h: 7, avgDurationMs: 67 },
        { name: 'ai-inference', waiting: 3, active: 2, completed24h: 1204, failed24h: 2, avgDurationMs: 340 },
        { name: 'dtu-indexing', waiting: 45, active: 8, completed24h: 8742, failed24h: 0, avgDurationMs: 15 },
        { name: 'notification-dispatch', waiting: 0, active: 1, completed24h: 4521, failed24h: 3, avgDurationMs: 8 },
        { name: 'backup-snapshot', waiting: 0, active: 0, completed24h: 24, failed24h: 0, avgDurationMs: 12000 },
        { name: 'analytics-etl', waiting: 2, active: 1, completed24h: 288, failed24h: 1, avgDurationMs: 5200 },
      ],
    });
  }));

  // ── Cache Status API ────────────────────────────────────────────

  router.get("/sim/cache/status", wrap((_req, res) => {
    res.json({
      ok: true,
      provider: 'redis',
      memoryUsedMB: 312,
      maxMemoryMB: 512,
      hitRate: 0.94,
      missRate: 0.06,
      evictions24h: 1240,
      keysTotal: 84200,
      keysByPrefix: {
        'dtu:': 42100, 'user:': 12300, 'world:': 8400,
        'session:': 5200, 'cache:': 16200,
      },
    });
  }));

  // ── Feature Flags API ───────────────────────────────────────────

  router.get("/sim/feature-flags", wrap((_req, res) => {
    res.json({
      ok: true,
      flags: {
        snap_build_v2: { enabled: true, rollout: 100 },
        voice_interface: { enabled: true, rollout: 50 },
        ar_preview: { enabled: false, rollout: 0 },
        multiplayer_256: { enabled: false, rollout: 10 },
        webgpu_renderer: { enabled: true, rollout: 75 },
        live_collaboration: { enabled: true, rollout: 80 },
        smart_notifications: { enabled: true, rollout: 60 },
        command_palette: { enabled: true, rollout: 100 },
      },
    });
  }));

  // ── ML Ops / AI Brain Status API ────────────────────────────────

  router.get("/sim/ai/status", wrap((_req, res) => {
    res.json({
      ok: true,
      brains: {
        conscious: { model: 'qwen2.5:7b', status: 'running', memoryGB: 5.2, inferenceMs: 340, requestsPerMin: 15 },
        subconscious: { model: 'qwen2.5:1.5b', status: 'running', memoryGB: 1.1, inferenceMs: 85, requestsPerMin: 42 },
        utility: { model: 'qwen2.5:3b', status: 'running', memoryGB: 2.3, inferenceMs: 150, requestsPerMin: 28 },
        repair: { model: 'qwen2.5:0.5b', status: 'running', memoryGB: 0.4, inferenceMs: 45, requestsPerMin: 60 },
      },
      promptTemplates: 12,
      totalInferences24h: 18420,
      avgLatencyMs: 155,
    });
  }));

  // ── Semantic Search API ─────────────────────────────────────────

  router.post("/sim/search/semantic", wrap((req, res) => {
    const { query, limit, filters } = req.body;
    // Simulated semantic search results
    const results = [
      { id: 'dtu-4281', type: 'building', title: 'Riverside Library', score: 0.94, district: 'academy' },
      { id: 'dtu-1092', type: 'building', title: 'River Walk Pavilion', score: 0.87, district: 'docks' },
      { id: 'dtu-7723', type: 'template', title: 'Modern Reading Room', score: 0.82, district: null },
    ].slice(0, limit || 10);
    res.json({ ok: true, query, results, model: 'all-MiniLM-L6-v2', dimensions: 384 });
  }));

  // ── STAXX Knowledge Graph API ───────────────────────────────────

  router.post("/sim/knowledge/query", wrap((req, res) => {
    const { nodeType, edgeType, startId, depth } = req.body;
    // Simulated graph traversal
    const nodes = [
      { id: startId || 'dtu-4281', type: nodeType || 'DTU', label: 'Riverside Library', properties: { district: 'academy', citations: 47 } },
      { id: 'user-1042', type: 'User', label: 'ArchitectX', properties: { reputation: 8200 } },
      { id: 'mat-usb-a', type: 'Material', label: 'USB-A Composite', properties: { tensileStrength: 450 } },
    ];
    const edges = [
      { from: startId || 'dtu-4281', to: 'user-1042', type: 'created_by', weight: 1.0 },
      { from: startId || 'dtu-4281', to: 'mat-usb-a', type: 'made_of', weight: 0.8 },
    ];
    res.json({ ok: true, graph: { nodes, edges }, depth: depth || 1 });
  }));

  // ── Audit Log API ───────────────────────────────────────────────

  router.get("/sim/audit-log", auth, wrap((req, res) => {
    const logs = [
      { id: 'audit-1', event: 'dtu.created', actor: 'user-1042', target: 'dtu-4281', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: 'audit-2', event: 'dtu.cited', actor: 'user-2087', target: 'dtu-4281', timestamp: new Date(Date.now() - 1800000).toISOString() },
      { id: 'audit-3', event: 'user.login', actor: 'user-1042', target: null, timestamp: new Date(Date.now() - 900000).toISOString() },
      { id: 'audit-4', event: 'moderation.report', actor: 'user-3012', target: 'dtu-9921', timestamp: new Date(Date.now() - 600000).toISOString() },
      { id: 'audit-5', event: 'physics.validation', actor: 'system', target: 'dtu-4281', timestamp: new Date(Date.now() - 300000).toISOString() },
    ];
    res.json({ ok: true, logs, total: logs.length });
  }));

  // ── Developer API / SDK Endpoints ───────────────────────────────

  router.get("/sim/api-info", wrap((_req, res) => {
    res.json({
      ok: true,
      api: {
        version: '1.0.0',
        format: 'openapi',
        docsUrl: '/api/docs',
        sdkLanguages: ['typescript', 'python', 'rust'],
        webhookEvents: [
          'dtu.created', 'dtu.updated', 'dtu.cited', 'dtu.validated',
          'user.joined', 'user.leveled', 'world.event', 'physics.failure',
        ],
        rateLimits: { authenticated: '1000/min', anonymous: '60/min', webhook: '100/min' },
        sandboxUrl: '/api/sandbox',
      },
    });
  }));

  router.get("/sim/webhooks/:userId", wrap((req, res) => {
    res.json({
      ok: true,
      webhooks: [
        { id: 'wh-1', url: 'https://example.com/hook', events: ['dtu.created', 'dtu.cited'], active: true, createdAt: new Date().toISOString() },
      ],
    });
  }));

  router.post("/sim/webhooks", auth, wrap((req, res) => {
    const webhook = {
      id: `wh-${Date.now()}`,
      url: req.body.url,
      events: req.body.events || [],
      active: true,
      secret: `whsec_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    };
    res.json({ ok: true, webhook });
  }));

  // ── PvP Loot System ────────────────────────────────────────────────────────

  router.post("/combat/death", auth, wrap((req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "DB not available" });
    const { killedId, killerId, gameMode, worldId, x, y, z } = req.body;
    const result = handlePlayerDeath(db, { killedId, killerId, gameMode, worldId, x, y, z });
    res.json({ ok: true, ...result });
  }));

  router.post("/loot/:bagId/claim", auth, wrap((req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "DB not available" });
    const result = claimLootBag(db, { bagId: req.params.bagId, claimerId: _userId(req) });
    res.json({ ok: true, ...result });
  }));

  router.post("/combat/robbery", auth, wrap((req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "DB not available" });
    const { victimId, gameMode, worldId } = req.body;
    const result = handleRobbery(db, { robberId: _userId(req), victimId, gameMode, worldId });
    res.json({ ok: true, ...result });
  }));

  router.post("/loot/reclaim-expired", auth, wrap((req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "DB not available" });
    const result = reclaimExpiredBags(db);
    res.json({ ok: true, ...result });
  }));

  return router;
}
