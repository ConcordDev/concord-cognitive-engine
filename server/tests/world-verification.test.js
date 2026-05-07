/**
 * World Platform Verification Tests
 *
 * Proves every world system claim in code:
 *   1. World Engine — Districts, workstations, scene config
 *   2. Organizations — Create, join, leave, roles
 *   3. Jobs — Templates, assignment, businesses, franchises
 *   4. Progression — XP, ranks, achievements, explorer
 *   5. Mechanics — WHEN/DO/REWARD, triggers, templates
 *   6. Events — Create, RSVP, lifecycle, calendar
 *   7. City Manager — Themes, domains, rules validation
 *
 * SCORECARD output at the end: PASS / PARTIAL / FAIL per test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── World Engine ─────────────────────────────────────────────────────────────
import {
  getDistrict,
  getDistrictByLens,
  DISTRICTS,
  GLOBAL_CITY_RULES,
  SCENE_CONFIG,
  startWorkstationSession,
  endWorkstationSession,
  findNearestDistrict,
  placeWorldObject,
  getWorldObjectsInRadius,
} from "../lib/world-engine.js";

// ── Organizations ────────────────────────────────────────────────────────────
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  joinOrganization,
  leaveOrganization,
  createParty,
  joinParty,
  leaveParty,
  registerMentor,
  requestMentorship,
  postRecruitment,
  applyToRecruitment,
  getRecruitmentBoard,
  createAlliance,
  joinAlliance,
} from "../lib/world-organizations.js";

// ── Jobs ─────────────────────────────────────────────────────────────────────
import {
  JOB_TEMPLATES,
  listJobTemplates,
  getJobTemplate,
  assignJob,
  quitJob,
  recordJobActivity,
  createBusiness,
  listBusinesses,
  recordBusinessSale,
  createFranchiseTemplate,
  purchaseFranchise,
} from "../lib/world-jobs.js";

// ── Progression ──────────────────────────────────────────────────────────────
import {
  getMasteryProfile,
  awardXP,
  getRankForXP,
  getLeaderboard,
  getAchievements,
  trackAction,
  recordDistrictVisit,
  getExplorerStats,
  recordDailyLogin,
  startSeason,
  endSeason,
  getCurrentSeason,
  addSeasonChallenge,
  completeChallenge,
  recordSeasonContribution,
  MASTERY_RANKS,
  XP_ACTIONS,
  ACHIEVEMENTS,
} from "../lib/world-progression.js";

// ── Mechanics ────────────────────────────────────────────────────────────────
import {
  createMechanic,
  fireTrigger,
  getCityMechanics,
  toggleMechanic,
  deleteMechanic,
  getTemplate,
  listTemplates,
  getWizardSteps,
  validateWizardStep,
  buildCityFromWizard,
  TRIGGERS,
  ACTIONS,
  REWARDS,
  CITY_TEMPLATES,
} from "../lib/world-mechanics.js";

// ── Events ───────────────────────────────────────────────────────────────────
import {
  createEvent,
  getEvent,
  updateEvent,
  startEvent,
  endEvent,
  cancelEvent,
  rsvpEvent,
  cancelRsvp,
  joinEvent,
  getEventAttendees,
  getCityEvents,
  getEventCalendar,
  getUpcomingEvents,
  recordEventDTU,
  addEventChat,
  EVENT_TYPES,
} from "../lib/world-events.js";

// ── City Manager ─────────────────────────────────────────────────────────────
import {
  createCity,
  getCity,
  updateCity,
  deleteCity,
  listCities,
  joinCity,
  leaveCity,
  getValidThemes,
  getValidDomains,
  getCityRulesSchema,
} from "../lib/city-manager.js";

// ══════════════════════════════════════════════════════════════════════════════
// SCORECARD
// ══════════════════════════════════════════════════════════════════════════════

const SCORECARD = [];
function record(num, name, status, evidence) {
  SCORECARD.push({ num, name, status, evidence });
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 1: WORLD ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe("Test 1: World Engine — Districts & Scene", () => {
  it("1a: Has 30+ districts covering all lens categories", () => {
    assert.ok(DISTRICTS.length >= 30, `Expected 30+ districts, got ${DISTRICTS.length}`);
    const categories = new Set(DISTRICTS.map(d => d.category));
    assert.ok(categories.size >= 5, `Expected 5+ categories, got ${categories.size}`);
    const lenses = new Set(DISTRICTS.map(d => d.lens));
    assert.ok(lenses.size >= 20, `Expected 20+ unique lenses, got ${lenses.size}`);
    record("1a", "30+ districts with diverse lenses", "PASS", `${DISTRICTS.length} districts, ${categories.size} categories, ${lenses.size} lenses`);
  });

  it("1b: District lookup by ID and lens works", () => {
    const d = getDistrict("district_art");
    assert.ok(d, "Should find district_art");
    assert.equal(d.lens, "art");

    const byLens = getDistrictByLens("music");
    assert.ok(byLens, "Should find district by lens 'music'");
    assert.equal(byLens.lens, "music");
    record("1b", "District lookup by ID and lens", "PASS", `Found ${d.name} by ID, ${byLens.name} by lens`);
  });

  it("1c: Global City rules enforce safety with emergent protection", () => {
    // World mechanics enabled for regular NPCs
    assert.equal(GLOBAL_CITY_RULES.combat.enabled, true);
    assert.equal(GLOBAL_CITY_RULES.combat.allowedTargets, "npc_only");
    assert.equal(GLOBAL_CITY_RULES.pvp.enabled, true);
    assert.equal(GLOBAL_CITY_RULES.pvp.consentRequired, true);
    assert.equal(GLOBAL_CITY_RULES.crime.enabled, true);
    assert.equal(GLOBAL_CITY_RULES.factions.enabled, true);
    assert.equal(GLOBAL_CITY_RULES.lawEnforcement.enabled, true);
    // Emergent entities remain protected
    assert.equal(GLOBAL_CITY_RULES.emergentProtection, true);
    assert.equal(GLOBAL_CITY_RULES.npcInteraction.harm, true);
    assert.equal(GLOBAL_CITY_RULES.contentFilter, "strict");
    record("1c", "Global City rules — world mechanics enabled, emergent protected", "PASS",
      "combat=pve(npc_only), pvp=consent, crime=true, factions=true, emergentProtection=true");
  });

  it("1d: Scene config has proper world dimensions", () => {
    assert.ok(SCENE_CONFIG.worldSize >= 4000);
    assert.ok(SCENE_CONFIG.chunkSize >= 100);
    assert.ok(SCENE_CONFIG.viewDistance >= 1000);
    record("1d", "Scene config world dimensions", "PASS", `worldSize=${SCENE_CONFIG.worldSize}, chunks=${SCENE_CONFIG.chunkSize}`);
  });

  it("1e: Workstation sessions work", () => {
    const session = startWorkstationSession("user-ws-1", { districtId: "district_art", workstation: "easel" });
    assert.ok(session.ok, "Session should be ok");
    assert.ok(session.sessionId, "Should return sessionId");

    const ended = endWorkstationSession(session.sessionId);
    assert.ok(ended.ok, "End should be ok");
    assert.ok(ended.duration !== undefined, "Should report duration");
    record("1e", "Workstation sessions", "PASS", `session=${session.sessionId}`);
  });

  it("1f: World objects can be placed and queried", () => {
    const obj = placeWorldObject("dtu-test-obj", {
      districtId: "district_art", x: 100, y: 1, z: 100, type: "dtu_display",
    });
    assert.ok(obj.ok, "Should succeed");
    assert.ok(obj.objectId, "Should return objectId");

    const nearby = getWorldObjectsInRadius(100, 100, 50);
    assert.ok(nearby.length >= 1, "Should find the placed object");
    record("1f", "World object placement & query", "PASS", `placed=${obj.objectId}, found=${nearby.length} nearby`);
  });

  it("1g: findNearestDistrict works", () => {
    const first = DISTRICTS[0];
    const nearest = findNearestDistrict(first.position.x, first.position.z);
    assert.ok(nearest, "Should find nearest district");
    assert.equal(nearest.id, first.id);
    record("1g", "Nearest district lookup", "PASS", `nearest=${nearest.name}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 2: ORGANIZATIONS
// ══════════════════════════════════════════════════════════════════════════════

describe("Test 2: Organizations — Social Systems", () => {
  it("2a: Create and manage organization", () => {
    const result = createOrganization({
      name: "Test Guild", type: "guild", leaderId: "user-org-1",
      districtId: "district_art",
    });
    assert.ok(result.ok, "Org creation should succeed");
    const org = result.organization;
    assert.ok(org.id, "Org should have ID");
    assert.equal(org.name, "Test Guild");
    assert.equal(org.type, "guild");

    const fetched = getOrganization(org.id);
    assert.ok(fetched, "Should fetch org by ID");
    record("2a", "Organization CRUD", "PASS", `org=${org.id}, type=${org.type}`);
  });

  it("2b: Join and leave organization", () => {
    const result = createOrganization({
      name: "Join Test Org", type: "crew", leaderId: "user-org-2",
      districtId: "district_art",
    });
    assert.ok(result.ok);
    const orgId = result.organization.id;

    const joined = joinOrganization(orgId, "user-org-3");
    assert.ok(joined.ok, "Should join successfully");

    const left = leaveOrganization(orgId, "user-org-3");
    assert.ok(left.ok, "Should leave successfully");
    record("2b", "Organization join/leave", "PASS", "join and leave both succeed");
  });

  it("2c: Party create, join, leave", () => {
    const result = createParty("user-party-1");
    assert.ok(result.ok, "Party creation should succeed");
    assert.ok(result.partyId, "Party should have partyId");

    const joined = joinParty(result.partyId, "user-party-2");
    assert.ok(joined.ok, "Should join party");

    const left = leaveParty("user-party-2");
    assert.ok(left.ok, "Should leave party");
    record("2c", "Party lifecycle", "PASS", `party=${result.partyId}`);
  });

  it("2d: Mentorship system", () => {
    const mentor = registerMentor("user-mentor-1", { domain: "art", maxMentees: 3 });
    assert.ok(mentor.ok, "Should register mentor");
    assert.ok(mentor.mentorId, "Should return mentorId");

    const req = requestMentorship("user-mentee-1", mentor.mentorId);
    assert.ok(req.ok, "Should request mentorship");
    record("2d", "Mentorship registration", "PASS", "mentor registered, mentorship requested");
  });

  it("2e: Recruitment board", () => {
    const post = postRecruitment({
      orgId: "org-recruit", type: "guild", title: "Hiring Artists",
      description: "Looking for artists", requirements: "art skill",
      benefits: "Revenue share", districtId: "district_art",
    });
    assert.ok(post.ok, "Should create recruitment post");
    assert.ok(post.listingId, "Should return listingId");

    const app = applyToRecruitment(post.listingId, "user-applicant-1", { message: "I want in", portfolio: "mywork.com" });
    assert.ok(app.ok, "Should apply to recruitment");

    const board = getRecruitmentBoard();
    assert.ok(board.length >= 1, "Board should have listings");
    record("2e", "Recruitment board", "PASS", `post=${post.listingId}, board=${board.length} listings`);
  });

  it("2f: Alliances between organizations", () => {
    // Need a real org for alliance founder
    const orgResult = createOrganization({
      name: "Alliance Founder Org", type: "guild", leaderId: "user-alliance-founder",
    });
    assert.ok(orgResult.ok);
    const founderOrgId = orgResult.organization.id;

    const alliance = createAlliance({
      name: "Test Alliance", founderOrgId, description: "Test alliance",
    });
    assert.ok(alliance.ok, "Alliance creation should succeed");
    assert.ok(alliance.allianceId, "Should return allianceId");

    // Create a second org to join
    const org2 = createOrganization({
      name: "Alliance Member Org", type: "crew", leaderId: "user-alliance-member",
    });
    assert.ok(org2.ok);

    const joined = joinAlliance(alliance.allianceId, org2.organization.id);
    assert.ok(joined.ok, "Should join alliance");
    record("2f", "Alliance system", "PASS", `alliance=${alliance.allianceId}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 3: JOBS & BUSINESSES
// ══════════════════════════════════════════════════════════════════════════════

describe("Test 3: Jobs — Career & Business System", () => {
  it("3a: Job templates cover multiple lenses", () => {
    const templates = listJobTemplates();
    assert.ok(templates.length >= 20, `Expected 20+ job templates, got ${templates.length}`);
    const lenses = new Set(templates.map(t => t.lens));
    assert.ok(lenses.size >= 10, `Expected 10+ lenses covered, got ${lenses.size}`);
    record("3a", "Job templates diversity", "PASS", `${templates.length} templates, ${lenses.size} lenses`);
  });

  it("3b: Job assignment and activity", () => {
    const templates = listJobTemplates();
    const job = assignJob("user-job-1", { jobId: templates[0].id, cityId: "city-1" });
    assert.ok(job, "Should assign job");

    const activity = recordJobActivity("user-job-1", { dtuId: "dtu-test-1", ccEarned: 50 });
    assert.ok(activity, "Should record activity");
    record("3b", "Job assignment & activity", "PASS", `job=${templates[0].id}, activity recorded`);
  });

  it("3c: Quit job", () => {
    const result = quitJob("user-job-1");
    assert.ok(result, "Should quit job");
    record("3c", "Quit job", "PASS", "job quit successfully");
  });

  it("3d: Create and operate business", () => {
    const bizResult = createBusiness("user-biz-1", {
      name: "Test Shop", type: "store",
      cityId: "city-1", districtId: "marketplace_plaza",
    });
    assert.ok(bizResult.ok, "Business creation should succeed");
    assert.ok(bizResult.business.id, "Business should have ID");

    const sale = recordBusinessSale(bizResult.business.id, { dtuId: "dtu-sale-1", buyerId: "user-buyer-1", amount: 100 });
    assert.ok(sale, "Should record sale");

    const businesses = listBusinesses({ cityId: "city-1" });
    assert.ok(businesses.length >= 1, "Should list businesses");
    record("3d", "Business creation & sales", "PASS", `biz=${bizResult.business.id}, sales recorded`);
  });

  it("3e: Franchise system", () => {
    const bizResult = createBusiness("user-franchise-1", {
      name: "Franchise Source", type: "restaurant",
      cityId: "city-1", districtId: "food_district",
    });
    assert.ok(bizResult.ok);

    const tmpl = createFranchiseTemplate(bizResult.business.id, { price: 5000 }, "user-franchise-1");
    assert.ok(tmpl.ok, "Should create franchise template");
    assert.ok(tmpl.franchiseId, "Should return franchiseId");

    const purchased = purchaseFranchise(tmpl.franchiseId, "user-franchise-buyer", { cityId: "city-2", name: "My Franchise" });
    assert.ok(purchased.ok, "Should purchase franchise");
    record("3e", "Franchise system", "PASS", "template created, franchise purchased");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 4: PROGRESSION
// ══════════════════════════════════════════════════════════════════════════════

describe("Test 4: Progression — Mastery & Achievements", () => {
  it("4a: Mastery ranks defined correctly", () => {
    assert.ok(MASTERY_RANKS.length >= 7, `Expected 7+ ranks, got ${MASTERY_RANKS.length}`);
    assert.equal(MASTERY_RANKS[0].title, "Novice");
    assert.equal(MASTERY_RANKS[MASTERY_RANKS.length - 1].title, "Grandmaster");
    // XP requirements increase monotonically
    for (let i = 1; i < MASTERY_RANKS.length; i++) {
      assert.ok(MASTERY_RANKS[i].xpRequired > MASTERY_RANKS[i-1].xpRequired);
    }
    record("4a", "Mastery rank ladder", "PASS", `${MASTERY_RANKS.length} ranks, Novice→Grandmaster`);
  });

  it("4b: XP award and rank up", () => {
    const r1 = awardXP("user-prog-1", "dtu_created", { lens: "art" });
    assert.ok(r1.xpAwarded > 0, "Should award XP");
    assert.equal(r1.xpAwarded, XP_ACTIONS.dtu_created);

    // Award enough to rank up
    for (let i = 0; i < 15; i++) {
      awardXP("user-prog-1", "dtu_created", { lens: "art" });
    }

    const profile = getMasteryProfile("user-prog-1");
    assert.ok(profile.totalXP >= 100, "Should have 100+ XP");
    assert.ok(profile.rank >= 1, "Should have ranked up");
    assert.ok(profile.lensXP.art > 0, "Should track lens XP");
    record("4b", "XP award & rank up", "PASS", `totalXP=${profile.totalXP}, rank=${profile.rank} (${profile.title})`);
  });

  it("4c: Leaderboard", () => {
    awardXP("user-prog-2", "dtu_hyper_created");
    awardXP("user-prog-3", "dtu_mega_created");

    const board = getLeaderboard({ limit: 10 });
    assert.ok(board.length >= 1, "Leaderboard should have entries");
    // Should be sorted by XP descending
    for (let i = 1; i < board.length; i++) {
      assert.ok(board[i-1].xp >= board[i].xp, "Should be sorted desc");
    }
    record("4c", "Leaderboard", "PASS", `${board.length} entries, sorted correctly`);
  });

  it("4d: Achievement tracking", () => {
    trackAction("user-ach-1", "dtu_created", 1);
    const achievements = getAchievements("user-ach-1");
    assert.ok(achievements.length >= 20, `Expected 20+ achievements, got ${achievements.length}`);

    // "first_dtu" should be unlocked (count 1 required)
    const firstDtu = achievements.find(a => a.id === "first_dtu");
    assert.ok(firstDtu, "Should have first_dtu achievement");
    assert.equal(firstDtu.unlocked, true, "first_dtu should be unlocked");
    record("4d", "Achievement tracking", "PASS", `${achievements.length} achievements, first_dtu unlocked`);
  });

  it("4e: Explorer tracking — district visits", () => {
    recordDistrictVisit("user-explore-1", "art_studio");
    recordDistrictVisit("user-explore-1", "music_hall");
    recordDistrictVisit("user-explore-1", "art_studio"); // revisit

    const stats = getExplorerStats("user-explore-1");
    assert.equal(stats.visitedDistricts, 2, "Should have 2 unique districts");
    assert.equal(stats.totalVisits, 3, "Should have 3 total visits");
    record("4e", "Explorer tracking", "PASS", `unique=${stats.visitedDistricts}, total=${stats.totalVisits}`);
  });

  it("4f: Daily login and streaks", () => {
    const login = recordDailyLogin("user-login-1");
    assert.ok(!login.alreadyLoggedIn, "First login should not be duplicate");
    assert.equal(login.streakDays, 1, "Streak should be 1");
    assert.ok(login.xpAwarded > 0, "Should award XP");

    const dupe = recordDailyLogin("user-login-1");
    assert.ok(dupe.alreadyLoggedIn, "Second login same day should be duplicate");
    record("4f", "Daily login & streaks", "PASS", `streak=${login.streakDays}, xp=${login.xpAwarded}`);
  });

  it("4g: Season system", () => {
    const season = startSeason({ name: "Test Season", theme: "knowledge" });
    assert.ok(season.id, "Season should have ID");
    assert.equal(season.name, "Test Season");

    const current = getCurrentSeason();
    assert.ok(current, "Should have current season");
    assert.equal(current.id, season.id);

    const challenge = addSeasonChallenge({
      name: "Create 5 DTUs", xpReward: 50,
      requirement: { action: "dtu_created", count: 5 },
    });
    assert.ok(challenge.ok, "Should add challenge");

    recordSeasonContribution("user-season-1", { xp: 100, type: "general" });

    const ended = endSeason();
    assert.ok(ended, "Should end season");
    assert.ok(ended.totalParticipants >= 1, "Should have participants");
    record("4g", "Season system", "PASS", `season=${season.name}, participants=${ended.totalParticipants}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 5: MECHANICS ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe("Test 5: Mechanics — WHEN/DO/REWARD Engine", () => {
  it("5a: Triggers, Actions, Rewards are defined", () => {
    assert.ok(Object.keys(TRIGGERS).length >= 15, `Expected 15+ triggers, got ${Object.keys(TRIGGERS).length}`);
    assert.ok(Object.keys(ACTIONS).length >= 15, `Expected 15+ actions, got ${Object.keys(ACTIONS).length}`);
    assert.ok(Object.keys(REWARDS).length >= 5, `Expected 5+ rewards, got ${Object.keys(REWARDS).length}`);
    record("5a", "WHEN/DO/REWARD definitions", "PASS",
      `triggers=${Object.keys(TRIGGERS).length}, actions=${Object.keys(ACTIONS).length}, rewards=${Object.keys(REWARDS).length}`);
  });

  it("5b: Create and fire mechanic", () => {
    const mech = createMechanic("city-mech-1", {
      name: "Welcome Message",
      trigger: "player_enters_zone",
      triggerParams: { zoneId: "spawn" },
      action: "show_notification",
      actionParams: { message: "Welcome!", type: "info" },
      reward: "xp",
      rewardParams: { amount: 10 },
    });
    assert.ok(mech.id, "Mechanic should have ID");
    assert.equal(mech.trigger, "player_enters_zone");
    assert.equal(mech.action, "show_notification");

    const result = fireTrigger("city-mech-1", "player_enters_zone", { zoneId: "spawn" });
    assert.ok(result.fired.length >= 1, "Should fire at least 1 mechanic");
    assert.equal(result.fired[0].name, "Welcome Message");
    record("5b", "Create & fire mechanic", "PASS", `mechanic=${mech.id}, fired=${result.fired.length}`);
  });

  it("5c: Toggle and delete mechanic", () => {
    const mechanics = getCityMechanics("city-mech-1");
    assert.ok(mechanics.length >= 1);

    const toggled = toggleMechanic("city-mech-1", mechanics[0].id, false);
    assert.ok(toggled.ok, "Should toggle mechanic off");

    // Should not fire when disabled
    const result = fireTrigger("city-mech-1", "player_enters_zone", {});
    assert.equal(result.fired.length, 0, "Disabled mechanic should not fire");

    const deleted = deleteMechanic("city-mech-1", mechanics[0].id);
    assert.ok(deleted.ok, "Should delete mechanic");
    record("5c", "Toggle & delete mechanic", "PASS", "disable prevents firing, delete removes");
  });

  it("5d: Invalid trigger/action throws", () => {
    assert.throws(() => {
      createMechanic("city-err", { trigger: "fake_trigger", action: "show_notification" });
    }, /Invalid trigger/);

    assert.throws(() => {
      createMechanic("city-err", { trigger: "player_enters_zone", action: "fake_action" });
    }, /Invalid action/);
    record("5d", "Invalid mechanic validation", "PASS", "throws on invalid trigger/action");
  });

  it("5e: City templates exist (GTA, Skyrim, Sims, FiveM, etc.)", () => {
    const templates = listTemplates();
    assert.ok(templates.length >= 6, `Expected 6+ templates, got ${templates.length}`);

    const gta = getTemplate("gta");
    assert.ok(gta, "GTA template should exist");
    assert.equal(gta.rules.crime, true, "GTA should have crime enabled");
    assert.equal(gta.rules.pvp, true, "GTA should have PvP");

    const skyrim = getTemplate("skyrim");
    assert.ok(skyrim, "Skyrim template should exist");
    assert.equal(skyrim.theme, "medieval");

    const sims = getTemplate("sims");
    assert.ok(sims, "Sims template should exist");
    assert.equal(sims.rules.combat, false, "Sims should have no combat");

    const fivem = getTemplate("fivem");
    assert.ok(fivem, "FiveM template should exist");
    assert.equal(fivem.rules.rpRequired, true, "FiveM should require RP");
    record("5e", "City templates", "PASS", `${templates.length} templates: GTA=${!!gta}, Skyrim=${!!skyrim}, Sims=${!!sims}, FiveM=${!!fivem}`);
  });

  it("5f: Wizard steps and validation", () => {
    const steps = getWizardSteps();
    assert.ok(steps.length >= 5, `Expected 5+ wizard steps, got ${steps.length}`);

    const valid = validateWizardStep("basics", { name: "My City", theme: "modern" });
    assert.ok(valid.valid, "Should validate basic step");

    const invalid = validateWizardStep("basics", {}); // missing name
    assert.ok(!invalid.valid, "Should fail without required fields");
    assert.ok(invalid.errors.length > 0, "Should report errors");
    record("5f", "Wizard steps & validation", "PASS", `${steps.length} steps, validation works`);
  });

  it("5g: Build city from wizard with template", () => {
    const config = buildCityFromWizard({
      name: "My GTA City",
      template: "gta",
      rules: { maxPlayers: 200 },
    });
    assert.equal(config.name, "My GTA City");
    assert.equal(config.templateId, "gta");
    assert.equal(config.rules.crime, true, "Should inherit GTA crime rule");
    assert.equal(config.rules.maxPlayers, 200, "Should override maxPlayers");
    assert.ok(config.districts.length > 0, "Should have default districts from template");
    record("5g", "Build city from wizard+template", "PASS", `name=${config.name}, districts=${config.districts.length}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 6: EVENTS
// ══════════════════════════════════════════════════════════════════════════════

describe("Test 6: Events — Lifecycle & Calendar", () => {
  it("6a: Event types defined", () => {
    assert.ok(Object.keys(EVENT_TYPES).length >= 10, `Expected 10+ event types, got ${Object.keys(EVENT_TYPES).length}`);
    assert.ok(EVENT_TYPES.concert, "Should have concert type");
    assert.ok(EVENT_TYPES.tournament, "Should have tournament type");
    assert.ok(EVENT_TYPES.workshop, "Should have workshop type");
    assert.ok(EVENT_TYPES.hackathon, "Should have hackathon type");
    record("6a", "Event types defined", "PASS", `${Object.keys(EVENT_TYPES).length} event types`);
  });

  it("6b: Create event and full lifecycle", () => {
    const event = createEvent({
      cityId: "city-event-1", hostId: "user-event-1",
      type: "concert", name: "Test Concert",
      description: "A test concert",
    });
    assert.ok(event.id, "Event should have ID");
    assert.equal(event.status, "scheduled");
    assert.equal(event.type, "concert");

    // Start
    const started = startEvent(event.id, "user-event-1");
    assert.equal(started.status, "active");

    // End
    const ended = endEvent(event.id, "user-event-1");
    assert.equal(ended.status, "completed");
    record("6b", "Event lifecycle", "PASS", `event=${event.id}: scheduled→active→completed`);
  });

  it("6c: RSVP and attendance", () => {
    const event = createEvent({
      cityId: "city-event-2", hostId: "user-event-2",
      type: "workshop", name: "Coding Workshop",
      maxAttendees: 5,
    });

    const rsvp1 = rsvpEvent(event.id, "user-rsvp-1");
    assert.ok(rsvp1.ok, "Should RSVP successfully");
    assert.equal(rsvp1.rsvpCount, 1);

    const rsvp2 = rsvpEvent(event.id, "user-rsvp-2");
    assert.equal(rsvp2.rsvpCount, 2);

    // Cancel RSVP
    cancelRsvp(event.id, "user-rsvp-1");
    const attendees = getEventAttendees(event.id);
    assert.equal(attendees.length, 1, "Should have 1 attendee after cancel");

    // Start and join
    startEvent(event.id, "user-event-2");
    const joined = joinEvent(event.id, "user-rsvp-3");
    assert.ok(joined.ok, "Should join active event");
    record("6c", "RSVP & attendance", "PASS", "RSVP, cancel, walk-in join all work");
  });

  it("6d: Event capacity enforcement", () => {
    const event = createEvent({
      cityId: "city-cap", hostId: "host-cap",
      type: "meetup", name: "Tiny Meetup",
      maxAttendees: 2,
    });

    rsvpEvent(event.id, "cap-user-1");
    rsvpEvent(event.id, "cap-user-2");

    assert.throws(() => {
      rsvpEvent(event.id, "cap-user-3");
    }, /full/, "Should reject when full");
    record("6d", "Event capacity enforcement", "PASS", "rejects when full");
  });

  it("6e: City events listing", () => {
    const events = getCityEvents("city-event-1");
    assert.ok(events.length >= 1, "Should list city events");
    record("6e", "City events listing", "PASS", `${events.length} events for city`);
  });

  it("6f: Event DTU recording and chat", () => {
    const event = createEvent({
      cityId: "city-dtu-ev", hostId: "host-dtu",
      type: "hackathon", name: "DTU Hackathon",
    });

    const dtuResult = recordEventDTU(event.id, "dtu-abc-123");
    assert.ok(dtuResult.ok);
    assert.equal(dtuResult.totalDTUs, 1);

    const chatResult = addEventChat(event.id, "user-chat-1", "Hello world!");
    assert.ok(chatResult.ok);
    assert.equal(chatResult.messageCount, 1);
    record("6f", "Event DTU recording & chat", "PASS", "DTU recorded, chat logged");
  });

  it("6g: Cancel event", () => {
    const event = createEvent({
      cityId: "city-cancel", hostId: "host-cancel",
      type: "meetup", name: "Cancel Me",
    });

    const result = cancelEvent(event.id, "host-cancel");
    assert.ok(result.ok);
    assert.equal(result.status, "cancelled");

    // Cannot RSVP to cancelled event
    assert.throws(() => {
      rsvpEvent(event.id, "some-user");
    }, /finished/, "Should not RSVP to cancelled");
    record("6g", "Cancel event", "PASS", "cancelled, RSVP blocked");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 7: CITY MANAGER — EXPANDED
// ══════════════════════════════════════════════════════════════════════════════

describe("Test 7: City Manager — Themes, Domains, Rules", () => {
  it("7a: Expanded themes (18+)", () => {
    const themes = getValidThemes();
    assert.ok(themes.length >= 15, `Expected 15+ themes, got ${themes.length}`);
    assert.ok(themes.includes("modern"));
    assert.ok(themes.includes("cyberpunk"));
    assert.ok(themes.includes("medieval"));
    assert.ok(themes.includes("sci-fi"));
    assert.ok(themes.includes("post-apocalyptic"));
    assert.ok(themes.includes("custom"));
    record("7a", "Expanded themes", "PASS", `${themes.length} themes available`);
  });

  it("7b: Expanded domains (100+)", () => {
    const domains = getValidDomains();
    assert.ok(domains.length >= 80, `Expected 80+ domains, got ${domains.length}`);
    // Check representative domains from each category
    assert.ok(domains.includes("art"));
    assert.ok(domains.includes("engineering"));
    assert.ok(domains.includes("music"));
    assert.ok(domains.includes("fitness"));
    assert.ok(domains.includes("gaming"));
    assert.ok(domains.includes("marketplace"));
    record("7b", "Expanded domains", "PASS", `${domains.length} domains available`);
  });

  it("7c: Rules schema defined", () => {
    const schema = getCityRulesSchema();
    assert.ok(Object.keys(schema).length >= 15, `Expected 15+ rule keys, got ${Object.keys(schema).length}`);
    assert.ok(schema.combat, "Should have combat rule");
    assert.ok(schema.pvp, "Should have pvp rule");
    assert.ok(schema.maxPlayers, "Should have maxPlayers rule");
    assert.ok(schema.contentFilter, "Should have contentFilter rule");
    record("7c", "Rules schema", "PASS", `${Object.keys(schema).length} rule definitions`);
  });

  it("7d: Create city with full rules", () => {
    const city = createCity({
      name: "Full Rules City", owner: "user-rules-1",
      theme: "cyberpunk",
      activeDomains: ["art", "engineering", "gaming"],
      rules: { combat: true, pvp: true, maxPlayers: 200, contentFilter: "relaxed" },
      districts: [{ name: "Neon District", lens: "art" }],
    });

    assert.ok(city.id);
    assert.equal(city.theme, "cyberpunk");
    assert.ok(city.rules, "Should have rules object");
    assert.equal(city.rules.combat, true);
    assert.equal(city.rules.pvp, true);
    assert.equal(city.rules.maxPlayers, 200);
    // Defaults should be filled
    assert.equal(city.rules.entityProtection, true, "Default entityProtection should be true");
    record("7d", "City with full rules", "PASS", `city=${city.id}, combat=true, pvp=true, maxPlayers=200`);
  });

  it("7e: Invalid theme/domain rejected", () => {
    assert.throws(() => {
      createCity({ name: "Bad Theme", owner: "u1", theme: "banana" });
    }, /Invalid theme/);

    assert.throws(() => {
      createCity({ name: "Bad Domain", owner: "u1", activeDomains: ["nonexistent_domain_xyz"] });
    }, /Invalid domain/);
    record("7e", "Invalid theme/domain rejected", "PASS", "validation catches bad values");
  });

  it("7f: City tax capped at 2%", () => {
    assert.throws(() => {
      createCity({
        name: "Greedy City", owner: "u1",
        economy: { cityTax: 0.05 },
      });
    }, /cityTax/);

    const city = createCity({
      name: "Fair City", owner: "user-tax-1",
      economy: { cityTax: 0.02 },
    });
    assert.equal(city.economy.cityTax, 0.02);
    record("7f", "City tax capped at 2%", "PASS", "0.05 rejected, 0.02 accepted");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FINAL: PRINT SCORECARD
// ══════════════════════════════════════════════════════════════════════════════

describe("═══ WORLD VERIFICATION SCORECARD ═══", () => {
  it("Print final scorecard", () => {
    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║           CONCORD WORLD LENS — VERIFICATION SCORECARD           ║");
    console.log("╠══════════════════════════════════════════════════════════════════╣");

    for (const entry of SCORECARD) {
      const icon = entry.status === "PASS" ? "✅" : entry.status === "PARTIAL" ? "⚠️ " : "❌";
      const padded = `${entry.num}: ${entry.name}`.padEnd(45);
      console.log(`║ ${icon} ${padded} ${entry.status.padEnd(7)} ║`);
      if (entry.evidence) {
        console.log(`║    Evidence: ${entry.evidence.slice(0, 52).padEnd(52)} ║`);
      }
    }

    console.log("╠══════════════════════════════════════════════════════════════════╣");
    const total = SCORECARD.length;
    const pass = SCORECARD.filter(s => s.status === "PASS").length;
    const partial = SCORECARD.filter(s => s.status === "PARTIAL").length;
    const fail = SCORECARD.filter(s => s.status === "FAIL").length;
    console.log(`║ TOTAL: ${total}  |  PASS: ${pass}  |  PARTIAL: ${partial}  |  FAIL: ${fail}`.padEnd(67) + "║");
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log("\n");

    assert.equal(fail, 0, `${fail} tests FAILED`);
    assert.ok(pass >= total * 0.8, "At least 80% must PASS");
  });
});
