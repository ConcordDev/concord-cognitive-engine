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
  recordJobActivity,
  createBusiness,
  listBusinesses,
  recordBusinessSale,
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
} from "../lib/world-progression.js";

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

/**
 * @param {object} [opts]
 * @param {Function} [opts.requireAuth] - Auth middleware
 * @returns {Router}
 */
export default function createWorldRoutes({ requireAuth } = {}) {
  const router = Router();

  function _userId(req) {
    return req.user?.userId ?? req.actor?.userId ?? req.body?.userId ?? null;
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

  router.get("/districts", wrap((_req, res) => {
    res.json({ ok: true, districts: DISTRICTS, count: DISTRICTS.length });
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

  router.post("/businesses/:id/sale", auth, wrap((req, res) => {
    const { buyerId, itemId, amount } = req.body;
    const result = recordBusinessSale(req.params.id, buyerId, itemId, amount);
    res.json({ ok: true, ...result });
  }));

  // ── Progression ──────────────────────────────────────────────────────────

  // GET /progression/me — get mastery profile for the authenticated user
  router.get("/progression/me", wrap((req, res) => {
    const userId = _userId(req) || req.user?.id || req.query.userId;
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
    const result = recordDailyLogin(_userId(req));
    res.json({ ok: true, ...result });
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

  router.post("/events/:id/end", auth, wrap((req, res) => {
    const result = endEvent(req.params.id, _userId(req));
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

  return router;
}
