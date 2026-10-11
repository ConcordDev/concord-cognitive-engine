// server/lib/lens-state-persistence.js
//
// Bucket 2 Gap A — persistent backing for the 26 STATE.<lens>Lens stores.
//
// Background: every domain file under server/domains/ that ships a workbench
// drawer stores per-user data under STATE.<lens>Lens = { ...: Map<userId, X> }
// where X ∈ Map | Set | Array | object. Before this module existed, the
// snapshot in server.js#_serializeState() never included these keys, so a
// hard restart wiped every user's saved projects/prompts/notes/journal/etc.
//
// This module exports two helpers plumbed into the existing snapshot
// mechanism (server.js _serializeState/_hydrateState). No new SQLite tables
// needed — the existing state_snapshots table already holds the JSON blob.

// Owner-approved 2026-10-11: in-memory financial records that round-trip
// through the process snapshot. They are not the CC ledger. serializeLensState
// drops MONEY_SNAPSHOT_SECRET_FIELDS if one is ever attached to a row.
// Signer email, policy numbers, and Sparks amounts are the records themselves.
export const MONEY_SNAPSHOT_KEYS = Object.freeze([
  "predictionMarkets",
  "inheritPacts",
  "insAms",
  "serviceListings",
  "serviceOrders",
]);

export const MONEY_SNAPSHOT_SECRET_FIELDS = Object.freeze([
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "api_key",
  "secret",
  "password",
  "privateKey",
  "paymentRef",
  "paymentIntentId",
  "clientSecret",
  "authorization",
  "stripePaymentIntent",
]);

const MONEY_SNAPSHOT_SECRET_FIELD_SET = new Set(MONEY_SNAPSHOT_SECRET_FIELDS);

// Canonical list of lens state keys. Add new entries here when a new
// lens domain file ships its own STATE.<x>Lens store.
export const LENS_STATE_KEYS = Object.freeze([
  "accountingLens", "agricultureLens", "aviationLens", "bioLens",
  "calendarLens", "chatLens", "cryptoLens", "ecoLens", "educationLens",
  "eventTimelineLens",
  "financeLens", "fitnessLens", "foodLens", "govLens",
  "healthLens", "insLens", "legalLens", "logLens",
  "marketsLens", "marketplaceLens", "messageLens", "privacyLens", "projectsLens", "realestateLens", "researchLens",
  "retailLens", "scienceLens", "studioLens", "threadLens", "tradesLens",
  "whiteboardLens", "worldLens",
  // 32 -> 33: "codeLens" so a virtual project, its files, and its git log
  // survive a restart. The Code domain stores workspaces here; without this
  // key a hard restart wiped every project while the editor still showed it.
  "codeLens",
  // 33 -> 34: "graphLens" so a user's saved mind maps, nodes, edges,
  // filters, group rules, and layouts survive a restart. The Graph domain
  // stores per-user maps here; without this key a hard restart wiped every
  // map while the UI still showed it.
  "graphLens",
  // 34 -> 35: "hypothesisLens" so a user's imported datasets, saved
  // analyses, and pre-registered hypotheses survive a restart. The
  // Hypothesis domain stores per-user data here; without this key a hard
  // restart wiped every pre-registration while the registry still showed it.
  "hypothesisLens",
  // 35 -> 36: "srsLens" so a user's decks, cards, review log, and media
  // survive a restart. The SRS domain stores per-user Anki-shape data here;
  // without this key a hard restart wiped every deck while the study UI
  // still showed it.
  "srsLens",
  // 36 -> 37: "travelLens" so a user's trips, itineraries, bookings,
  // budgets, checklists, price watches, docs, and loyalty accounts survive
  // a restart. The Travel domain stores per-user data here; without this
  // key a hard restart wiped every trip while the TripWorkspace still
  // showed it.
  "travelLens",
  // 37 -> 38: "engineeringLens" so a user's saved parts, load cases,
  // and FEA sim-job history survive a restart. The Engineering domain
  // stores per-user data here; without this key a hard restart wiped
  // every part and FEA run while the ResultsPanel still showed it.
  "engineeringLens",
  // 38 -> 39: "physicsLens" so a user's saved PhET scenes and share codes
  // survive a restart. The Physics domain stores per-user data here;
  // without this key a hard restart wiped every scene while the PhysicsLab
  // still showed it.
  "physicsLens",
  // 39 -> 40: "hvacLens" so a user's technicians, appointments, bookings,
  // equipment assets, payments, agreements, and field visits survive a
  // restart. The HVAC domain stores per-user data here; without this key a
  // hard restart wiped every dispatch board and equipment record while the
  // FieldService panels still showed them.
  "hvacLens",
  // 40 -> 41: "petsLens" so a user's pets, vaccines, medications, vet
  // visits, weights, care activities, symptoms, reminders, documents,
  // expenses, caregivers, bookings, pet access grants, photos,
  // appointments, and lost-pet profiles survive a restart. The Pets
  // domain stores per-user data here; without this key a hard restart
  // wiped every pet health record while the PetCareSection still showed
  // it.
  "petsLens",
  // 41 -> 42: "boardLens" so a user's Trello-shape boards, columns, cards,
  // checklists, comments, attachments, labels, automation rules,
  // collaborators, and custom fields survive a restart. The Board domain
  // stores per-user boards here; without this key a hard restart wiped
  // every board while the BoardWorkspace still showed it.
  "boardLens",
  // 42 -> 43: "analyticsLens" so a user's tracked events, saved funnels,
  // dashboards, alerts, and behavioral cohorts survive a restart. The
  // Analytics domain stores per-user event/funnel/dashboard/alert/cohort
  // Maps here; without this key a hard restart wiped every tracked event
  // while the EventAnalytics panel still showed the dashboard counts.
  "analyticsLens",
  // 43 -> 44: "creatorLens" so a user's platforms, content pipeline,
  // audience snapshots, revenue entries, goals, demographics, membership
  // tiers, subscriptions, payouts, publish queue, and comments survive a
  // restart. The Creator domain stores per-user data here; without this
  // key a hard restart wiped every content item while the pipeline still
  // showed it.
  "creatorLens",
  // 44 -> 45: "astronomyLens" so a user's observing targets, observation
  // log, observing sessions, equipment, wishlist, and astronomical events
  // survive a restart. The Astronomy domain stores per-user Maps here;
  // without this key a hard restart wiped every target and observation
  // while the AstroTargetsPanel still showed them.
  "astronomyLens",
  // 45 -> 46: "atlasLens" so a user's saved places, lists, trips,
  // recent searches, and sequence counters survive a restart. The Atlas
  // domain stores per-user Maps here; without this key a hard restart
  // wiped every saved place while the PlacesPanel still showed it.
  "atlasLens",
  // 46 -> 47: "energyLens" so a user's meters, readings, live samples,
  // solar entries, rates, goals, alerts, and time-of-use plan survive a
  // restart. The Energy domain stores per-user Maps here; without this key
  // the meter workspace appeared persistent until the server restarted.
  "energyLens",
  // 47 -> 48: "emergencyServicesLens" so incidents, units, positions,
  // timelines, mutual-aid consent/shares, and feed dedup survive a restart.
  // The CAD domain stores nested per-user/per-agency Maps and Sets here.
  "emergencyServicesLens",
  // 48 -> 49: "electricalLens" so panel schedules, estimates/invoices,
  // inspection checklists, one-lines, and material prices survive a restart.
  // The Electrical domain stores per-user arrays inside Maps here.
  "electricalLens",
  // 46 -> 47: "answersLens" so a user's questions, answers, comments,
  // votes, reputation, notifications, watched tags, and subscriptions
  // survive a restart. The Answers domain stores per-user Maps/Sets here;
  // without this key a hard restart wiped every question while the
  // AnswersQA panel still showed it.
  "answersLens",
  // 50 -> 51: "defenseLens" so the common operating picture, mission
  // tasks, assets, threats, personnel, supply requests, and comms log
  // survive a restart. The Defense domain stores nested per-user Maps here.
  "defenseLens",
  // 51 -> 52: "debugLens" so issue records, measured traces, metric
  // samples, alert rules, and release records survive a restart.
  "debugLens",
  // 52 -> 53: "consultingLens" so engagements, time entries, invoices,
  // proposals, staffing, expenses, timers, retainers, and portal approvals
  // survive a restart.
  "consultingLens",
  // 53 -> 54: "conLens" so RFIs, submittals, daily logs, punch items,
  // change orders, drawings, and budgets survive a hard backend restart.
  "conLens",
  // Persistence audit (2026-10): every STATE.<x>Lens store a domain file
  // assigns but that was missing above, so its per-user data survives a restart.
  "adminLens", "agentsLens", "allianceLens", "allLens", "animationLens", "anonLens",
  "appMakerLens", "arLens", "artistryLens", "artLens", "attentionLens", "auditLens",
  "automotiveLens", "billingLens", "blackMarketLens", "bountiesLens", "bridgeLens", "carpentryLens",
  "classroomLens", "cognitionLens", "collabLens", "commandCenterLens", "commonsenseLens", "cookingLens",
  "councilLens", "creativeLens", "criLens", "customLens", "dailyLens", "databaseLens",
  "debateLens", "deitiesLens", "desertLens", "disputesLens", "diyLens", "docsLens",
  "dtusLens", "dxPlatformLens", "environmentLens", "ethicsLens", "eventsLens", "expeditionJournalLens",
  "experienceLens", "exportLens", "fashionLens", "feedLens", "filmLens", "forestryLens",
  "forgeLens", "forkLens", "forumLens", "fractalLens", "galleryLens", "gameDesignLens",
  "geologyLens", "goalsLens", "goddessLens", "governmentLens", "groundingLens", "historyLens",
  "homeImprovementLens", "householdLens", "hrLens", "importLens", "inferenceLens", "ingestLens",
  "integrationsLens", "invariantLens", "kingdomsLens", "labLens", "landscapingLens", "lawLens",
  "legacyLens", "linguisticsLens", "lockLens", "logisticsLens", "manufacturingLens", "marketingLens",
  "marketLens", "masonryLens", "materialsLens", "meditationLens", "mentalHealthLens", "mentorshipLens",
  "metacognitionLens", "metalearningLens", "metaLens", "miningLens", "mlLens", "musicLens",
  "neuroLens", "newsLens", "nonprofitLens", "observeLens", "oceanLens", "offlineLens",
  "opsLens", "organLens", "paperLens", "parentingLens", "pharmacyLens", "philosophyLens",
  "photographyLens", "platformLens", "plumbingLens", "podcastLens", "poetryLens", "productivityLens",
  "psyopsLens", "quantumLens", "questmarketLens", "queueLens", "reasoningLens", "reflectionLens",
  "reposLens", "resonanceLens", "roboticsLens", "rootLens", "sandboxLens", "savedLens",
  "schemaLens", "securityLens", "selfLens", "sensorLens", "servicesLens", "simLens",
  "socialLens", "spaceLens", "sponsorshipLens", "sportsLens", "subWorldsLens", "sufferingLens",
  "supplychainLens", "systemLens", "temporalLens", "tickLens", "timelineLens", "toolsLens",
  "tournamentsLens", "transferLens", "understandingLens", "urbanPlanningLens", "veterinaryLens", "voiceLens",
  "voteLens", "walletLens", "weldingLens", "wellnessLens", "worldCreatorLens", "worldmodelLens",
  "writingLens",
  // Expert Mode research threads, Spaces (saved answers + share tokens),
  // and uploaded document text. The domain used to hang these Maps off
  // STATE._expertMode, which _serializeState never walked, and a Map
  // stringifies to "{}". A clean shutdown then saved an empty store.
  "expertModeLens",
  // INC-32: user-authored records that were not named *Lens. The snapshot
  // walker only reads this list, so a key left off it is wiped on every
  // deploy restart. Root values may be a Map (playerProfiles) or a bag of
  // Maps (_settings). Sequence counters are numbers next to those Maps.
  "_settings", "_personas", "_lawEnforcement",
  "playerProfiles", "profileVisitors", "_profileVisitorSeq",
  "game", "entityGraph",
  "chemStructures", "chemLabNotebook",
  "mathCAS", "genesisSavedSearches", "digitalTwins",
  "companionNotifications", "companionPushPrefs", "_companionNotifSeq",
  // Sparks prediction positions, inheritance pacts, agency AMS records,
  // and service-market listings/orders. See MONEY_SNAPSHOT_KEYS.
  ...MONEY_SNAPSHOT_KEYS,
]);

// User-record STATE keys a domain assigns that this snapshot intentionally
// does not walk. The guard in tests/lens-state-persistence.test.js fails
// when a domain hangs a Map off STATE under a key that is in neither
// LENS_STATE_KEYS nor this map. Reasons are the contract: ephemeral,
// secret, real-money (human decision), a cache whose durable copy is
// SQLite, or a follow-up that is still wiped on restart.
export const SNAPSHOT_EXCLUDED_STATE_KEYS = Object.freeze({
  settings: "process settings bag already written by _serializeState (disabledHeartbeats), not a per-user record store",
  presenceHeartbeats: "ephemeral live presence; a heartbeat outside the online window is not a kept record",
  concordLinkFrontier: "SQLite is the restart record; the Map is a cache",
  federation: "deferred: actorKeys store registered public keys and must be omitted before the access/moderation records are snapshotted",
  affectMood: "deferred INC-32 follow-up: mood check-ins, reminders, and scales are still memory-only",
  cognitiveReplay: "deferred INC-32 follow-up: shareable timeline snapshots and moments are still memory-only",
  districtSnapshots: "deferred INC-32 follow-up: recorded district timeline snapshots are still memory-only",
  filmLensX: "deferred INC-32 follow-up: revisions, proxy media, multicam, watch parties, and festival submissions are still memory-only (filmLens itself is snapshotted)",
  newsParity: "deferred INC-32 follow-up: alert subscriptions, alert feed, offline items, and digest schedule are still memory-only (newsLens itself is snapshotted)",
  notaryRecords: "deferred INC-32 follow-up: local hash-chain notarization records are still memory-only",
  seasonalChallenges: "deferred INC-32 follow-up: seasonal challenges are still memory-only",
  seasonalCompetitions: "deferred INC-32 follow-up: seasonal competitions are still memory-only",
  sentinelCases: "deferred INC-32 follow-up: triage cases are still memory-only",
  sentinelMonitors: "deferred INC-32 follow-up: monitors are still memory-only",
  sentinelTimeline: "deferred INC-32 follow-up: threat timeline is still memory-only",
  sentinelScanConfig: "deferred INC-32 follow-up: scan config is still memory-only",
  sentinelQueries: "deferred INC-32 follow-up: saved queries are still memory-only",
  sentinelAlerts: "deferred INC-32 follow-up: alerts are still memory-only",
  societyCharts: "deferred INC-32 follow-up: saved chart specs are still memory-only",
  standardsSaved: "deferred INC-32 follow-up: saved standards are still memory-only",
  telecom: "deferred INC-32 follow-up: towers, spectrum, outages, and drive tests are still memory-only",
  uxSuite: "deferred INC-32 follow-up: prop overrides and favourites are still memory-only",
  wellnessTherapy: "deferred INC-32 follow-up: CBT records, meditation sessions, and wearable summaries are still memory-only (wellnessLens itself is snapshotted)",
  stakingAprHistory: "intentionally memory-only: cosmetic APR chart samples, not positions; stake positions are ledger rows",
  lensArtifacts: "SQLite write-through store; _serializeState omits it on purpose so hydration does not replace the live store with a plain Map",
  meshConsensusDags: "excluded: each entry holds an Ed25519 keypair generated on first use; private keys must not enter the snapshot",
  meshNodes: "deferred INC-32 follow-up: mesh nodes are still memory-only",
  meshMessages: "deferred INC-32 follow-up: mesh messages are still memory-only",
  meshChannels: "deferred INC-32 follow-up: mesh channels are still memory-only",
  meshQueue: "deferred INC-32 follow-up: mesh outbound frames are still memory-only",
  meshSeq: "deferred INC-32 follow-up: mesh id counter is still memory-only (kept with the mesh records)",
  cobuildSessions: "deferred INC-32 follow-up: co-build sessions are still memory-only",
  cobuildTasks: "deferred INC-32 follow-up: co-build tasks are still memory-only",
  cobuildAnnotations: "deferred INC-32 follow-up: co-build annotations are still memory-only",
  codeQuality: "deferred INC-32 follow-up: scan history, issues, and gate config are still memory-only",
  crisisPlaybookProgress: "deferred INC-32 follow-up: playbook progress is still memory-only",
  crisisTeams: "deferred INC-32 follow-up: crisis team assignments are still memory-only",
  crisisTimelines: "deferred INC-32 follow-up: crisis timelines are still memory-only",
  crisisAlertAcks: "deferred INC-32 follow-up: alert acknowledgements are still memory-only",
  crisisResources: "deferred INC-32 follow-up: crisis resources are still memory-only",
  dreamTags: "deferred INC-32 follow-up: dream tags are still memory-only",
  dreamInterpretations: "deferred INC-32 follow-up: dream interpretations are still memory-only",
  ghostHunts: "deferred INC-32 follow-up: ghost-hunt records are still memory-only",
  ghostHistory: "deferred INC-32 follow-up: ghost-hunt history is still memory-only",
  ghostRank: "deferred INC-32 follow-up: ghost-hunt rank is still memory-only",
  globalSavedViews: "deferred INC-32 follow-up: saved chart views are still memory-only",
  inheritanceEstates: "deferred INC-32 follow-up: estate records are still memory-only",
  inheritanceNotices: "deferred INC-32 follow-up: heir notices are still memory-only",
});

function isPlainObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Maps and Sets are not JSON-safe: JSON.stringify(new Set(["a"])) === "{}".
// Walking only the Map/Set at the top of a field left Sets that live INSIDE
// a plain object (social moderation `{ muted: Set, blocked: Set }`) as live
// Set instances on the object. The snapshot's JSON.stringify then erased
// their members, and the next boot did `new Set({})`, which throws
// "object is not iterable". Recurse through plain objects and arrays so a
// nested Set/Map is an envelope before stringify. Cycles collapse to an
// empty collection rather than overflowing the save.
function serializeValue(v, seen = new WeakSet()) {
  if (v instanceof Map) {
    if (seen.has(v)) return { __type: "Map", entries: [] };
    seen.add(v);
    const entries = Array.from(v.entries()).map(([k, vv]) => [k, serializeValue(vv, seen)]);
    seen.delete(v);
    return { __type: "Map", entries };
  }
  if (v instanceof Set) {
    if (seen.has(v)) return { __type: "Set", values: [] };
    seen.add(v);
    const values = Array.from(v).map((item) => serializeValue(item, seen));
    seen.delete(v);
    return { __type: "Set", values };
  }
  if (Array.isArray(v)) {
    if (seen.has(v)) return [];
    seen.add(v);
    const out = v.map((item) => serializeValue(item, seen));
    seen.delete(v);
    return out;
  }
  if (isPlainObject(v)) {
    if (seen.has(v)) return {};
    seen.add(v);
    const out = {};
    for (const [k, vv] of Object.entries(v)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = serializeValue(vv, seen);
    }
    seen.delete(v);
    return out;
  }
  return v;
}

function deserializeValue(v) {
  if (Array.isArray(v)) return v.map((item) => deserializeValue(item));
  if (!v || typeof v !== "object") return v;
  if (v.__type === "Map" && Array.isArray(v.entries)) {
    return new Map(v.entries.map(([k, vv]) => [k, deserializeValue(vv)]));
  }
  if (v.__type === "Set" && Array.isArray(v.values)) {
    return new Set(v.values.map((item) => deserializeValue(item)));
  }
  if (!isPlainObject(v)) return v;
  const out = {};
  for (const [k, vv] of Object.entries(v)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = deserializeValue(vv);
  }
  return out;
}

// Drop secret-shaped property names from an already-serialized value.
// Map keys (user ids, record ids) are kept; only object fields are removed.
function omitMoneySecretFields(v) {
  if (Array.isArray(v)) return v.map((item) => omitMoneySecretFields(item));
  if (!v || typeof v !== "object") return v;
  if (v.__type === "Map" && Array.isArray(v.entries)) {
    return {
      __type: "Map",
      entries: v.entries.map(([k, vv]) => [k, omitMoneySecretFields(vv)]),
    };
  }
  if (v.__type === "Set" && Array.isArray(v.values)) {
    return { __type: "Set", values: v.values.map((item) => omitMoneySecretFields(item)) };
  }
  const out = {};
  for (const [k, vv] of Object.entries(v)) {
    if (MONEY_SNAPSHOT_SECRET_FIELD_SET.has(k)) continue;
    out[k] = omitMoneySecretFields(vv);
  }
  return out;
}

// Walk every registered lens key on STATE, serialize nested Map/Set into
// JSON-safe envelopes. Returns a plain object suitable for JSON.stringify.
export function serializeLensState(STATE) {
  if (!STATE || typeof STATE !== "object") return {};
  const out = {};
  for (const key of LENS_STATE_KEYS) {
    const lens = STATE[key];
    if (lens == null) continue;
    // A top-level Map/Set has no enumerable fields. Object.entries(map)
    // is [] and JSON.stringify(map) is "{}", which is how these stores
    // used to vanish. Persist the collection itself.
    if (lens instanceof Map || lens instanceof Set) {
      out[key] = serializeValue(lens);
      continue;
    }
    // Sequence counters (_profileVisitorSeq, _companionNotifSeq) are numbers.
    if (typeof lens !== "object") {
      out[key] = lens;
      continue;
    }
    const lensOut = {};
    for (const [field, val] of Object.entries(lens)) {
      lensOut[field] = serializeValue(val);
    }
    out[key] = lensOut;
  }
  for (const key of MONEY_SNAPSHOT_KEYS) {
    if (out[key] != null) out[key] = omitMoneySecretFields(out[key]);
  }
  return out;
}

// Inverse: take the persisted blob and restore STATE.<lens>Lens with
// proper Map/Set instances. Unknown lens keys are silently ignored
// (forward-compat — old snapshots may carry lens keys that were renamed
// or removed; we don't want a single malformed entry to block startup).
export function hydrateLensState(STATE, persisted) {
  if (!STATE || typeof STATE !== "object") return;
  if (!persisted || typeof persisted !== "object") return;
  for (const key of LENS_STATE_KEYS) {
    const lensPersisted = persisted[key];
    if (lensPersisted == null) continue;
    if (typeof lensPersisted !== "object") {
      STATE[key] = lensPersisted;
      continue;
    }
    // Root Map/Set envelope (playerProfiles, mathCAS, …).
    if (
      (lensPersisted.__type === "Map" && Array.isArray(lensPersisted.entries))
      || (lensPersisted.__type === "Set" && Array.isArray(lensPersisted.values))
    ) {
      STATE[key] = deserializeValue(lensPersisted);
      continue;
    }
    const lensOut = {};
    for (const [field, val] of Object.entries(lensPersisted)) {
      lensOut[field] = deserializeValue(val);
    }
    STATE[key] = lensOut;
  }
}
