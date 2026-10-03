/**
 * Artifact types the frontend actually creates, per lens domain.
 *
 * DOMAIN_RULES (lib/domain-logic.js + lib/domain-logic-extended.js) reject a
 * create whose type isn't in the domain's `types` list with
 * `validation_failed` ("Invalid type ... for domain ..."). Many rules were
 * authored with a vocabulary the real lens never sends, so those creates
 * failed: Board's "+ Add task" (board/task), every new goal (goals/goal),
 * Paper, Science, Food, Household, Events and more. This is the same defect
 * the `services` rule documents, here fixed for every domain at once.
 *
 * reconcileArtifactTypes() adds these types to the merged registry. It runs
 * after the extended rules are merged (server.js), so it covers domains
 * defined in either file. Statuses and transitions are unchanged.
 *
 * Pinned by tests/lens-artifact-types.test.js, which scans every
 * useLensData(domain, type) call in concord-frontend and fails when a new
 * one isn't accepted. To add a type: add it here (or to the domain's rule).
 */

export const FRONTEND_ARTIFACT_TYPES = {
  "agriculture": ["Animal", "Crop", "FarmEquipment", "Field", "Harvest"],
  "ar": ["Model3D", "Scene"],
  "artistry": ["post"],
  "aviation": ["Aircraft", "Charter", "Flight", "Pilot", "Weather", "WeightBalance", "WorkOrder"],
  "bio": ["system"],
  "board": ["task"],
  "code": ["script"],
  "collab": ["chat", "history", "session", "shared-file", "shared-notes"],
  "council": ["audit", "committee", "debate", "stakeholder"],
  "crypto": ["chain"],
  "daily": ["entry", "reminder", "session"],
  "database": ["table"],
  "debug": ["debug"],
  "education": ["artifact"],
  "environment": ["CarbonEntry", "ComplianceRecord", "EnvironmentalSample", "ResourceMetric", "Site", "Species", "SustainabilityGoal", "TrailAsset", "WasteStream"],
  "events": ["Budget", "Guest", "RunOfShow", "TicketTier", "Vendor", "Venue"],
  "experience": ["experience"],
  "fitness": ["artifact"],
  "food": ["MealPlan", "PantryItem", "Recipe", "ShoppingItem"],
  "forum": ["community", "post"],
  "game": ["playtest"],
  "goals": ["challenge", "goal"],
  "government": ["CourtCase", "EmergencyPlan", "Permit", "Project", "Record", "Violation"],
  "graph": ["entity"],
  "healthcare": ["artifact"],
  "household": ["BudgetEntry", "CalendarEvent", "Chore", "EmergencyContact", "FamilyMember", "MaintenanceItem", "MealPlan", "Pet"],
  "lab": ["organ"],
  "lock": ["lock-event"],
  "market": ["data"],
  "marketplace": ["listing"],
  "math": ["expression"],
  "music": ["artist", "session-arrangement"],
  "paper": ["citation", "evidence", "experiment", "hypothesis", "project"],
  "realestate": ["artifact"],
  "reflection": ["entry"],
  "resonance": ["signal"],
  "science": ["Analysis", "Equipment", "Experiment", "Publication", "Sample"],
  "security": ["Asset", "Incident", "Patrol", "Surveillance", "ThreatIntel"],
  "sim": ["run"],
  "voice": ["take"],
  "world": ["building"],
};

/** Add the frontend's types to each existing rule. Unknown domains are left alone (they already pass). */
export function reconcileArtifactTypes(rules) {
  let added = 0;
  for (const [domain, types] of Object.entries(FRONTEND_ARTIFACT_TYPES)) {
    const rule = rules.get(domain);
    if (!rule || !Array.isArray(rule.types)) continue;
    for (const t of types) {
      if (!rule.types.includes(t)) { rule.types.push(t); added++; }
    }
  }
  return added;
}
