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

import crypto from "node:crypto";
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
  getOrgsForUser,
  projectPublicOrganization,
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
import { HUB_WORLD_ID } from "../lib/world-ids.js";
import { renderDtuAsFile, DOCUMENT_EXPORT_FORMATS } from "../lib/dtu-document-export.js";
import { ctxMayReadDtu } from "../lib/dtu-read-access.js";
import {
  readDailyDigest,
  readPersonalAnalytics,
  readWorldAnalytics,
  readGlobalAnalytics,
} from "../lib/sim-stats.js";
import {
  readSeasonalCurrent,
  readSimFlags,
  readBrainStatus,
  isSimAdmin,
  publicBrainStatus,
  searchSimSemantic,
  querySimKnowledge,
  readSimAudit,
  readSimPrefs,
  writeSimPrefs,
} from "../lib/sim-live.js";
import {
  readSimHealth,
  readSimMetrics,
  readEventBusStatus,
  readJobQueueStatus,
  readCacheStatus,
  readConcordiaHub,
  readDistrictLeaderboard,
  readDistrictTimeline,
  readStressTest,
  readScene,
  readPluginCatalog,
  readInstalledPlugins,
  readPluginInstallWrite,
  readNotifProfile,
  writeNotifProfile,
  recordNotifSignal,
  readMobileDashboard,
  runQuickAction,
} from "../lib/sim-infra.js";

/**
 * @param {object} [opts]
 * @param {Function} [opts.requireAuth] - Auth middleware
 * @returns {Router}
 */
export default function createWorldRoutes({ requireAuth, db = null, emitToUser = null, dtuStore = null } = {}) {
  const router = Router();

  function _userId(req) {
    // AuthDB users expose `.id` (not `.userId`). Never trust body.userId —
    // a client could otherwise join/leave as another account.
    return req.user?.id ?? req.user?.userId ?? req.actor?.userId ?? null;
  }

  // Auth middleware stores the account id on req.user.id. Some callers
  // still put it on req.user.userId. The list must not trust a body field
  // to decide whose membership to reveal.
  function _viewerIds(req) {
    return [req.user?.id, req.user?.userId, req.actor?.userId].filter(Boolean);
  }

  function _membershipByOrg(db, req) {
    const mine = new Map();
    for (const id of _viewerIds(req)) {
      for (const membership of getOrgsForUser(db, id)) {
        if (!mine.has(membership.orgId)) mine.set(membership.orgId, membership.role);
      }
    }
    return mine;
  }

  function _projectOrgForViewer(org, req, membershipRole) {
    const pub = projectPublicOrganization(org);
    if (!pub) return null;
    if (membershipRole) pub.myRole = membershipRole;
    if (org.leaderId && _viewerIds(req).includes(org.leaderId)) pub.viewerIsLeader = true;
    return pub;
  }

  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  function sendSim(res, result) {
    const http = Number.isInteger(result.status) ? result.status : (result.ok ? 200 : 500);
    const body = { ...result };
    if (Number.isInteger(result.status)) delete body.status;
    res.status(http).json(body);
  }

  function ownSimUser(req, res) {
    const viewer = _userId(req);
    if (!viewer || viewer !== req.params.userId) {
      res.status(403).json({ ok: false, error: "not_your_stats" });
      return null;
    }
    return viewer;
  }

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
    // #R7: signature is (userId, { districtId, workstation }) — passing the two
    // ids positionally left districtId undefined → destructure-of-undefined 500.
    const result = startWorkstationSession(_userId(req), { workstation: workstationId, districtId });
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

  router.get("/orgs", wrap((req, res) => {
    const mine = _membershipByOrg(db, req);
    const orgs = listOrganizations(db)
      .map((org) => _projectOrgForViewer(org, req, mine.get(org.id)))
      .filter(Boolean);
    res.json({ ok: true, organizations: orgs, count: orgs.length });
  }));

  router.post("/orgs", auth, wrap((req, res) => {
    // Leader is always the authenticated account. Ignore body.leaderId /
    // body.userId — those used to let a client name someone else as founder.
    const leaderId = req.user?.id || req.user?.userId || req.actor?.userId || null;
    if (!leaderId) {
      return res.status(401).json({ ok: false, error: "auth_required" });
    }
    const org = createOrganization(db, { ...req.body, leaderId });
    if (!org?.ok) {
      return res.status(400).json({ ok: false, error: org?.error || "create_failed" });
    }
    res.status(201).json({ ok: true, organization: org });
  }));

  router.get("/orgs/:id", wrap((req, res) => {
    const org = getOrganization(db, req.params.id);
    if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });
    const membershipRole = _membershipByOrg(db, req).get(org.id) || null;
    res.json({ ok: true, organization: _projectOrgForViewer(org, req, membershipRole) });
  }));

  router.post("/orgs/:id/join", auth, wrap((req, res) => {
    const userId = _userId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
    const result = joinOrganization(db, req.params.id, userId);
    if (!result?.ok) {
      const status = result?.error === "org_not_found" ? 404
        : result?.error === "already_member" ? 409
          : 400;
      return res.status(status).json({ ok: false, error: result?.error || "join_failed" });
    }
    res.json({ ok: true, ...result });
  }));

  router.post("/orgs/:id/leave", auth, wrap((req, res) => {
    const userId = _userId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
    const result = leaveOrganization(db, req.params.id, userId);
    if (!result?.ok) {
      const status = result?.error === "not_member" ? 404
        : result?.error === "leader_cannot_leave" ? 403
          : 400;
      return res.status(status).json({ ok: false, error: result?.error || "leave_failed" });
    }
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

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
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
    sendSim(res, readConcordiaHub(db));
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
    sendSim(res, readStressTest(db, req.body));
  }));

  // ── Leaderboards API ──────────────────────────────────────────────

  router.get("/sim/leaderboards/:districtId", wrap((req, res) => {
    sendSim(res, readDistrictLeaderboard(db, req.params.districtId));
  }));

  // ── Timeline / History API ────────────────────────────────────────

  router.get("/sim/timeline/:districtId", wrap((req, res) => {
    sendSim(res, readDistrictTimeline(req.params.districtId));
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
      // `id` is what player_equipment points at (lib/combat/loadout.js).
      db.prepare(
        "INSERT INTO player_inventory (id, user_id, item_id, item_name, quantity, slot, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(crypto.randomUUID(), userId, itemId, String(metadata?.name || ""), quantity, slot || null, JSON.stringify(metadata || {}));
      return { quantity };
    } catch (err) {
      logger.warn?.("world-inventory", `db add failed: ${err.message}`);
      return null;
    }
  }

  router.get("/sim/inventory/:userId", auth, wrap(async (req, res) => {
    const userId = req.params.userId;
    // A player's inventory is theirs to read (and an admin's); any logged-in
    // player used to be able to read anyone's by id.
    if (!req.user?.id || (req.user.id !== userId && req.user.role !== "admin")) {
      return res.status(403).json({ ok: false, error: "cannot_read_other_inventory" });
    }
    const dbInv = await getInventoryWithLoadout(userId);
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
    const metadata = req.body.metadata || {
      name: req.body.name || "",
      type: req.body.type || "",
      rarity: req.body.rarity || "common",
    };

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

  // Equipment slots this route accepts, mapped onto the canonical store
  // (player_equipment via lib/combat/loadout.js#equipItem, which combat,
  // durability and death decay read). Slots with no column there are refused
  // rather than recorded somewhere nothing reads. A closed map also keeps a
  // crafted key like "__proto__" from reaching any dynamic assignment.
  const EQUIP_SLOT_TO_LOADOUT = new Map([
    ["head", "head"], ["chest", "body"],
    ["main_hand", "right_hand"], ["off_hand", "left_hand"],
    ["neck", "accessory"], ["ring_left", "accessory"], ["ring_right", "accessory"], ["trinket", "accessory"],
  ]);
  const LOADOUT_TO_EQUIP_SLOT = { head: "head", body: "chest", rightHand: "main_hand", leftHand: "off_hand", accessory: "trinket" };

  router.post("/sim/inventory/:userId/equip", auth, wrap(async (req, res) => {
    const userId = req.params.userId;
    if (req.user?.id && req.user.id !== userId && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "cannot_modify_other_inventory" });
    }
    const { slot, itemId } = req.body;
    if (!slot || !itemId) return res.status(400).json({ ok: false, error: "slot and itemId required" });
    if (typeof slot !== "string" || !EQUIP_SLOT_TO_LOADOUT.has(slot)) {
      return res.status(400).json({ ok: false, error: "invalid slot", slots: [...EQUIP_SLOT_TO_LOADOUT.keys()] });
    }
    if (typeof itemId !== "string" || itemId.length > 64) {
      return res.status(400).json({ ok: false, error: "invalid itemId" });
    }
    if (!db) return res.status(503).json({ ok: false, error: "no_db" });

    // The item must be a real row the caller holds (not a legacy equip marker).
    const row = db.prepare(
      "SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_id = ? AND (slot IS NULL OR slot NOT LIKE 'equipped:%')"
    ).get(userId, itemId);
    if (!row || !(row.quantity > 0)) return res.status(404).json({ ok: false, error: "item_not_owned" });
    let invId = row.id;
    if (!invId) {
      invId = crypto.randomUUID();
      db.prepare("UPDATE player_inventory SET id = ? WHERE user_id = ? AND item_id = ? AND id IS NULL").run(invId, userId, itemId);
    }
    const { equipItem } = await import("../lib/combat/loadout.js");
    const r = equipItem(db, userId, EQUIP_SLOT_TO_LOADOUT.get(slot), invId);
    if (!r.ok) return res.status(400).json(r);
    const dbInv = await getInventoryWithLoadout(userId);
    return res.json({ ok: true, slot: r.slot, equipped: dbInv?.equipped || {} });
  }));

  // getInventoryFromDb plus the canonical loadout, reported by item_id under
  // this route's slot names. Legacy `equipped:<slot>` marker rows still show
  // where the loadout has nothing for that slot.
  async function getInventoryWithLoadout(userId) {
    const inv = getInventoryFromDb(userId);
    if (!inv || !db) return inv;
    try {
      const { getLoadout } = await import("../lib/combat/loadout.js");
      const lo = getLoadout(db, userId);
      for (const [key, name] of Object.entries(LOADOUT_TO_EQUIP_SLOT)) {
        if (lo?.[key]?.item_id) inv.equipped[name] = lo[key].item_id;
      }
    } catch { /* player_equipment optional on minimal builds */ }
    return inv;
  }

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

  // Crafting happens at POST /api/crafting/execute (routes/crafting.js →
  // lib/crafting/craft-engine.js), which consumes real inventory and awards
  // craft XP. This route used to return an invented output item with a
  // random quality bonus, consuming and persisting nothing; it now says where
  // the real path is.
  router.post("/sim/crafting/craft", auth, wrap((_req, res) => {
    res.status(410).json({
      ok: false,
      error: "use_crafting_execute",
      detail: "POST /api/crafting/execute {recipeId, worldId} crafts from real inventory; recipes come from GET /api/crafting/recipes.",
    });
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
    const viewer = req.user?.id || req.user?.userId || null;
    if (!viewer || viewer !== req.params.userId) {
      return res.status(403).json({ ok: false, error: "not_your_stats" });
    }
    const result = readDailyDigest(db, viewer);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, digest: result.digest });
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
      sourceWorld: HUB_WORLD_ID, destWorld: destWorldId,
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
    res.status(501).json({
      ok: false,
      error: "unavailable",
      reason: "no_project_board",
      message: "No project board is stored for this id. Tasks and payments were not invented.",
    });
  }));

  router.post("/sim/projects/:boardId/tasks", auth, wrap((_req, res) => {
    res.status(501).json({
      ok: false,
      error: "unavailable",
      reason: "no_project_board",
      message: "Project tasks are not stored. Nothing was created.",
    });
  }));

  router.post("/sim/projects/:boardId/tasks/:taskId/claim", auth, wrap((_req, res) => {
    res.status(501).json({
      ok: false,
      error: "unavailable",
      reason: "no_project_board",
      message: "Project tasks are not stored. Nothing was claimed.",
    });
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
    const verdict = req.body?.verdict || "";
    const comments = req.body?.comments || "";
    res.json({ ok: true, reviewId: req.params.id, verdict, comments });
  }));

  // ── Analytics API ────────────────────────────────────────────────

  router.get("/sim/analytics/personal/:userId", wrap((req, res) => {
    const viewer = req.user?.id || req.user?.userId || null;
    if (!viewer || viewer !== req.params.userId) {
      return res.status(403).json({ ok: false, error: "not_your_stats" });
    }
    const result = readPersonalAnalytics(db, viewer);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, stats: result.stats });
  }));

  router.get("/sim/analytics/world/:worldId", wrap((req, res) => {
    const result = readWorldAnalytics(db, req.params.worldId);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, stats: result.stats });
  }));

  router.get("/sim/analytics/global", wrap((_req, res) => {
    const result = readGlobalAnalytics(db);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, stats: result.stats });
  }));

  // ── Seasonal / Events Calendar API ───────────────────────────────

  router.get("/sim/seasonal/current", wrap((req, res) => {
    const worldId = typeof req.query.worldId === "string" ? req.query.worldId : "";
    res.json(readSeasonalCurrent(db, { worldId }));
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
    sendSim(res, readScene(req.params.districtId, district));
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

  function simViewerId(req) {
    return req.user?.id || req.user?.userId || null;
  }
  function ownSimPrefs(req, kind, write) {
    const viewer = simViewerId(req);
    if (!viewer || viewer !== req.params.userId) {
      return { ok: false, status: 403, error: "not_your_settings" };
    }
    return write
      ? writeSimPrefs(db, viewer, kind, req.body)
      : readSimPrefs(db, viewer, kind);
  }

  router.get("/sim/accessibility/:userId", wrap((req, res) => {
    const result = ownSimPrefs(req, "accessibility", false);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, settings: result.settings });
  }));

  router.post("/sim/accessibility/:userId", auth, wrap((req, res) => {
    const result = ownSimPrefs(req, "accessibility", true);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, settings: result.settings });
  }));

  // ── Settings API ─────────────────────────────────────────────────

  router.get("/sim/settings/:userId", wrap((req, res) => {
    const result = ownSimPrefs(req, "settings", false);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, settings: result.settings });
  }));

  router.post("/sim/settings/:userId", auth, wrap((req, res) => {
    const result = ownSimPrefs(req, "settings", true);
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, settings: result.settings });
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
      match: detectedIntent === 'unknown' ? 'none' : 'keyword',
      confidence: null,
      parsedAt: new Date().toISOString(),
      executed: false,
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

  // Rendered through lib/dtu-document-export.js (the exporter behind
  // document.export_dtu), from the in-memory DTU store that macro reads.
  // Owner always; anyone else only visibility public/published rows that are
  // not shadow, quarantined, personal/user-scoped or marked private.
  const SIM_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

  function _simExportStore() {
    return dtuStore || globalThis._concordSTATE?.dtus || null;
  }

  function _simExportHidden(dtu, callerId) {
    // The app-wide by-id read gate first (private, followers-only, user scope,
    // quarantine, internal, ownerless user-sourced rows).
    if (!ctxMayReadDtu({ actor: { id: callerId || null } }, dtu)) return true;
    const owners = [dtu.ownerId, dtu.author, dtu.userId, dtu.createdBy, dtu.creatorId, dtu.creator_id].filter(Boolean);
    if (callerId && owners.includes(callerId)) return false;
    // Non-owners get full content, so also refuse marketplace (paid), shadow,
    // and personal-scope rows.
    if (dtu.meta?.scope === "personal" || dtu.data?.scope === "personal") return true;
    if (dtu.visibility !== "public" && dtu.visibility !== "published") return true;
    if (dtu.tier === "shadow") return true;
    if (typeof dtu.status === "string" && dtu.status.startsWith("quarantine")) return true;
    if (dtu.scope === "personal" || dtu.scope === "user") return true;
    if (dtu.privacy === "private" || dtu.privacy === "followers-only") return true;
    return false;
  }

  router.post("/sim/export", auth, wrap(async (req, res) => {
    const { dtuId, format } = req.body || {};
    if (!dtuId || typeof dtuId !== "string") return res.status(400).json({ ok: false, error: "dtuId required" });
    const fmt = String(format || "pdf").toLowerCase();
    if (!DOCUMENT_EXPORT_FORMATS.includes(fmt)) {
      return res.status(400).json({ ok: false, error: "unsupported_format", supportedFormats: DOCUMENT_EXPORT_FORMATS });
    }
    const store = _simExportStore();
    if (!store || typeof store.get !== "function") {
      return res.status(501).json({
        ok: false, error: "unavailable", reason: "not_wired",
        missing: "DTU store (STATE.dtus) is not available in this process",
      });
    }
    const dtu = store.get(dtuId);
    if (!dtu || _simExportHidden(dtu, _userId(req))) {
      return res.status(404).json({ ok: false, error: "dtu_not_found" });
    }
    let rendered;
    try {
      rendered = await renderDtuAsFile(dtu, fmt);
    } catch {
      return res.status(501).json({
        ok: false, error: "unavailable", reason: "render_failed", format: fmt,
        message: `The ${fmt} renderer failed on this DTU. Nothing was exported.`,
      });
    }
    if (!rendered.ok) {
      return res.status(400).json({ ok: false, error: rendered.error, supportedFormats: rendered.supportedFormats || DOCUMENT_EXPORT_FORMATS });
    }
    if (rendered.buffer.length > SIM_EXPORT_MAX_BYTES) {
      return res.status(413).json({ ok: false, error: "export_too_large", bytes: rendered.buffer.length, maxBytes: SIM_EXPORT_MAX_BYTES });
    }
    res.json({
      ok: true, dtuId, format: fmt,
      filename: rendered.filename, mimeType: rendered.mimeType,
      bytes: rendered.buffer.length, encoding: "base64",
      content: rendered.buffer.toString("base64"),
    });
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

  router.get("/sim/plugins/catalog", wrap((_req, res) => {
    sendSim(res, readPluginCatalog(db));
  }));

  router.get("/sim/plugins/installed/:userId", wrap((req, res) => {
    if (!_userId(req)) return res.status(401).json({ ok: false, error: "sign_in_required" });
    if (!ownSimUser(req, res)) return;
    sendSim(res, readInstalledPlugins());
  }));

  router.post("/sim/plugins/install", auth, wrap((_req, res) => {
    sendSim(res, readPluginInstallWrite());
  }));

  router.post("/sim/plugins/uninstall", auth, wrap((_req, res) => {
    sendSim(res, readPluginInstallWrite());
  }));

  // ── Smart Notifications API ─────────────────────────────────────

  router.get("/sim/smart-notifications/:userId", wrap((req, res) => {
    const viewer = ownSimUser(req, res);
    if (!viewer) return;
    sendSim(res, readNotifProfile(viewer));
  }));

  router.post("/sim/smart-notifications/:userId", auth, wrap((req, res) => {
    const viewer = ownSimUser(req, res);
    if (!viewer) return;
    sendSim(res, writeNotifProfile(viewer, req.body));
  }));

  router.post("/sim/smart-notifications/:userId/learn", auth, wrap((req, res) => {
    const viewer = ownSimUser(req, res);
    if (!viewer) return;
    sendSim(res, recordNotifSignal(viewer, req.body));
  }));

  // ── Mobile Companion API ────────────────────────────────────────

  router.get("/sim/mobile/dashboard/:userId", wrap((req, res) => {
    const viewer = ownSimUser(req, res);
    if (!viewer) return;
    sendSim(res, readMobileDashboard(db, viewer));
  }));

  router.post("/sim/mobile/quick-action", auth, wrap((req, res) => {
    sendSim(res, runQuickAction(db, _userId(req), req.body));
  }));

  // ── Infrastructure Health API ───────────────────────────────────

  router.get("/sim/health", wrap((_req, res) => {
    sendSim(res, readSimHealth());
  }));

  router.get("/sim/metrics", wrap((_req, res) => {
    sendSim(res, readSimMetrics(db));
  }));

  router.get("/sim/eventbus/status", wrap((_req, res) => {
    sendSim(res, readEventBusStatus());
  }));

  router.get("/sim/jobs/queue-status", wrap((_req, res) => {
    sendSim(res, readJobQueueStatus());
  }));

  router.get("/sim/cache/status", wrap((_req, res) => {
    sendSim(res, readCacheStatus());
  }));

  // ── Feature Flags API ───────────────────────────────────────────

  router.get("/sim/feature-flags", wrap((_req, res) => {
    const flags = readSimFlags();
    res.json(flags);
  }));

  // ── ML Ops / AI Brain Status API ────────────────────────────────

  router.get("/sim/ai/status", wrap(async (req, res) => {
    const admin = isSimAdmin(req.user);
    const probe = admin && req.query.probe !== "0";
    const full = await readBrainStatus({ probe });
    res.json(admin ? full : publicBrainStatus(full));
  }));

  // ── Semantic Search API ─────────────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/sim/search/semantic", wrap(async (req, res) => {
    const result = await searchSimSemantic(db, {
      query: req.body?.query,
      limit: req.body?.limit,
      requesterId: req.user?.id || req.user?.userId || null,
    });
    if (!result.ok) return res.status(result.status).json(result);
    res.json({
      ok: true,
      query: result.query,
      semantic: result.semantic,
      results: result.results,
    });
  }));

  // ── STAXX Knowledge Graph API ───────────────────────────────────

  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/sim/knowledge/query", wrap((req, res) => {
    const result = querySimKnowledge(db, {
      startId: req.body?.startId,
      edgeType: req.body?.edgeType,
      depth: req.body?.depth,
      requesterId: req.user?.id || req.user?.userId || null,
    });
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, graph: result.graph, depth: result.depth, reason: result.reason });
  }));

  // ── Audit Log API ───────────────────────────────────────────────

  router.get("/sim/audit-log", auth, wrap((req, res) => {
    const result = readSimAudit(db, { userId: simViewerId(req), limit: req.query.limit });
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ ok: true, logs: result.logs, total: result.total });
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
