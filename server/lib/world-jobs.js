/**
 * World Jobs — Careers, Businesses, Payroll, Franchises
 *
 * Every job maps to a lens. Doing the job creates DTUs with real value.
 * Jobs aren't grinding — jobs are creating.
 *
 * Payroll from city transaction fees. Real money from what you create.
 * Player-owned businesses with franchise system.
 */

import { randomUUID } from "crypto";
import logger from "../logger.js";
import { LruMap, LruSet } from "./lru-map.js";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const JOB_REQUIREMENT_TYPES = new Set(["none", "application", "quiz", "portfolio", "interview", "rank"]);
const BUSINESS_TYPES = new Set(["store", "studio", "workshop", "restaurant", "office", "venue", "gallery", "clinic"]);

// ══════════════════════════════════════════════════════════════════════════════
// PREDEFINED JOB TEMPLATES — Mapped to lenses
// ══════════════════════════════════════════════════════════════════════════════

export const JOB_TEMPLATES = Object.freeze([
  // Law & Order (for RP cities)
  { id: "police_officer", name: "Police Officer", lens: "law-enforcement", faction: "LSPD", requirements: "application", payscale: [100, 200, 500], ranks: ["Cadet", "Officer", "Sergeant", "Lieutenant", "Captain", "Chief"] },
  { id: "lawyer", name: "Lawyer", lens: "legal", faction: "Bar Association", requirements: "application", payscale: [200, 500, 1000], ranks: ["Intern", "Associate", "Partner", "Senior Partner"] },
  { id: "judge", name: "Judge", lens: "legal", faction: "Judiciary", requirements: "rank", payscale: [800, 1200, 2000], ranks: ["Magistrate", "District Judge", "Circuit Judge", "Chief Justice"] },

  // Emergency
  { id: "paramedic", name: "Paramedic", lens: "healthcare", faction: "EMS", requirements: "quiz", payscale: [80, 150, 400], ranks: ["EMT-B", "EMT-P", "Flight Medic", "Chief Medic"] },
  { id: "firefighter", name: "Firefighter", lens: "trades", faction: "Fire Department", requirements: "application", payscale: [90, 180, 450], ranks: ["Probie", "Firefighter", "Engineer", "Captain", "Battalion Chief"] },

  // Trades
  { id: "mechanic", name: "Mechanic", lens: "trades", faction: "Independent", requirements: "none", payscale: [50, 100, 300], ranks: ["Apprentice", "Journeyman", "Master Mechanic"] },
  { id: "electrician", name: "Electrician", lens: "trades", faction: "Independent", requirements: "quiz", payscale: [60, 120, 350], ranks: ["Apprentice", "Journeyman", "Master Electrician"] },
  { id: "plumber", name: "Plumber", lens: "trades", faction: "Independent", requirements: "none", payscale: [55, 110, 320], ranks: ["Apprentice", "Journeyman", "Master Plumber"] },
  { id: "carpenter", name: "Carpenter", lens: "trades", faction: "Independent", requirements: "none", payscale: [50, 100, 300], ranks: ["Apprentice", "Journeyman", "Master Carpenter"] },

  // Creative
  { id: "dj", name: "DJ", lens: "music", faction: "Independent", requirements: "portfolio", payscale: [0, 0, 0], ranks: ["Opener", "Resident", "Headliner", "Superstar"] },
  { id: "musician", name: "Musician", lens: "music", faction: "Independent", requirements: "none", payscale: [0, 0, 0], ranks: ["Busker", "Session Player", "Touring Artist", "Maestro"] },
  { id: "artist", name: "Artist", lens: "art", faction: "Independent", requirements: "portfolio", payscale: [0, 0, 0], ranks: ["Student", "Exhibiting Artist", "Featured Artist", "Master Artist"] },
  { id: "filmmaker", name: "Filmmaker", lens: "film-studio", faction: "Independent", requirements: "portfolio", payscale: [0, 0, 0], ranks: ["PA", "Assistant Director", "Director", "Executive Producer"] },
  { id: "journalist", name: "Journalist", lens: "journalism", faction: "News Station", requirements: "application", payscale: [60, 150, 400], ranks: ["Intern", "Reporter", "Senior Reporter", "Editor-in-Chief"] },

  // Knowledge
  { id: "researcher", name: "Researcher", lens: "research", faction: "University", requirements: "application", payscale: [100, 250, 600], ranks: ["Research Assistant", "Associate", "Lead Researcher", "Principal Investigator"] },
  { id: "teacher", name: "Teacher", lens: "education", faction: "Academy", requirements: "quiz", payscale: [80, 160, 400], ranks: ["Teaching Assistant", "Instructor", "Professor", "Department Chair"] },
  { id: "librarian", name: "Librarian", lens: "education", faction: "Library System", requirements: "none", payscale: [50, 100, 250], ranks: ["Page", "Librarian", "Head Librarian", "Chief Archivist"] },

  // Professional
  { id: "developer", name: "Software Developer", lens: "code", faction: "Independent", requirements: "portfolio", payscale: [100, 300, 800], ranks: ["Junior Dev", "Mid Dev", "Senior Dev", "Staff Engineer", "Principal"] },
  { id: "accountant", name: "Accountant", lens: "finance", faction: "Independent", requirements: "quiz", payscale: [80, 200, 500], ranks: ["Bookkeeper", "Accountant", "CPA", "CFO"] },
  { id: "real_estate_agent", name: "Real Estate Agent", lens: "real-estate", faction: "Realty", requirements: "application", payscale: [0, 0, 0], ranks: ["Trainee", "Agent", "Broker", "Managing Broker"] },

  // City Services
  { id: "taxi_driver", name: "Taxi Driver", lens: "transportation", faction: "Independent", requirements: "none", payscale: [30, 60, 120], ranks: ["Rookie", "Driver", "Veteran", "Fleet Owner"] },
  { id: "business_owner", name: "Business Owner", lens: "business", faction: "Independent", requirements: "none", payscale: [0, 0, 0], ranks: ["Sole Proprietor", "Small Business", "Corporation", "Conglomerate"] },
]);

const _jobTemplateById = new Map(JOB_TEMPLATES.map(j => [j.id, j]));

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════

/** @type {Map<string, object>} Active job assignments: assignmentId -> job state */
const _jobAssignments = new LruMap();

/** @type {Map<string, string>} userId -> assignmentId quick lookup */
const _userJobs = new Map();

/** @type {Map<string, object>} Player-owned businesses: businessId -> business state */
const _businesses = new LruMap();

/** @type {Map<string, object>} Franchise templates: franchiseId -> template */
const _franchises = new LruMap();

// ══════════════════════════════════════════════════════════════════════════════
// JOBS
// ══════════════════════════════════════════════════════════════════════════════

export function getJobTemplate(jobId) {
  return _jobTemplateById.get(jobId) || null;
}

export function listJobTemplates({ lens, faction } = {}) {
  let jobs = [...JOB_TEMPLATES];
  if (lens) jobs = jobs.filter(j => j.lens === lens);
  if (faction) jobs = jobs.filter(j => j.faction === faction);
  return jobs;
}

export function assignJob(userId, { jobId, cityId, factionId, startingRank = 0 }) {
  const template = _jobTemplateById.get(jobId);
  if (!template) return { ok: false, error: "job_not_found" };
  if (_userJobs.has(userId)) return { ok: false, error: "already_has_job" };

  const id = `job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const assignment = {
    id, userId, jobId, cityId, factionId: factionId || template.faction,
    rank: startingRank, rankName: template.ranks[startingRank] || template.ranks[0],
    pay: template.payscale[startingRank] || template.payscale[0],
    lens: template.lens,
    dtusCreated: 0, ccEarned: 0, hoursWorked: 0,
    hiredAt: new Date().toISOString(), status: "active",
  };
  _jobAssignments.set(id, assignment);
  _userJobs.set(userId, id);
  return { ok: true, assignment };
}

export function quitJob(userId) {
  const assignId = _userJobs.get(userId);
  if (!assignId) return { ok: false, error: "no_job" };
  const assignment = _jobAssignments.get(assignId);
  if (assignment) assignment.status = "resigned";
  _userJobs.delete(userId);
  return { ok: true };
}

export function promoteEmployee(userId, actorId) {
  const assignId = _userJobs.get(userId);
  if (!assignId) return { ok: false, error: "no_job" };
  const assignment = _jobAssignments.get(assignId);
  const template = _jobTemplateById.get(assignment.jobId);
  if (!template) return { ok: false, error: "template_missing" };
  if (assignment.rank >= template.ranks.length - 1) return { ok: false, error: "max_rank" };
  assignment.rank++;
  assignment.rankName = template.ranks[assignment.rank];
  assignment.pay = template.payscale[Math.min(assignment.rank, template.payscale.length - 1)];
  return { ok: true, newRank: assignment.rankName, newPay: assignment.pay };
}

export function getUserJob(userId) {
  const assignId = _userJobs.get(userId);
  return assignId ? _jobAssignments.get(assignId) : null;
}

export function recordJobActivity(userId, { dtuId, ccEarned = 0 }) {
  const assignId = _userJobs.get(userId);
  if (!assignId) return { ok: false, error: "no_job" };
  const assignment = _jobAssignments.get(assignId);
  assignment.dtusCreated++;
  assignment.ccEarned += ccEarned;
  return { ok: true, totalDtus: assignment.dtusCreated, totalCC: assignment.ccEarned };
}

// ══════════════════════════════════════════════════════════════════════════════
// PLAYER-OWNED BUSINESSES
// ══════════════════════════════════════════════════════════════════════════════

export function createBusiness(userId, { name, type, cityId, districtId, description }) {
  if (!name || !type) return { ok: false, error: "name_and_type_required" };
  if (!BUSINESS_TYPES.has(type)) return { ok: false, error: `invalid_type. Valid: ${[...BUSINESS_TYPES]}` };

  const id = `biz_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const business = {
    id, name, type, ownerId: userId, cityId, districtId,
    description: description || "",
    inventory: [], // DTU IDs stocked
    employees: [], // { userId, role, revenueSharePct }
    prices: {},    // dtuId -> price override
    reputation: { rating: 0, reviews: 0, customersServed: 0 },
    revenue: 0, expenses: 0,
    franchiseTemplate: null,
    createdAt: new Date().toISOString(), status: "active",
  };
  _businesses.set(id, business);
  return { ok: true, business };
}

export function stockBusiness(businessId, dtuId, price, ownerId) {
  const biz = _businesses.get(businessId);
  if (!biz) return { ok: false, error: "business_not_found" };
  if (biz.ownerId !== ownerId) return { ok: false, error: "not_owner" };
  if (!biz.inventory.includes(dtuId)) biz.inventory.push(dtuId);
  biz.prices[dtuId] = price;
  return { ok: true, inventorySize: biz.inventory.length };
}

export function hireToBusiness(businessId, employeeId, { role = "staff", revenueSharePct = 10 }, ownerId) {
  const biz = _businesses.get(businessId);
  if (!biz || biz.ownerId !== ownerId) return { ok: false, error: "not_owner" };
  if (biz.employees.some(e => e.userId === employeeId)) return { ok: false, error: "already_employed" };
  biz.employees.push({ userId: employeeId, role, revenueSharePct, hiredAt: new Date().toISOString() });
  return { ok: true, employees: biz.employees.length };
}

export function recordBusinessSale(businessId, { dtuId, buyerId, amount }) {
  const biz = _businesses.get(businessId);
  if (!biz) return { ok: false, error: "business_not_found" };
  biz.revenue += amount;
  biz.reputation.customersServed++;
  return { ok: true, revenue: biz.revenue };
}

export function rateBusiness(businessId, userId, rating) {
  const biz = _businesses.get(businessId);
  if (!biz) return { ok: false, error: "business_not_found" };
  const r = biz.reputation;
  r.rating = ((r.rating * r.reviews) + Math.min(5, Math.max(1, rating))) / (r.reviews + 1);
  r.reviews++;
  return { ok: true, rating: r.rating, reviews: r.reviews };
}

export function getBusiness(businessId) {
  return _businesses.get(businessId) || null;
}

export function listBusinesses({ cityId, type, limit = 50 } = {}) {
  let list = [..._businesses.values()].filter(b => b.status === "active");
  if (cityId) list = list.filter(b => b.cityId === cityId);
  if (type) list = list.filter(b => b.type === type);
  return list.slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════════════════
// FRANCHISE SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

export function createFranchiseTemplate(businessId, { price, royaltyPct = 5 }, ownerId) {
  const biz = _businesses.get(businessId);
  if (!biz || biz.ownerId !== ownerId) return { ok: false, error: "not_owner" };

  const id = `franchise_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  _franchises.set(id, {
    id, sourceBusinessId: businessId, templateName: biz.name,
    businessType: biz.type, price, royaltyPct,
    purchaseCount: 0, totalRoyalties: 0,
    createdAt: new Date().toISOString(),
  });
  biz.franchiseTemplate = id;
  return { ok: true, franchiseId: id };
}

export function purchaseFranchise(franchiseId, buyerId, { cityId, name }) {
  const template = _franchises.get(franchiseId);
  if (!template) return { ok: false, error: "franchise_not_found" };
  template.purchaseCount++;
  // Create a new business from the template
  const result = createBusiness(buyerId, {
    name: name || `${template.templateName} (Franchise)`,
    type: template.businessType, cityId,
  });
  if (result.ok) result.business.franchiseTemplate = franchiseId;
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════════════

export function getJobStats() {
  return {
    totalTemplates: JOB_TEMPLATES.length,
    activeJobs: [..._jobAssignments.values()].filter(j => j.status === "active").length,
    totalBusinesses: _businesses.size,
    totalFranchises: _franchises.size,
    jobsByLens: Object.fromEntries(
      [...new Set(JOB_TEMPLATES.map(j => j.lens))].map(l => [l, JOB_TEMPLATES.filter(j => j.lens === l).length])
    ),
  };
}
