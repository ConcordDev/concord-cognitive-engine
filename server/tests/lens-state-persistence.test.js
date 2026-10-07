// Tier-2 contract test for Bucket 2 Gap A — lens state persistence.
//
// The 26 STATE.<lens>Lens stores are written to in-memory Maps by the
// domain files. Before this fix the global JSON snapshot didn't include
// them, so a server restart wiped every user's projects/prompts/saved
// searches/journal entries/etc.
//
// This test imports the standalone helpers (server.js is too heavyweight
// to load in tests; the helpers live in their own lib for testability).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LENS_STATE_KEYS,
  serializeLensState,
  hydrateLensState,
} from "../lib/lens-state-persistence.js";

let STATE;
function freshState() {
  STATE = {};
}

describe("lens state persistence — Bucket 2 Gap A", () => {
  beforeEach(() => { freshState(); });

  it("exposes 33 lens state keys", () => {
    // 28 -> 29: "calendarLens" so calendar.events-create survives a restart.
    // 29 -> 30: "marketplaceLens" so a paid shop order survives a restart.
    // The marketplace domain stores orders in STATE.marketplaceLens Maps.
    // Those maps were omitted from the snapshot, so a refresh of the process
    // dropped every order.
    // 30 -> 31: "projectsLens" so a project roster survives a restart.
    // 31 -> 32: "threadLens" so an unpublished draft citing a DTU survives.
    // Without these two the Projects status report's Thread draft vanished on
    // every process restart while the UI still reported it as drafted.
    // 32 -> 33: "codeLens" so a virtual Code project, its files, and its git
    // log survive a restart. Code domain stores workspaces under STATE.codeLens.
    // 33 -> 34: "graphLens" so a user's saved mind maps, nodes, edges,
    // filters, group rules, and layouts survive a restart. The Graph domain
    // stores per-user maps here; without this key a hard restart wiped every
    // map while the UI still showed it.
    // 34 -> 35: "hypothesisLens" so a user's imported datasets, saved
    // analyses, and pre-registered hypotheses survive a restart.
    // 35 -> 36: "srsLens" so a user's decks, cards, review log, and media
    // survive a restart.
    // 36 -> 37: "travelLens" so a user's trips, itineraries, bookings,
    // budgets, checklists, price watches, docs, and loyalty accounts
    // survive a restart.
    // 37 -> 38: "engineeringLens" so a user's saved parts, load cases,
    // and FEA sim-job history survive a restart.
    // 38 -> 39: "physicsLens" so a user's saved PhET scenes and share
    // codes survive a restart.
    // 39 -> 40: "hvacLens" so a user's technicians, appointments, bookings,
    // equipment assets, payments, agreements, and field visits survive a
    // restart.
    // 40 -> 41: "petsLens" so a user's pets, vaccines, medications, vet
    // visits, weights, reminders, photos, appointments, lost-pet profiles,
    // and household access grants survive a restart.
    // 41 -> 42: "boardLens" so a user's Trello-shape boards, columns,
    // cards, checklists, comments, attachments, labels, automation rules,
    // collaborators, and custom fields survive a restart.
    // 42 -> 43: "analyticsLens" so a user's tracked events, saved funnels,
    // dashboards, alerts, and behavioral cohorts survive a restart.
    // 43 -> 44: "creatorLens" so a user's platforms, content pipeline,
    // audience snapshots, revenue entries, goals, demographics, membership
    // tiers, subscriptions, payouts, publish queue, and comments survive a
    // restart.
    assert.equal(LENS_STATE_KEYS.length, 52);
    assert.ok(LENS_STATE_KEYS.includes("chatLens"));
    assert.ok(LENS_STATE_KEYS.includes("worldLens"));
    assert.ok(LENS_STATE_KEYS.includes("accountingLens"));
    assert.ok(LENS_STATE_KEYS.includes("eventTimelineLens"));
    assert.ok(LENS_STATE_KEYS.includes("privacyLens"));
    assert.ok(LENS_STATE_KEYS.includes("calendarLens"));
    assert.ok(LENS_STATE_KEYS.includes("marketplaceLens"));
    assert.ok(LENS_STATE_KEYS.includes("projectsLens"));
    assert.ok(LENS_STATE_KEYS.includes("threadLens"));
    assert.ok(LENS_STATE_KEYS.includes("codeLens"));
    assert.ok(LENS_STATE_KEYS.includes("graphLens"));
    assert.ok(LENS_STATE_KEYS.includes("hypothesisLens"));
    assert.ok(LENS_STATE_KEYS.includes("srsLens"));
    assert.ok(LENS_STATE_KEYS.includes("travelLens"));
    assert.ok(LENS_STATE_KEYS.includes("engineeringLens"));
    assert.ok(LENS_STATE_KEYS.includes("physicsLens"));
    assert.ok(LENS_STATE_KEYS.includes("hvacLens"));
    assert.ok(LENS_STATE_KEYS.includes("petsLens"));
    assert.ok(LENS_STATE_KEYS.includes("boardLens"));
    assert.ok(LENS_STATE_KEYS.includes("analyticsLens"));
    assert.ok(LENS_STATE_KEYS.includes("creatorLens"));
    assert.ok(LENS_STATE_KEYS.includes("astronomyLens"));
    assert.ok(LENS_STATE_KEYS.includes("atlasLens"));
    assert.ok(LENS_STATE_KEYS.includes("energyLens"));
    assert.ok(LENS_STATE_KEYS.includes("emergencyServicesLens"));
    assert.ok(LENS_STATE_KEYS.includes("electricalLens"));
    assert.ok(LENS_STATE_KEYS.includes("defenseLens"));
    assert.ok(LENS_STATE_KEYS.includes("debugLens"));
    assert.ok(LENS_STATE_KEYS.includes("consultingLens"));
  });

  it("roundtrips STATE.threadLens.drafts (an unpublished draft citing a DTU)", () => {
    STATE.threadLens = {
      drafts: new Map([["user_a", [{
        id: "drf_1",
        status: "draft",
        text: "Sprint 1 closed at 8 pts.",
        citations: ["dtu_1"],
      }]]]),
      seq: new Map([["user_a", { d: 1 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.threadLens.drafts instanceof Map);
    assert.equal(STATE.threadLens.drafts.get("user_a")[0].id, "drf_1");
    assert.equal(STATE.threadLens.drafts.get("user_a")[0].status, "draft");
    assert.deepEqual(STATE.threadLens.drafts.get("user_a")[0].citations, ["dtu_1"]);
  });

  it("roundtrips STATE.projectsLens (the roster a status report is built from)", () => {
    STATE.projectsLens = {
      projects: new Map([["user_a", [{ id: "prj_1", key: "NSI", name: "North Star Ingest" }]]]),
      tasks: new Map([["user_a", [{ id: "tsk_1", projectId: "prj_1", status: "done", points: 3 }]]]),
      sprints: new Map(),
      risks: new Map(),
      milestones: new Map(),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.projectsLens.projects instanceof Map);
    assert.equal(STATE.projectsLens.projects.get("user_a")[0].key, "NSI");
    assert.equal(STATE.projectsLens.tasks.get("user_a")[0].points, 3);
    assert.ok(STATE.projectsLens.risks instanceof Map);
  });

  it("roundtrips STATE.codeLens (a virtual Code project and its files)", () => {
    // The Code domain stores projects/files/git under STATE.codeLens.
    // files is Map<userId, Map<projectId, Map<path, FileBlob>>> — three
    // levels of Map nesting. Without codeLens in LENS_STATE_KEYS a restart
    // wiped every project while the editor still showed it.
    STATE.codeLens = {
      projects: new Map([["user_a", [{ id: "proj_1", name: "demo", language: "javascript" }]]]),
      files: new Map([["user_a", new Map([["proj_1", new Map([["src/index.js", { content: "console.log('hi')", modifiedAt: "2026-10-04" }]])]])]]),
      gitState: new Map([["user_a", new Map([["proj_1", { branch: "main", staged: new Set(["src/index.js"]), modified: new Set() }]])]]),
      agentTasks: new Map(),
      chatThreads: new Map(),
      seq: new Map([["user_a", { proj: 2, task: 1, thread: 1 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.codeLens.projects instanceof Map);
    assert.equal(STATE.codeLens.projects.get("user_a")[0].name, "demo");
    assert.ok(STATE.codeLens.files.get("user_a") instanceof Map);
    assert.ok(STATE.codeLens.files.get("user_a").get("proj_1") instanceof Map);
    assert.equal(STATE.codeLens.files.get("user_a").get("proj_1").get("src/index.js").content, "console.log('hi')");
    assert.ok(STATE.codeLens.gitState.get("user_a").get("proj_1").staged instanceof Set);
    assert.ok(STATE.codeLens.gitState.get("user_a").get("proj_1").staged.has("src/index.js"));
    assert.equal(STATE.codeLens.seq.get("user_a").proj, 2);
  });

  it("roundtrips STATE.graphLens (a saved mind map with nodes, edges, and filters)", () => {
    // The Graph domain stores per-user maps under STATE.graphLens.maps as
    // Map<userId, Array<map>>. Each map has nodes and edges arrays. Filters
    // live under STATE.graphLens.filters as Map<userId, Array<filter>>.
    // Without graphLens in LENS_STATE_KEYS a restart wiped every map while
    // the MindMapBuilder still showed it.
    STATE.graphLens = {
      maps: new Map([["user_a", [{
        id: "map_1",
        title: "Product Strategy",
        nodes: [
          { id: "n_central", label: "Product", notes: "", central: true, createdAt: "2026-10-04" },
          { id: "n_branch", label: "Pricing", notes: "Tiered model", parentId: "n_central", createdAt: "2026-10-04" },
        ],
        edges: [{ id: "e_1", from: "n_central", to: "n_branch", label: "", createdAt: "2026-10-04" }],
        createdAt: "2026-10-04",
      }]]]),
      filters: new Map([["user_a", [{ id: "f_1", name: "Central only", query: { central: true } }]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.graphLens.maps instanceof Map);
    const maps = STATE.graphLens.maps.get("user_a");
    assert.equal(maps.length, 1);
    assert.equal(maps[0].title, "Product Strategy");
    assert.equal(maps[0].nodes.length, 2);
    assert.equal(maps[0].nodes[0].central, true);
    assert.equal(maps[0].edges.length, 1);
    assert.ok(STATE.graphLens.filters instanceof Map);
    assert.equal(STATE.graphLens.filters.get("user_a")[0].name, "Central only");
  });

  it("roundtrips STATE.hypothesisLens (a pre-registered hypothesis with a recorded outcome)", () => {
    // The Hypothesis domain stores per-user data under three Maps:
    // datasets, analyses, and registry. Without hypothesisLens in
    // LENS_STATE_KEYS a restart wiped every pre-registration while the
    // RegistryPanel still showed it.
    STATE.hypothesisLens = {
      datasets: new Map([["user_a", new Map([["ds_1", { id: "ds_1", name: "trial.csv", rowCount: 100, columnCount: 3 }]])]]),
      analyses: new Map([["user_a", new Map([["ana_1", { id: "ana_1", kind: "tTest", summary: "Welch t-test", createdAt: "2026-10-04" }]])]]),
      registry: new Map([["user_a", new Map([["preg_1", {
        id: "preg_1",
        statement: "Treatment group will show higher recovery rate",
        predictedDirection: "greater",
        plannedTest: "tTest",
        alpha: 0.05,
        status: "resolved",
        outcome: { verdict: "confirmed", pValue: 0.03, effectSize: 0.5, predictionConfirmed: true },
        registeredAt: "2026-10-04",
      }]])]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.hypothesisLens.datasets instanceof Map);
    assert.ok(STATE.hypothesisLens.datasets.get("user_a") instanceof Map);
    assert.equal(STATE.hypothesisLens.datasets.get("user_a").get("ds_1").name, "trial.csv");
    assert.ok(STATE.hypothesisLens.analyses instanceof Map);
    assert.equal(STATE.hypothesisLens.analyses.get("user_a").get("ana_1").kind, "tTest");
    assert.ok(STATE.hypothesisLens.registry instanceof Map);
    const reg = STATE.hypothesisLens.registry.get("user_a").get("preg_1");
    assert.equal(reg.statement, "Treatment group will show higher recovery rate");
    assert.equal(reg.status, "resolved");
    assert.equal(reg.outcome.verdict, "confirmed");
    assert.equal(reg.outcome.predictionConfirmed, true);
  });

  it("roundtrips STATE.srsLens (a deck with cards and a review log)", () => {
    // The SRS domain stores per-user Anki-shape data under four Maps:
    // decks, cards, reviewLog, and media. Without srsLens in
    // LENS_STATE_KEYS a restart wiped every deck while the study UI still
    // showed it.
    STATE.srsLens = {
      decks: new Map([["user_a", [{ id: "deck_1", name: "Spanish Vocab", options: { scheduler: "fsrs" } }]]]),
      cards: new Map([["user_a", [{ id: "card_1", deckId: "deck_1", front: "hola", back: "hello", ease: 2.5, interval: 1, reps: 1, state: "review" }]]]),
      reviewLog: new Map([["user_a", [{ cardId: "card_1", deckId: "deck_1", rating: "good", scheduler: "fsrs", at: "2026-10-04" }]]]),
      media: new Map([["user_a", []]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.srsLens.decks instanceof Map);
    assert.equal(STATE.srsLens.decks.get("user_a")[0].name, "Spanish Vocab");
    assert.ok(STATE.srsLens.cards instanceof Map);
    assert.equal(STATE.srsLens.cards.get("user_a")[0].front, "hola");
    assert.equal(STATE.srsLens.cards.get("user_a")[0].ease, 2.5);
    assert.ok(STATE.srsLens.reviewLog instanceof Map);
    assert.equal(STATE.srsLens.reviewLog.get("user_a")[0].rating, "good");
    assert.ok(STATE.srsLens.media instanceof Map);
  });

  it("roundtrips STATE.travelLens (a trip with itinerary, bookings, and a budget)", () => {
    // The Travel domain stores per-user data under 12 Maps. Without
    // travelLens in LENS_STATE_KEYS a restart wiped every trip while the
    // TripWorkspace still showed it.
    STATE.travelLens = {
      trips: new Map([["user_a", [{ id: "trip_1", name: "Tokyo Trip", destination: "Tokyo", startDate: "2026-11-01", endDate: "2026-11-07", travelers: 2 }]]]),
      itinerary: new Map([["trip_1", [{ id: "it_1", tripId: "trip_1", title: "Visit Senso-ji", day: 1, time: "10:00", category: "sightseeing" }]]]),
      places: new Map(),
      placeReviews: new Map(),
      bookings: new Map([["trip_1", [{ id: "bk_1", tripId: "trip_1", type: "flight", provider: "JAL", confirmationCode: "JL001", cost: 1200, date: "2026-11-01" }]]]),
      priceWatches: new Map(),
      budgets: new Map([["trip_1", { categories: { flight: 1200, hotel: 800, food: 400 }, updatedAt: "2026-10-04" }]]),
      travelDocs: new Map(),
      checklists: new Map([["trip_1", [{ id: "cl_1", tripId: "trip_1", item: "Passport", category: "documents", done: true }]]]),
      travelDocAttachments: new Map(),
      loyaltyAccounts: new Map(),
      loyaltyPointsLog: new Map(),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.travelLens.trips instanceof Map);
    assert.equal(STATE.travelLens.trips.get("user_a")[0].name, "Tokyo Trip");
    assert.ok(STATE.travelLens.itinerary instanceof Map);
    assert.equal(STATE.travelLens.itinerary.get("trip_1")[0].title, "Visit Senso-ji");
    assert.ok(STATE.travelLens.bookings instanceof Map);
    assert.equal(STATE.travelLens.bookings.get("trip_1")[0].provider, "JAL");
    assert.ok(STATE.travelLens.budgets instanceof Map);
    assert.equal(STATE.travelLens.budgets.get("trip_1").categories.flight, 1200);
    assert.ok(STATE.travelLens.checklists instanceof Map);
    assert.equal(STATE.travelLens.checklists.get("trip_1")[0].done, true);
  });

  it("roundtrips STATE.engineeringLens (a saved part, load case, and FEA sim job)", () => {
    // The Engineering domain stores per-user data under 4 Maps. Without
    // engineeringLens in LENS_STATE_KEYS a restart wiped every part, load
    // case, and FEA run while the ResultsPanel still showed it.
    STATE.engineeringLens = {
      parts: new Map([["user_a", [{ id: "part_1", name: "Bracket", kind: "box", material: "A36 Steel", mass: 12.5 }]]]),
      assemblies: new Map(),
      loadCases: new Map([["user_a", [{ id: "lc_1", name: "Wind Load", model: { nodes: [], members: [], loads: [], supports: [] } }]]]),
      jobs: new Map([["user_a", [{ id: "sim_1", name: "FEA run", type: "fea-frame", status: "completed", elapsedMs: 42, summary: { maxDisplacement: 0.01, maxUtilization: 0.65, allPass: true, memberCount: 3, nodeCount: 4 }, createdAt: "2026-10-05T00:00:00Z" }]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.engineeringLens.parts instanceof Map);
    assert.equal(STATE.engineeringLens.parts.get("user_a")[0].name, "Bracket");
    assert.ok(STATE.engineeringLens.loadCases instanceof Map);
    assert.equal(STATE.engineeringLens.loadCases.get("user_a")[0].name, "Wind Load");
    assert.ok(STATE.engineeringLens.jobs instanceof Map);
    assert.equal(STATE.engineeringLens.jobs.get("user_a")[0].status, "completed");
    assert.equal(STATE.engineeringLens.jobs.get("user_a")[0].summary.maxUtilization, 0.65);
  });

  it("roundtrips STATE.physicsLens (a saved scene with bodies, constraints, and a share code)", () => {
    // The Physics domain stores per-user scenes under nested Maps.
    // Without physicsLens in LENS_STATE_KEYS a restart wiped every scene
    // while the PhysicsLab still showed it.
    STATE.physicsLens = {
      scenes: new Map([["user_a", new Map([
        ["scene_1", {
          id: "scene_1", name: "Pendulum Lab",
          bodies: [{ id: "b1", mass: 1.0, kind: "circle" }, { id: "b2", mass: 2.0, kind: "box" }],
          constraints: [{ id: "c1", kind: "rod" }],
          fluids: [],
          settings: { gravity: 9.8 },
          createdAt: "2026-10-05T00:00:00Z",
          updatedAt: "2026-10-05T01:00:00Z",
          shareCode: "phx_abc",
        }],
      ])]]),
      shares: new Map([["phx_abc", { ownerId: "user_a", scene: { id: "scene_1", name: "Pendulum Lab" }, createdAt: "2026-10-05T00:00:00Z" }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.physicsLens.scenes instanceof Map);
    const userScenes = STATE.physicsLens.scenes.get("user_a");
    assert.ok(userScenes instanceof Map);
    const sc = userScenes.get("scene_1");
    assert.equal(sc.name, "Pendulum Lab");
    assert.equal(sc.bodies.length, 2);
    assert.equal(sc.constraints[0].kind, "rod");
    assert.equal(sc.shareCode, "phx_abc");
    assert.ok(STATE.physicsLens.shares instanceof Map);
    assert.equal(STATE.physicsLens.shares.get("phx_abc").ownerId, "user_a");
  });

  it("roundtrips STATE.hvacLens (a technician, appointment, equipment asset, and agreement)", () => {
    // The HVAC domain stores per-user technicians, appointments, bookings,
    // assets, payments, agreements, and field visits under nested Maps.
    // Without hvacLens in LENS_STATE_KEYS a restart wiped every dispatch
    // board and equipment record while the FieldService panels still
    // showed them.
    STATE.hvacLens = {
      technicians: new Map([["user_a", [
        { id: "tech_1", name: "Riley", skills: ["heat pump"], phone: "555-0100", color: "#38bdf8", active: true, createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      appointments: new Map([["user_a", [
        { id: "appt_1", title: "AC swap", client: "Acme", address: "1 Main St", jobType: "service", technicianId: "tech_1", date: "2026-11-01", slot: "morning", durationHrs: 2, status: "scheduled", priority: "normal", notes: "", createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      bookings: new Map([["user_a", [
        { id: "book_1", customer: "Pat", phone: "555-0142", email: "", address: "9 Oak Rd", serviceType: "diagnostic", preferredDate: "2026-11-02", preferredSlot: "morning", issue: "no cool", status: "requested", confirmation: "HVAC-ABC123", appointmentId: null, createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      assets: new Map([["user_a", [
        { id: "asset_1", client: "Acme", address: "1 Main St", equipmentType: "central-ac", brand: "Carrier", model: "24ABC", serial: "SN1", installYear: 2014, tonnage: 3, seer: 14, refrigerant: "R-410A", warrantyExpires: "2027-01-01", history: [{ id: "svc_1", date: "2026-09-01", serviceType: "maintenance", technician: "Riley", summary: "Filter swap", partsReplaced: ["Filter"], cost: 90, createdAt: "2026-09-01T00:00:00Z" }], createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      payments: new Map([["user_a", [
        { id: "pay_1", kind: "payment", invoiceId: "INV-1", client: "Acme", amount: 200, method: "card", processingFee: 6.1, net: 193.9, status: "paid", reference: "TXN-XYZ", paidAt: "2026-10-05T00:00:00Z", createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      agreements: new Map([["user_a", [
        { id: "agr_1", client: "Acme", address: "1 Main St", tier: "standard", visitsPerYear: 2, annualPrice: 279, perks: ["Spring + fall tune-up", "15% repair discount", "Priority scheduling"], startDate: "2026-01-01", renewalDate: "2027-01-01", autoRenew: true, status: "active", visits: [{ seq: 1, dueDate: "2026-04-01", status: "completed", completedDate: "2026-04-02" }, { seq: 2, dueDate: "2026-10-01", status: "scheduled" }], createdAt: "2026-01-01T00:00:00Z" },
      ]]]),
      fieldVisits: new Map([["user_a", [
        { id: "visit_1", appointmentId: "appt_1", client: "Acme", address: "1 Main St", technician: "Riley", status: "completed", checklist: [{ label: "Inspect air filter", done: true }], partsUsed: [{ id: "part_1", name: "Filter", quantity: 1, unitPrice: 20 }], photos: [], notes: "Done", startedAt: "2026-10-05T00:00:00Z", completedAt: "2026-10-05T01:00:00Z", partsTotal: 20 },
      ]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.hvacLens.technicians instanceof Map);
    assert.equal(STATE.hvacLens.technicians.get("user_a")[0].name, "Riley");
    assert.ok(STATE.hvacLens.appointments instanceof Map);
    assert.equal(STATE.hvacLens.appointments.get("user_a")[0].title, "AC swap");
    assert.equal(STATE.hvacLens.appointments.get("user_a")[0].technicianId, "tech_1");
    assert.ok(STATE.hvacLens.bookings instanceof Map);
    assert.equal(STATE.hvacLens.bookings.get("user_a")[0].confirmation, "HVAC-ABC123");
    assert.ok(STATE.hvacLens.assets instanceof Map);
    const asset = STATE.hvacLens.assets.get("user_a")[0];
    assert.equal(asset.brand, "Carrier");
    assert.equal(asset.history[0].serviceType, "maintenance");
    assert.ok(STATE.hvacLens.payments instanceof Map);
    assert.equal(STATE.hvacLens.payments.get("user_a")[0].kind, "payment");
    assert.equal(STATE.hvacLens.payments.get("user_a")[0].net, 193.9);
    assert.ok(STATE.hvacLens.agreements instanceof Map);
    const agr = STATE.hvacLens.agreements.get("user_a")[0];
    assert.equal(agr.tier, "standard");
    assert.equal(agr.visits[0].status, "completed");
    assert.equal(agr.visits[0].completedDate, "2026-04-02");
    assert.ok(STATE.hvacLens.fieldVisits instanceof Map);
    const visit = STATE.hvacLens.fieldVisits.get("user_a")[0];
    assert.equal(visit.status, "completed");
    assert.equal(visit.partsTotal, 20);
  });

  it("roundtrips STATE.petsLens (a pet with vaccines, medications, reminders, photos, appointments, and a lost-pet card)", () => {
    // The Pets domain stores per-user pets, vaccines, medications, vet
    // visits, weights, care activities, symptoms, reminders, documents,
    // expenses, caregivers, bookings, access grants, photos,
    // appointments, and lost-pet profiles under nested Maps. Without
    // petsLens in LENS_STATE_KEYS a restart wiped every pet health record
    // while the PetCareSection still showed it.
    STATE.petsLens = {
      pets: new Map([["user_a", [
        { id: "pet_1", name: "Mochi", species: "dog", breed: "Shiba Inu", sex: "female", birthdate: "2022-04-01", weightKg: 9.5, microchipId: "CHIP-123", neutered: true, createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      vaccines: new Map([["pet_1", [
        { id: "vac_1", petId: "pet_1", name: "Rabies", date: "2026-05-01", nextDueDate: "2027-05-01", vet: "Dr. Lin", createdAt: "2026-05-01T00:00:00Z" },
      ]]]),
      medications: new Map([["pet_1", [
        { id: "med_1", petId: "pet_1", name: "Apoquel", dosage: "16mg", frequency: "daily", startDate: "2026-06-01", endDate: null, active: true, createdAt: "2026-06-01T00:00:00Z" },
      ]]]),
      reminders: new Map([["pet_1", [
        { id: "rem_1", petId: "pet_1", title: "Trim nails", dueDate: "2026-11-01", done: false, createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      weights: new Map([["pet_1", [
        { id: "w_1", petId: "pet_1", date: "2026-09-01", weightKg: 9.4, createdAt: "2026-09-01T00:00:00Z" },
      ]]]),
      photos: new Map([["pet_1", [
        { id: "ph_1", petId: "pet_1", url: "https://example.com/mochi.jpg", caption: "First day home", takenOn: "2022-04-10", milestone: "adoption", createdAt: "2022-04-10T00:00:00Z" },
      ]]]),
      appointments: new Map([["pet_1", [
        { id: "appt_1", petId: "pet_1", clinic: "Bay Vet", vet: "Dr. Lin", date: "2026-12-01", time: "09:00", reason: "checkup", notes: "", status: "scheduled", reminderId: "rem_2", createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
      lostProfiles: new Map([["pet_1",
        { id: "lost_1", petId: "pet_1", status: "lost", microchipId: "CHIP-123", color: "red sesame", distinguishingMarks: "white sock on front left paw", lastSeenLocation: "Dolores Park", lastSeenDate: "2026-10-04", contactName: "Sam", contactPhone: "555-0142", contactEmail: "sam@example.com", reward: 200, notes: "", publicToken: "tok_abc", createdAt: "2026-10-04T00:00:00Z" },
      ]]),
      petAccess: new Map([["user_a", [
        { id: "acc_1", petId: "pet_1", petName: "Mochi", ownerUserId: "user_a", userId: "user_b", displayName: "Alex", role: "co_owner", revoked: false, createdAt: "2026-10-05T00:00:00Z" },
      ]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.petsLens.pets instanceof Map);
    assert.equal(STATE.petsLens.pets.get("user_a")[0].name, "Mochi");
    assert.equal(STATE.petsLens.pets.get("user_a")[0].microchipId, "CHIP-123");
    assert.ok(STATE.petsLens.vaccines instanceof Map);
    assert.equal(STATE.petsLens.vaccines.get("pet_1")[0].name, "Rabies");
    assert.equal(STATE.petsLens.vaccines.get("pet_1")[0].nextDueDate, "2027-05-01");
    assert.ok(STATE.petsLens.medications instanceof Map);
    assert.equal(STATE.petsLens.medications.get("pet_1")[0].active, true);
    assert.ok(STATE.petsLens.reminders instanceof Map);
    assert.equal(STATE.petsLens.reminders.get("pet_1")[0].done, false);
    assert.ok(STATE.petsLens.weights instanceof Map);
    assert.equal(STATE.petsLens.weights.get("pet_1")[0].weightKg, 9.4);
    assert.ok(STATE.petsLens.photos instanceof Map);
    assert.equal(STATE.petsLens.photos.get("pet_1")[0].milestone, "adoption");
    assert.ok(STATE.petsLens.appointments instanceof Map);
    assert.equal(STATE.petsLens.appointments.get("pet_1")[0].clinic, "Bay Vet");
    assert.ok(STATE.petsLens.lostProfiles instanceof Map);
    assert.equal(STATE.petsLens.lostProfiles.get("pet_1").status, "lost");
    assert.equal(STATE.petsLens.lostProfiles.get("pet_1").publicToken, "tok_abc");
    assert.ok(STATE.petsLens.petAccess instanceof Map);
    assert.equal(STATE.petsLens.petAccess.get("user_a")[0].role, "co_owner");
    assert.equal(STATE.petsLens.petAccess.get("user_a")[0].revoked, false);
  });

  it("roundtrips STATE.boardLens (a Trello-shape board with columns, cards, labels)", () => {
    // The Board domain stores per-user boards under STATE.boardLens.boards
    // as Map<userId, Array<Board>>. Without boardLens in LENS_STATE_KEYS a
    // restart wiped every board while the BoardWorkspace still showed it.
    STATE.boardLens = {
      boards: new Map([
        ["user_a", [{
          id: "bd_1",
          name: "Sprint Board",
          columns: [
            { id: "col_1", name: "To Do" },
            { id: "col_2", name: "In Progress" },
            { id: "col_3", name: "Done" },
          ],
          cards: [{
            id: "crd_1",
            columnId: "col_1",
            title: "Ship proof",
            description: "Real card",
            labels: ["frontend"],
            dueDate: "2026-11-01",
            assignee: "alex",
            checklist: [{ id: "ci_1", text: "Write test", done: false }],
            position: 0,
            createdAt: "2026-10-05T00:00:00.000Z",
          }],
          labelDefs: [{ id: "lbl_1", name: "frontend", color: "blue" }],
          automations: [{ id: "aut_1", trigger: "card_moved", columnId: "col_2", action: "add_label", value: "frontend", enabled: true, createdAt: "2026-10-05T00:00:00.000Z" }],
          collaborators: [{ id: "col_1", userId: "user_b", role: "editor", addedAt: "2026-10-05T00:00:00.000Z" }],
          customFields: [{ id: "cf_1", name: "Estimate", type: "number", options: [] }],
          createdAt: "2026-10-05T00:00:00.000Z",
        }]],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.boardLens.boards instanceof Map);
    const boards = STATE.boardLens.boards.get("user_a");
    assert.equal(boards.length, 1);
    const b = boards[0];
    assert.equal(b.id, "bd_1");
    assert.equal(b.name, "Sprint Board");
    assert.equal(b.columns.length, 3);
    assert.equal(b.columns[0].name, "To Do");
    assert.equal(b.cards.length, 1);
    assert.equal(b.cards[0].title, "Ship proof");
    assert.equal(b.cards[0].columnId, "col_1");
    assert.equal(b.cards[0].checklist[0].text, "Write test");
    assert.equal(b.cards[0].checklist[0].done, false);
    assert.equal(b.labelDefs[0].color, "blue");
    assert.equal(b.automations[0].action, "add_label");
    assert.equal(b.automations[0].enabled, true);
    assert.equal(b.collaborators[0].role, "editor");
    assert.equal(b.customFields[0].type, "number");
  });

  it("roundtrips STATE.analyticsLens (tracked events, saved funnels, dashboards, alerts, and cohorts)", () => {
    // The Analytics domain stores per-user data under five Maps: events,
    // funnels, dashboards, alerts, and cohorts. Without analyticsLens in
    // LENS_STATE_KEYS a restart wiped every tracked event and saved funnel
    // while the EventAnalytics panel still showed the dashboard counts.
    STATE.analyticsLens = {
      events: new Map([["user_a", [
        { id: "ev_1", name: "signup", distinctId: "u_1", properties: { source: "organic" }, at: "2026-10-05T00:00:00.000Z" },
        { id: "ev_2", name: "purchase", distinctId: "u_1", properties: { plan: "pro" }, at: "2026-10-05T01:00:00.000Z" },
      ]]]),
      funnels: new Map([["user_a", [
        { id: "fn_1", name: "Signup to purchase", steps: ["signup", "purchase"], createdAt: "2026-10-05T00:00:00.000Z" },
      ]]]),
      dashboards: new Map([["user_a", [
        { id: "db_1", name: "Growth", widgets: [{ id: "wg_1", kind: "metric", title: "Signups", config: { eventName: "signup" }, x: 0, y: 0, w: 4, h: 3 }], createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" },
      ]]]),
      alerts: new Map([["user_a", [
        { id: "al_1", name: "Signup spike", kind: "threshold", op: "gt", metric: "count", eventName: "signup", threshold: 100, window: 7, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" },
      ]]]),
      cohorts: new Map([["user_a", [
        { id: "co_1", name: "Paid users", includes: ["purchase"], excludes: [], createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" },
      ]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.analyticsLens.events instanceof Map);
    const events = STATE.analyticsLens.events.get("user_a");
    assert.equal(events.length, 2);
    assert.equal(events[0].name, "signup");
    assert.equal(events[0].properties.source, "organic");
    assert.ok(STATE.analyticsLens.funnels instanceof Map);
    const funnels = STATE.analyticsLens.funnels.get("user_a");
    assert.equal(funnels.length, 1);
    assert.equal(funnels[0].name, "Signup to purchase");
    assert.deepEqual(funnels[0].steps, ["signup", "purchase"]);
    assert.ok(STATE.analyticsLens.dashboards instanceof Map);
    const dashboards = STATE.analyticsLens.dashboards.get("user_a");
    assert.equal(dashboards.length, 1);
    assert.equal(dashboards[0].name, "Growth");
    assert.equal(dashboards[0].widgets.length, 1);
    assert.equal(dashboards[0].widgets[0].kind, "metric");
    assert.ok(STATE.analyticsLens.alerts instanceof Map);
    const alerts = STATE.analyticsLens.alerts.get("user_a");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "threshold");
    assert.equal(alerts[0].threshold, 100);
    assert.ok(STATE.analyticsLens.cohorts instanceof Map);
    const cohorts = STATE.analyticsLens.cohorts.get("user_a");
    assert.equal(cohorts.length, 1);
    assert.equal(cohorts[0].name, "Paid users");
    assert.deepEqual(cohorts[0].includes, ["purchase"]);
  });

  it("roundtrips STATE.creatorLens (platforms, content pipeline, audience, revenue, goals, tiers, subscriptions, payouts, queue, comments)", () => {
    // The Creator domain stores per-user data under 11 Maps. Without
    // creatorLens in LENS_STATE_KEYS a restart wiped every content item
    // while the pipeline still showed it.
    STATE.creatorLens = {
      platforms: new Map([["user_a", [{ id: "plt_1", name: "YouTube", handle: "@proof", createdAt: "2026-10-05T00:00:00Z" }]]]),
      content: new Map([["user_a", [{ id: "con_1", title: "Proof Video", format: "video", stage: "idea", views: 0, clicks: 0, conversions: 0, citations: 0, revenue: 0, createdAt: "2026-10-05T00:00:00Z", publishedAt: null }]]]),
      audience: new Map([["user_a", [{ id: "snap_1", platformId: "plt_1", date: "2026-10-05", followers: 1200 }]]]),
      revenue: new Map([["user_a", [{ id: "rev_1", date: "2026-10-05", source: "ad_revenue", amount: 12.5, note: "" }]]]),
      goal: new Map([["user_a", { metric: "followers", target: 5000, deadline: "2026-12-31", setAt: "2026-10-05T00:00:00Z" }]]),
      demographics: new Map([["user_a", [{ id: "dem_1", segment: "18-24", label: "Gen Z", count: 450, date: "2026-10-05" }]]]),
      tiers: new Map([["user_a", [{ id: "tier_1", name: "Pro", priceMonthly: 9, perks: ["Early access"], createdAt: "2026-10-05T00:00:00Z" }]]]),
      subscriptions: new Map([["user_a", [{ id: "sub_1", tierId: "tier_1", supporter: "alex", status: "active", startedAt: "2026-10-05T00:00:00Z", cancelledAt: null }]]]),
      payouts: new Map([["user_a", [{ id: "pay_1", amount: 50, method: "bank", status: "paid", note: "", at: "2026-10-05T00:00:00Z" }]]]),
      publishQueue: new Map([["user_a", [{ id: "pq_1", title: "Ep 1", format: "video", body: "", releaseAt: "2026-11-01T00:00:00Z", status: "scheduled", contentId: null, publishedAt: null }]]]),
      comments: new Map([["user_a", [{ id: "cm_1", contentId: "con_1", author: "sam", body: "Great!", status: "new", pinned: false, at: "2026-10-05T00:00:00Z" }]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.creatorLens.platforms instanceof Map);
    assert.equal(STATE.creatorLens.platforms.get("user_a")[0].name, "YouTube");
    assert.ok(STATE.creatorLens.content instanceof Map);
    const c = STATE.creatorLens.content.get("user_a")[0];
    assert.equal(c.title, "Proof Video");
    assert.equal(c.stage, "idea");
    assert.equal(c.views, 0, "views start at 0 — never seeded");
    assert.ok(STATE.creatorLens.audience instanceof Map);
    assert.equal(STATE.creatorLens.audience.get("user_a")[0].followers, 1200);
    assert.ok(STATE.creatorLens.revenue instanceof Map);
    assert.equal(STATE.creatorLens.revenue.get("user_a")[0].amount, 12.5);
    assert.ok(STATE.creatorLens.goal instanceof Map);
    assert.equal(STATE.creatorLens.goal.get("user_a").target, 5000);
    assert.ok(STATE.creatorLens.demographics instanceof Map);
    assert.equal(STATE.creatorLens.demographics.get("user_a")[0].segment, "18-24");
    assert.ok(STATE.creatorLens.tiers instanceof Map);
    assert.equal(STATE.creatorLens.tiers.get("user_a")[0].priceMonthly, 9);
    assert.ok(STATE.creatorLens.subscriptions instanceof Map);
    assert.equal(STATE.creatorLens.subscriptions.get("user_a")[0].status, "active");
    assert.ok(STATE.creatorLens.payouts instanceof Map);
    assert.equal(STATE.creatorLens.payouts.get("user_a")[0].status, "paid");
    assert.ok(STATE.creatorLens.publishQueue instanceof Map);
    assert.equal(STATE.creatorLens.publishQueue.get("user_a")[0].status, "scheduled");
    assert.ok(STATE.creatorLens.comments instanceof Map);
    assert.equal(STATE.creatorLens.comments.get("user_a")[0].body, "Great!");
  });

  it("roundtrips STATE.astronomyLens (targets, observations, sessions, equipment, wishlist, events)", () => {
    // The Astronomy domain stores per-user data under 6 Maps. Without
    // astronomyLens in LENS_STATE_KEYS a restart wiped every target and
    // observation while the AstroTargetsPanel still showed them.
    STATE.astronomyLens = {
      targets: new Map([["user_a", [{ id: "tgt_1", name: "Andromeda", type: "galaxy", constellation: "Andromeda", magnitude: 3.4, createdAt: "2026-10-05T00:00:00Z" }]]]),
      observations: new Map([["user_a", [{ id: "obs_1", targetId: "tgt_1", targetName: "Andromeda", date: "2026-10-05", conditions: "clear", notes: "bright", rating: 5, createdAt: "2026-10-05T00:00:00Z" }]]]),
      sessions: new Map([["user_a", [{ id: "ses_1", date: "2026-10-05", location: "dark site", seeing: 3, transparency: 4 }]]]),
      equipment: new Map([["user_a", [{ id: "eq_1", name: "Dobsonian 8\"", type: "telescope" }]]]),
      wishlist: new Map([["user_a", [{ id: "wl_1", name: "Televue 31mm Nagler", priority: "high" }]]]),
      events: new Map([["user_a", [{ id: "ev_1", name: "Perseids peak", date: "2026-08-12" }]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.astronomyLens.targets instanceof Map);
    assert.equal(STATE.astronomyLens.targets.get("user_a")[0].name, "Andromeda");
    assert.ok(STATE.astronomyLens.observations instanceof Map);
    const o = STATE.astronomyLens.observations.get("user_a")[0];
    assert.equal(o.targetId, "tgt_1");
    assert.equal(o.rating, 5);
    assert.ok(STATE.astronomyLens.sessions instanceof Map);
    assert.equal(STATE.astronomyLens.sessions.get("user_a")[0].seeing, 3);
    assert.ok(STATE.astronomyLens.equipment instanceof Map);
    assert.equal(STATE.astronomyLens.equipment.get("user_a")[0].name, "Dobsonian 8\"");
    assert.ok(STATE.astronomyLens.wishlist instanceof Map);
    assert.equal(STATE.astronomyLens.wishlist.get("user_a")[0].priority, "high");
    assert.ok(STATE.astronomyLens.events instanceof Map);
    assert.equal(STATE.astronomyLens.events.get("user_a")[0].name, "Perseids peak");
  });

  it("roundtrips STATE.atlasLens (places, lists, trips, recentSearches, seq)", () => {
    // The Atlas domain stores per-user data under 5 Maps. Without
    // atlasLens in LENS_STATE_KEYS a restart wiped every saved place
    // while the PlacesPanel still showed it.
    STATE.atlasLens = {
      places: new Map([["user_a", [{ id: "place_1", number: "PL-00001", name: "Eiffel Tower", lat: 48.8584, lng: 2.2945, category: "attraction", address: "Paris", notes: "", rating: 5, savedAt: "2026-10-05T00:00:00Z" }]]]),
      lists: new Map([["user_a", [{ id: "list_1", name: "Paris Trip", placeIds: ["place_1"], createdAt: "2026-10-05T00:00:00Z" }]]]),
      trips: new Map([["user_a", [{ id: "trip_1", name: "Summer Trip", stops: [{ placeId: "place_1", order: 0 }], createdAt: "2026-10-05T00:00:00Z" }]]]),
      recentSearches: new Map([["user_a", ["Eiffel Tower", "Louvre"]]]),
      seq: new Map([["user_a", { place: 2, list: 2, trip: 2, area: 1 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.atlasLens.places instanceof Map);
    const p = STATE.atlasLens.places.get("user_a")[0];
    assert.equal(p.name, "Eiffel Tower");
    assert.equal(p.number, "PL-00001");
    assert.equal(p.lat, 48.8584);
    assert.ok(STATE.atlasLens.lists instanceof Map);
    assert.equal(STATE.atlasLens.lists.get("user_a")[0].name, "Paris Trip");
    assert.ok(STATE.atlasLens.trips instanceof Map);
    assert.equal(STATE.atlasLens.trips.get("user_a")[0].name, "Summer Trip");
    assert.ok(STATE.atlasLens.recentSearches instanceof Map);
    assert.equal(STATE.atlasLens.recentSearches.get("user_a")[0], "Eiffel Tower");
    assert.ok(STATE.atlasLens.seq instanceof Map);
    assert.equal(STATE.atlasLens.seq.get("user_a").place, 2);
  });

  it("roundtrips STATE.energyLens (meters, readings, live samples, rates, and TOU plan)", () => {
    STATE.energyLens = {
      devices: new Map([["user_a", [{ id: "meter_1", name: "Main meter", category: "meter", wattage: 0 }]]]),
      readings: new Map([["user_a", [{ id: "reading_1", deviceId: "meter_1", kwh: 12.5, date: "2026-10-06" }]]]),
      solar: new Map([["user_a", [{ id: "solar_1", kwh: 6.4, date: "2026-10-06" }]]]),
      rates: new Map([["user_a", { ratePerKwh: 0.21, utility: "Proof utility" }]]),
      goals: new Map([["user_a", [{ id: "goal_1", targetKwh: 500, period: "month" }]]]),
      alerts: new Map([["user_a", []]]),
      livePower: new Map([["user_a", [{ id: "sample_1", deviceId: "meter_1", watts: 725 }]]]),
      touPlans: new Map([["user_a", { peakRate: 0.31, offPeakRate: 0.12, peakStartHour: 16, peakEndHour: 21 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.energyLens.devices instanceof Map);
    assert.equal(STATE.energyLens.devices.get("user_a")[0].category, "meter");
    assert.equal(STATE.energyLens.readings.get("user_a")[0].kwh, 12.5);
    assert.equal(STATE.energyLens.solar.get("user_a")[0].kwh, 6.4);
    assert.equal(STATE.energyLens.rates.get("user_a").ratePerKwh, 0.21);
    assert.equal(STATE.energyLens.goals.get("user_a")[0].targetKwh, 500);
    assert.ok(STATE.energyLens.alerts instanceof Map);
    assert.equal(STATE.energyLens.livePower.get("user_a")[0].watts, 725);
    assert.equal(STATE.energyLens.touPlans.get("user_a").offPeakRate, 0.12);
  });

  it("roundtrips STATE.emergencyServicesLens (CAD board, timeline, mutual aid, and feed dedup)", () => {
    STATE.emergencyServicesLens = {
      incidents: new Map([["user_a", [{ id: "inc_1", summary: "Warehouse alarm", status: "open", priority: 2 }]]]),
      units: new Map([["user_a", [{ id: "unit_1", name: "Engine 3", status: "available", lat: 35.1, lng: -80.8 }]]]),
      eventLog: new Map([["user_a", [{ id: "ev_1", incidentId: "inc_1", kind: "created", detail: "fire", at: "2026-10-07T00:00:00Z" }]]]),
      mutualAid: [{ id: "ma_1", incidentId: "inc_1", sourceOrgId: "org_a", targetOrgId: "org_b", status: "active", committedUnits: [] }],
      mutualAidConsent: new Set(["org_b"]),
      feedSeen: new Set(["quake_us7000test"]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.emergencyServicesLens.incidents instanceof Map);
    assert.equal(STATE.emergencyServicesLens.incidents.get("user_a")[0].summary, "Warehouse alarm");
    assert.ok(STATE.emergencyServicesLens.units instanceof Map);
    assert.equal(STATE.emergencyServicesLens.units.get("user_a")[0].name, "Engine 3");
    assert.ok(STATE.emergencyServicesLens.eventLog instanceof Map);
    assert.equal(STATE.emergencyServicesLens.eventLog.get("user_a")[0].kind, "created");
    assert.equal(STATE.emergencyServicesLens.mutualAid[0].targetOrgId, "org_b");
    assert.ok(STATE.emergencyServicesLens.mutualAidConsent instanceof Set);
    assert.ok(STATE.emergencyServicesLens.mutualAidConsent.has("org_b"));
    assert.ok(STATE.emergencyServicesLens.feedSeen instanceof Set);
    assert.ok(STATE.emergencyServicesLens.feedSeen.has("quake_us7000test"));
  });

  it("roundtrips STATE.electricalLens (panels, estimates, invoices, inspections, diagrams, and prices)", () => {
    STATE.electricalLens = {
      panels: new Map([["user_a", [{ id: "panel_1", name: "Main", circuits: [{ id: "ckt_1", breaker: 20 }] }]]]),
      estimates: new Map([["user_a", [{ id: "est_1", client: "Ramaj", laborLines: [], materialLines: [] }]]]),
      invoices: new Map([["user_a", [{ id: "inv_1", estimateId: "est_1", status: "unpaid", total: 4200 }]]]),
      checklists: new Map([["user_a", [{ id: "chk_1", template: "service", items: [{ id: "item_1", passed: true }] }]]]),
      diagrams: new Map([["user_a", [{ id: "diag_1", nodes: [{ id: "node_1", kind: "utility" }], edges: [] }]]]),
      priceList: new Map([["user_a", [{ id: "mp_1", name: "20A breaker", price: 9.4 }]]]),
      seq: 17,
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.electricalLens.panels instanceof Map);
    assert.equal(STATE.electricalLens.panels.get("user_a")[0].circuits[0].breaker, 20);
    assert.ok(STATE.electricalLens.estimates instanceof Map);
    assert.equal(STATE.electricalLens.estimates.get("user_a")[0].client, "Ramaj");
    assert.ok(STATE.electricalLens.invoices instanceof Map);
    assert.equal(STATE.electricalLens.invoices.get("user_a")[0].total, 4200);
    assert.ok(STATE.electricalLens.checklists instanceof Map);
    assert.equal(STATE.electricalLens.checklists.get("user_a")[0].items[0].passed, true);
    assert.ok(STATE.electricalLens.diagrams instanceof Map);
    assert.equal(STATE.electricalLens.diagrams.get("user_a")[0].nodes[0].kind, "utility");
    assert.ok(STATE.electricalLens.priceList instanceof Map);
    assert.equal(STATE.electricalLens.priceList.get("user_a")[0].price, 9.4);
    assert.equal(STATE.electricalLens.seq, 17);
  });

  it("roundtrips STATE.defenseLens (COP, missions, readiness, threats, personnel, logistics, and comms)", () => {
    STATE.defenseLens = {
      assets: new Map([["user_a", new Map([["asset_1", { id: "asset_1", designation: "Falcon 1", readiness: 92 }]])]]),
      threats: new Map([["user_a", new Map([["threat_1", { id: "threat_1", name: "Storm front", severity: "high", history: [] }]])]]),
      ops: new Map([["user_a", new Map([["cop_1", { id: "cop_1", label: "North sector", isCopMarker: true, lat: 38.9, lon: -77 }]])]]),
      tasks: new Map([["user_a", new Map([["task_1", { id: "task_1", name: "Establish comms", dependsOn: [], status: "pending" }]])]]),
      personnel: new Map([["user_a", new Map([["person_1", { id: "person_1", name: "Sgt Doe", availability: "available" }]])]]),
      supply: new Map([["user_a", new Map([["supply_1", { id: "supply_1", item: "Medical kits", status: "approved", history: [] }]])]]),
      comms: new Map([["user_a", new Map([["msg_1", { id: "msg_1", channel: "ops", body: "Sector clear", acknowledged: true }]])]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    for (const key of ["assets", "threats", "ops", "tasks", "personnel", "supply", "comms"]) {
      assert.ok(STATE.defenseLens[key] instanceof Map);
      assert.ok(STATE.defenseLens[key].get("user_a") instanceof Map);
    }
    assert.equal(STATE.defenseLens.assets.get("user_a").get("asset_1").readiness, 92);
    assert.equal(STATE.defenseLens.threats.get("user_a").get("threat_1").severity, "high");
    assert.equal(STATE.defenseLens.ops.get("user_a").get("cop_1").label, "North sector");
    assert.equal(STATE.defenseLens.tasks.get("user_a").get("task_1").name, "Establish comms");
    assert.equal(STATE.defenseLens.personnel.get("user_a").get("person_1").availability, "available");
    assert.equal(STATE.defenseLens.supply.get("user_a").get("supply_1").status, "approved");
    assert.equal(STATE.defenseLens.comms.get("user_a").get("msg_1").acknowledged, true);
  });

  it("roundtrips STATE.debugLens (issues, traces, alerts, metrics, and releases)", () => {
    STATE.debugLens = {
      issues: new Map([["user_a", [{ id: "issue_1", message: "Cannot read property", status: "open", count: 2 }]]]),
      traces: new Map([["user_a", [{ id: "trace_1", name: "GET /api/status", spans: [{ spanId: "root", durationMs: 12 }] }]]]),
      alertRules: new Map([["user_a", [{ id: "alert_1", metric: "macro_latency_ms", threshold: 80, enabled: true }]]]),
      metrics: new Map([["user_a", [{ metric: "macro_latency_ms", value: 42, unit: "ms" }]]]),
      releases: new Map([["user_a", [{ id: "rel_1", version: "v1.2.3", environment: "production" }]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    for (const key of ["issues", "traces", "alertRules", "metrics", "releases"]) {
      assert.ok(STATE.debugLens[key] instanceof Map);
      assert.ok(Array.isArray(STATE.debugLens[key].get("user_a")));
    }
    assert.equal(STATE.debugLens.issues.get("user_a")[0].count, 2);
    assert.equal(STATE.debugLens.traces.get("user_a")[0].spans[0].durationMs, 12);
    assert.equal(STATE.debugLens.alertRules.get("user_a")[0].threshold, 80);
    assert.equal(STATE.debugLens.metrics.get("user_a")[0].value, 42);
    assert.equal(STATE.debugLens.releases.get("user_a")[0].version, "v1.2.3");
  });

  it("roundtrips STATE.consultingLens (practice operations and client approvals)", () => {
    STATE.consultingLens = {
      engagements: new Map([["user_a", [{
        id: "eng_1",
        name: "Operating model",
        client: "Acme",
        rate: 250,
        budgetHours: 80,
        status: "active",
        timeEntries: [{ id: "te_1", hours: 2.5, note: "Workshop", date: "2026-10-07", invoiceId: "inv_1" }],
      }]]]),
      invoices: new Map([["user_a", [{ id: "inv_1", number: "INV-0001", total: 625, status: "sent" }]]]),
      proposals: new Map([["user_a", [{ id: "prop_1", title: "Operating model", sections: [], status: "draft" }]]]),
      consultants: new Map([["user_a", [{ id: "con_1", name: "Ari", weeklyCapacity: 40, costRate: 100 }]]]),
      allocations: new Map([["user_a", [{ id: "alloc_1", consultantId: "con_1", engagementId: "eng_1", week: "2026-W41", hours: 20 }]]]),
      expenses: new Map([["user_a", [{ id: "exp_1", engagementId: "eng_1", amount: 42, status: "approved" }]]]),
      timers: new Map([["user_a", { engagementId: "eng_1", startedAt: 1234 }]]),
      retainers: new Map([["user_a", [{ id: "ret_1", client: "Acme", monthlyAmount: 5000, periods: [] }]]]),
      shares: new Map([["user_a", [{ id: "share_1", title: "Readout", approvalStatus: "approved" }]]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    for (const key of ["engagements", "invoices", "proposals", "consultants", "allocations", "expenses", "timers", "retainers", "shares"]) {
      assert.ok(STATE.consultingLens[key] instanceof Map);
    }
    assert.equal(STATE.consultingLens.engagements.get("user_a")[0].timeEntries[0].invoiceId, "inv_1");
    assert.equal(STATE.consultingLens.invoices.get("user_a")[0].total, 625);
    assert.equal(STATE.consultingLens.allocations.get("user_a")[0].week, "2026-W41");
    assert.equal(STATE.consultingLens.timers.get("user_a").startedAt, 1234);
    assert.equal(STATE.consultingLens.shares.get("user_a")[0].approvalStatus, "approved");
  });

  it("roundtrips STATE.marketplaceLens.orders (a settled shop order)", () => {
    STATE.marketplaceLens = {
      orders: new Map([["seller_1", [{
        id: "ord_1",
        buyerId: "buyer_1",
        status: "paid",
        paymentStatus: "settled",
        batchId: "batch_1",
        paidCc: 20,
        totalUsd: 20,
      }]]]),
      listings: new Map(),
      shops: new Map(),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.marketplaceLens.orders instanceof Map);
    const order = STATE.marketplaceLens.orders.get("seller_1")[0];
    assert.equal(order.id, "ord_1");
    assert.equal(order.batchId, "batch_1");
    assert.equal(order.paymentStatus, "settled");
    assert.equal(order.paidCc, 20);
  });

  it("roundtrips STATE.calendarLens.events (saved calendar events)", () => {
    STATE.calendarLens = {
      calendars: new Map([["user_a", [{ id: "cal_1", name: "Personal", isDefault: true }]]]),
      events: new Map([["user_a", [{ id: "evt_1", title: "Standup", start: "2026-10-04T17:00:00.000Z" }]]]),
      tasks: new Map(),
      seq: new Map([["user_a", { cal: 2, evt: 2, task: 1 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.calendarLens.events instanceof Map);
    assert.equal(STATE.calendarLens.events.get("user_a")[0].title, "Standup");
    assert.equal(STATE.calendarLens.events.get("user_a")[0].id, "evt_1");
    assert.ok(STATE.calendarLens.calendars instanceof Map);
    assert.equal(STATE.calendarLens.seq.get("user_a").evt, 2);
  });

  it("roundtrips STATE.eventTimelineLens.views (event-timeline saved filter presets)", () => {
    // Regression pin: server/domains/event-timeline.js#savedViewsMap() used
    // to write to a flat STATE.eventTimelineViews field, which was NOT in
    // LENS_STATE_KEYS — saveView()/deleteView() called persistState() but
    // the data was silently dropped from every disk snapshot. Confirms the
    // nested STATE.eventTimelineLens.views shape survives the round trip.
    STATE.eventTimelineLens = {
      views: new Map([
        ["user_a", [
          { id: "view_1", name: "combat-only", channels: ["combat:hit"], worldId: null, query: "", createdAt: 1 },
        ]],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(STATE.eventTimelineLens.views instanceof Map);
    const aliceViews = STATE.eventTimelineLens.views.get("user_a");
    assert.ok(Array.isArray(aliceViews));
    assert.equal(aliceViews[0].name, "combat-only");
  });

  it("serializes empty STATE to empty object", () => {
    assert.deepEqual(serializeLensState(STATE), {});
  });

  it("serializes null STATE safely", () => {
    assert.deepEqual(serializeLensState(null), {});
    assert.deepEqual(serializeLensState(undefined), {});
  });

  it("roundtrips a flat Map<userId, Map<id, obj>> structure", () => {
    STATE.chatLens = {
      projects: new Map([
        ["user_a", new Map([["proj_1", { id: "proj_1", name: "Alpha" }]])],
        ["user_b", new Map([["proj_2", { id: "proj_2", name: "Beta" }]])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(STATE.chatLens.projects instanceof Map);
    assert.ok(STATE.chatLens.projects.get("user_a") instanceof Map);
    assert.equal(STATE.chatLens.projects.get("user_a").get("proj_1").name, "Alpha");
    assert.equal(STATE.chatLens.projects.get("user_b").get("proj_2").name, "Beta");
  });

  it("roundtrips Map<userId, Map>", () => {
    STATE.bioLens = {
      sequences: new Map([
        ["user_a", new Map([["seq_1", { id: "seq_1", sequence: "ATGC" }]])],
      ]),
    };
    STATE.researchLens = {
      notes: new Map(),
      dailyByDate: new Map([
        ["user_a", new Map([["2026-05-16", "note_xyz"]])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.equal(STATE.bioLens.sequences.get("user_a").get("seq_1").sequence, "ATGC");
    assert.equal(STATE.researchLens.dailyByDate.get("user_a").get("2026-05-16"), "note_xyz");
  });

  it("roundtrips Map<userId, Set>", () => {
    // worldLens.pinnedQuests uses Set<questId>
    STATE.worldLens = {
      pinnedQuests: new Map([
        ["user_a", new Set(["q1", "q2", "q3"])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(STATE.worldLens.pinnedQuests.get("user_a") instanceof Set);
    assert.ok(STATE.worldLens.pinnedQuests.get("user_a").has("q2"));
    assert.equal(STATE.worldLens.pinnedQuests.get("user_a").size, 3);
  });

  it("roundtrips Map<userId, Array<obj>> (e.g. journal entries)", () => {
    STATE.accountingLens = {
      journal: new Map([
        ["user_a", [
          { id: "je_1", number: "JE-00001", lines: [{ accountId: "acct_1000", debit: 100, credit: 0 }] },
          { id: "je_2", number: "JE-00002", lines: [] },
        ]],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(Array.isArray(STATE.accountingLens.journal.get("user_a")));
    assert.equal(STATE.accountingLens.journal.get("user_a").length, 2);
    assert.equal(STATE.accountingLens.journal.get("user_a")[0].number, "JE-00001");
  });

  it("roundtrips deeply nested Map<userId, Map<msgId, Map<emoji, count>>>", () => {
    // messageLens.reactions uses three-level nesting
    STATE.messageLens = {
      reactions: new Map([
        ["user_a", new Map([
          ["msg_1", new Map([["👍", 3], ["❤️", 1]])],
        ])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    const userMap = STATE.messageLens.reactions.get("user_a");
    assert.ok(userMap instanceof Map);
    const msgMap = userMap.get("msg_1");
    assert.ok(msgMap instanceof Map);
    assert.equal(msgMap.get("👍"), 3);
    assert.equal(msgMap.get("❤️"), 1);
  });

  it("INVARIANT: per-user scoping survives the cycle (user A's data doesn't leak to user B)", () => {
    STATE.chatLens = {
      projects: new Map([
        ["user_a", new Map([["proj_secret", { name: "user A only" }]])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.equal(STATE.chatLens.projects.has("user_b"), false);
    assert.ok(STATE.chatLens.projects.get("user_a").has("proj_secret"));
  });

  it("hydrate ignores unknown lens keys (forward-compat)", () => {
    hydrateLensState(STATE, { futureLensThatDoesntExistYet: { foo: "bar" } });
    // No throw. STATE.futureLensThatDoesntExistYet is not set because
    // it's not in LENS_STATE_KEYS — that's the safety guarantee.
    assert.equal(STATE.futureLensThatDoesntExistYet, undefined);
  });

  it("hydrate handles null/undefined gracefully", () => {
    assert.doesNotThrow(() => hydrateLensState(STATE, null));
    assert.doesNotThrow(() => hydrateLensState(STATE, undefined));
    assert.doesNotThrow(() => hydrateLensState(STATE, {}));
    assert.doesNotThrow(() => hydrateLensState(null, {}));
  });

  it("serialize handles a lens with mixed field types (Map + Array + plain object)", () => {
    STATE.tradesLens = {
      jobs: new Map([["user_a", new Map([["job_1", { id: "job_1" }]])]]),
      seq: new Map([["user_a", { job: 5, invoice: 3 }]]),
      // Hypothetical plain array field
      events: [{ kind: "audit", at: "2026-05-16" }],
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.equal(STATE.tradesLens.jobs.get("user_a").get("job_1").id, "job_1");
    assert.equal(STATE.tradesLens.seq.get("user_a").job, 5);
    assert.deepEqual(STATE.tradesLens.events, [{ kind: "audit", at: "2026-05-16" }]);
  });

  it("snapshot is JSON-safe (can round-trip through JSON.stringify/parse)", () => {
    STATE.chatLens = {
      projects: new Map([
        ["user_a", new Map([["proj_1", { name: "Alpha", emoji: "🚀" }]])],
      ]),
    };
    STATE.worldLens = {
      pinnedQuests: new Map([["user_a", new Set(["q1", "q2"])]]),
    };

    const persisted = serializeLensState(STATE);
    const jsonRoundtrip = JSON.parse(JSON.stringify(persisted));
    freshState();
    hydrateLensState(STATE, jsonRoundtrip);

    assert.equal(STATE.chatLens.projects.get("user_a").get("proj_1").emoji, "🚀");
    assert.ok(STATE.worldLens.pinnedQuests.get("user_a").has("q1"));
  });
});
