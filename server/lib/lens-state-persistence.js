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
  // INC-32 follow-up: the remaining user-authored stores. Caps and the
  // federation actorKeys omission live in preparePersistedState below.
  // meshChannels stays excluded (channel PSKs). Money-adjacent stores and
  // meshConsensusDags stay excluded for a human decision.
  "affectMood", "cognitiveReplay", "districtSnapshots", "filmLensX", "newsParity",
  "notaryRecords", "seasonalChallenges", "seasonalCompetitions",
  "sentinelCases", "sentinelMonitors", "sentinelTimeline", "sentinelScanConfig",
  "sentinelQueries", "sentinelAlerts",
  "societyCharts", "standardsSaved", "telecom", "uxSuite", "wellnessTherapy",
  "meshNodes", "meshMessages", "meshQueue", "meshSeq",
  "cobuildSessions", "cobuildTasks", "cobuildAnnotations",
  "codeQuality",
  "crisisPlaybookProgress", "crisisTeams", "crisisTimelines", "crisisAlertAcks", "crisisResources",
  "dreamTags", "dreamInterpretations",
  "ghostHunts", "ghostHistory", "ghostRank",
  "globalSavedViews",
  "inheritanceEstates", "inheritanceNotices",
  "federation",
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
  predictionMarkets: "deferred for a human decision: Sparks-denominated positions and limit orders, not CC, but they are financial positions",
  inheritPacts: "deferred for a human decision: Sparks-denominated inheritance pacts and payout history, not CC",
  insAms: "deferred for a human decision: carrier roster, renewal pipeline, FNOL, statements, and certificates read as agency financial records",
  serviceListings: "deferred for a human decision: listing prices and orders are a marketplace, currency not proven to be demo credit",
  serviceOrders: "deferred for a human decision: orders carry prices against service listings",
  stakingAprHistory: "intentionally memory-only: cosmetic APR chart samples, not positions; stake positions are ledger rows",
  lensArtifacts: "SQLite write-through store; _serializeState omits it on purpose so hydration does not replace the live store with a plain Map",
  meshConsensusDags: "excluded: each entry holds an Ed25519 keypair generated on first use; private keys must not enter the snapshot",
  meshChannels: "excluded: a channel record stores the pre-shared key in psk; credentials must not enter the snapshot. Nodes, messages, the outbound queue, and the id counter are snapshotted without it",
});

// Property names that are key material. Stripped on the way into the
// snapshot and again on hydrate for the INC-32 follow-up stores, so a
// crafted blob cannot put a private key back into STATE. User prose is
// not scanned; only these field names are dropped.
export const SNAPSHOT_SECRET_FIELDS = new Set([
  "actorKeys",
  "privateKey",
  "privateKeyPem",
  "publicKey",
  "publicKeyPem",
  "psk",
  "password",
  "passphrase",
  "apiKey",
  "accessToken",
  "refreshToken",
  "keypair",
]);

// Serialize-time caps. Outer user-id keys are never dropped. `keep: "head"`
// retains the front of a newest-first list (unshift). `keep: "tail"` retains
// the end of an append list. Map caps keep the most recently inserted
// entries. Caps copy; they do not splice the live store.
export const SNAPSHOT_STORE_CAPS = Object.freeze({
  affectMood: {
    checkins: { shape: "userArray", max: 400, keep: "tail" },
    reminders: { shape: "userArray", max: 100, keep: "tail" },
  },
  cognitiveReplay: {
    snapshots: { shape: "userArray", max: 50, keep: "head" },
    moments: { shape: "userArray", max: 200, keep: "head" },
  },
  // Per district. The district id map itself is capped so one caller
  // cannot fill the snapshot with empty district keys.
  districtSnapshots: { shape: "idArray", max: 500, keep: "tail", mapMax: 1000 },
  filmLensX: {
    revisions: { shape: "userArray", max: 200, keep: "tail" },
    media: { shape: "userArray", max: 400, keep: "tail" },
    mcamGroups: { shape: "userArray", max: 100, keep: "tail" },
    parties: { shape: "userArray", max: 100, keep: "tail" },
    partyChat: { shape: "idArray", max: 200, keep: "tail", mapMax: 500 },
    festivals: { shape: "userArray", max: 200, keep: "tail" },
  },
  newsParity: {
    alertSubs: { shape: "userArray", max: 100, keep: "tail" },
    alertFeed: { shape: "userArray", max: 400, keep: "tail" },
    offline: { shape: "userArray", max: 200, keep: "tail" },
  },
  notaryRecords: { shape: "userArray", max: 400, keep: "tail" },
  seasonalChallenges: { shape: "userMap", max: 200 },
  seasonalCompetitions: { shape: "userMap", max: 200 },
  sentinelCases: { shape: "userMap", max: 400 },
  sentinelMonitors: { shape: "userMap", max: 200 },
  sentinelTimeline: { shape: "userArray", max: 500, keep: "head" },
  sentinelScanConfig: { shape: "rules", max: 100, keep: "head" },
  sentinelQueries: { shape: "userMap", max: 200 },
  sentinelAlerts: { shape: "userArray", max: 300, keep: "head" },
  societyCharts: { shape: "perOwner", max: 100, ownerField: "owner" },
  standardsSaved: { shape: "userMap", max: 200 },
  telecom: {
    towers: { shape: "userArray", max: 400, keep: "tail" },
    spectrum: { shape: "userArray", max: 200, keep: "tail" },
    outages: { shape: "userArray", max: 400, keep: "tail" },
    driveTests: { shape: "userArray", max: 2000, keep: "tail" },
  },
  uxSuite: {
    propOverrides: { shape: "userMap", max: 200 },
    favourites: { shape: "userSet", max: 200 },
  },
  wellnessTherapy: {
    fields: { shape: "userArray", max: 200, keep: "tail" },
    thoughtRecords: { shape: "userArray", max: 400, keep: "tail" },
    sessions: { shape: "userArray", max: 400, keep: "tail" },
    wearableSyncs: { shape: "userArray", max: 200, keep: "tail" },
  },
  meshNodes: { shape: "userMap", max: 400 },
  meshMessages: { shape: "userArray", max: 500, keep: "tail" },
  meshQueue: { shape: "userArray", max: 200, keep: "tail" },
  cobuildSessions: { shape: "perOwner", max: 200, ownerField: "ownerId" },
  cobuildTasks: { shape: "userMap", max: 400 },
  cobuildAnnotations: { shape: "userMap", max: 400 },
  codeQuality: {
    scans: { shape: "userArray", max: 100, keep: "tail" },
    issues: { shape: "userMap", max: 1000 },
  },
  crisisPlaybookProgress: { shape: "playbook", maxCrises: 200, maxSteps: 64 },
  crisisTeams: { shape: "idArray", max: 100, keep: "tail", mapMax: 2000 },
  crisisTimelines: { shape: "idArray", max: 400, keep: "tail", mapMax: 2000 },
  crisisAlertAcks: { shape: "userSet", max: 500 },
  crisisResources: { shape: "userMap", max: 400 },
  dreamTags: { shape: "userMap", max: 400 },
  dreamInterpretations: { shape: "userMap", max: 200 },
  ghostHunts: { shape: "userMap", max: 400 },
  ghostHistory: { shape: "userArray", max: 200, keep: "head" },
  globalSavedViews: { shape: "userArray", max: 100, keep: "head" },
  inheritanceEstates: {
    beneficiaries: { max: 100, keep: "tail" },
    assets: { max: 400, keep: "tail" },
    wills: { max: 50, keep: "tail" },
    executors: { max: 20, keep: "tail" },
    locks: { max: 100, keep: "tail" },
  },
  inheritanceNotices: { shape: "userArray", max: 100, keep: "head" },
  federation: {
    access: { shape: "userMap", max: 500 },
    moderation: { shape: "userArray", max: 500, keep: "head" },
    syncPolicy: { shape: "userMap", max: 500 },
    relays: { shape: "userArray", max: 100, keep: "tail" },
    trustHistory: { shape: "trust", maxDomains: 500, maxPoints: 200 },
    metrics: { shape: "userArray", max: 500, keep: "tail" },
  },
});

const SECRET_SCRUB_KEYS = new Set(Object.keys(SNAPSHOT_STORE_CAPS));

function takeArray(arr, max, keep) {
  if (!Array.isArray(arr) || arr.length <= max) return arr;
  return keep === "head" ? arr.slice(0, max) : arr.slice(-max);
}

function takeMapEntries(map, max) {
  if (!(map instanceof Map) || map.size <= max) return map;
  return new Map([...map.entries()].slice(-max));
}

function takeSet(set, max) {
  if (!(set instanceof Set) || set.size <= max) return set;
  return new Set([...set].slice(-max));
}

function capUserArrays(map, max, keep) {
  if (!(map instanceof Map)) return map;
  let changed = false;
  const out = new Map();
  for (const [k, v] of map) {
    const next = takeArray(v, max, keep);
    if (next !== v) changed = true;
    out.set(k, next);
  }
  return changed ? out : map;
}

function capUserMaps(map, max) {
  if (!(map instanceof Map)) return map;
  let changed = false;
  const out = new Map();
  for (const [k, v] of map) {
    const next = takeMapEntries(v, max);
    if (next !== v) changed = true;
    out.set(k, next);
  }
  return changed ? out : map;
}

function capUserSets(map, max) {
  if (!(map instanceof Map)) return map;
  let changed = false;
  const out = new Map();
  for (const [k, v] of map) {
    const next = takeSet(v, max);
    if (next !== v) changed = true;
    out.set(k, next);
  }
  return changed ? out : map;
}

function capIdArrays(map, max, keep, mapMax) {
  if (!(map instanceof Map)) return map;
  let base = map;
  let changed = false;
  if (mapMax && map.size > mapMax) {
    base = new Map([...map.entries()].slice(-mapMax));
    changed = true;
  }
  const arrays = capUserArrays(base, max, keep);
  if (arrays !== base) return arrays;
  return changed ? base : map;
}

function capPerOwner(map, max, ownerField) {
  if (!(map instanceof Map)) return map;
  const groups = new Map();
  for (const entry of map) {
    const rec = entry[1];
    const owner = rec && typeof rec === "object" ? String(rec[ownerField] ?? "") : "";
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(entry);
  }
  let changed = false;
  for (const entries of groups.values()) {
    if (entries.length > max) changed = true;
  }
  if (!changed) return map;
  const out = new Map();
  for (const entries of groups.values()) {
    const kept = entries.length > max ? entries.slice(-max) : entries;
    for (const [k, v] of kept) out.set(k, v);
  }
  return out;
}

function capScanRules(map, max) {
  if (!(map instanceof Map)) return map;
  let changed = false;
  const out = new Map();
  for (const [uid, cfg] of map) {
    if (cfg && Array.isArray(cfg.rules) && cfg.rules.length > max) {
      out.set(uid, { ...cfg, rules: cfg.rules.slice(0, max) });
      changed = true;
    } else {
      out.set(uid, cfg);
    }
  }
  return changed ? out : map;
}

function capPlaybook(map, maxCrises, maxSteps) {
  if (!(map instanceof Map)) return map;
  let changed = false;
  const out = new Map();
  for (const [uid, crises] of map) {
    if (!(crises instanceof Map)) {
      out.set(uid, crises);
      continue;
    }
    let c = crises;
    if (crises.size > maxCrises) {
      c = takeMapEntries(crises, maxCrises);
      changed = true;
    }
    const inner = new Map();
    let innerChanged = false;
    for (const [cid, steps] of c) {
      const next = takeSet(steps, maxSteps);
      if (next !== steps) innerChanged = true;
      inner.set(cid, next);
    }
    if (innerChanged) {
      changed = true;
      out.set(uid, inner);
    } else {
      out.set(uid, c);
    }
  }
  return changed ? out : map;
}

function capTrust(map, maxDomains, maxPoints) {
  if (!(map instanceof Map)) return map;
  let changed = false;
  const out = new Map();
  for (const [uid, domains] of map) {
    if (!(domains instanceof Map)) {
      out.set(uid, domains);
      continue;
    }
    let d = domains;
    if (domains.size > maxDomains) {
      d = takeMapEntries(domains, maxDomains);
      changed = true;
    }
    const inner = new Map();
    let innerChanged = false;
    for (const [dom, series] of d) {
      const next = takeArray(series, maxPoints, "tail");
      if (next !== series) innerChanged = true;
      inner.set(dom, next);
    }
    if (innerChanged) {
      changed = true;
      out.set(uid, inner);
    } else {
      out.set(uid, d);
    }
  }
  return changed ? out : map;
}

function capEstateMap(map, fields) {
  if (!(map instanceof Map)) return map;
  let changed = false;
  const out = new Map();
  for (const [uid, estate] of map) {
    if (!estate || typeof estate !== "object" || Array.isArray(estate)) {
      out.set(uid, estate);
      continue;
    }
    let next = estate;
    for (const [field, spec] of Object.entries(fields)) {
      const capped = takeArray(estate[field], spec.max, spec.keep || "tail");
      if (capped !== estate[field]) {
        if (next === estate) next = { ...estate };
        next[field] = capped;
        changed = true;
      }
    }
    out.set(uid, next);
  }
  return changed ? out : map;
}

function applyFieldCap(value, spec) {
  if (!spec || spec.max == null && spec.shape == null && spec.beneficiaries == null) return value;
  if (spec.beneficiaries) return capEstateMap(value, spec);
  switch (spec.shape) {
    case "userArray": return capUserArrays(value, spec.max, spec.keep || "tail");
    case "userMap": return capUserMaps(value, spec.max);
    case "userSet": return capUserSets(value, spec.max);
    case "idArray": return capIdArrays(value, spec.max, spec.keep || "tail", spec.mapMax);
    case "perOwner": return capPerOwner(value, spec.max, spec.ownerField);
    case "rules": return capScanRules(value, spec.max);
    case "playbook": return capPlaybook(value, spec.maxCrises, spec.maxSteps);
    case "trust": return capTrust(value, spec.maxDomains, spec.maxPoints);
    default: return value;
  }
}

function capBag(value, spec) {
  if (!spec) return value;
  // A root Map/Set, or an estate map whose cap spec lists the inner arrays.
  if (spec.shape || spec.beneficiaries) return applyFieldCap(value, spec);
  if (!value || typeof value !== "object" || value instanceof Map || value instanceof Set || Array.isArray(value)) {
    return value;
  }
  let changed = false;
  const out = { ...value };
  for (const [field, fieldSpec] of Object.entries(spec)) {
    if (!fieldSpec || typeof fieldSpec !== "object") continue;
    if (fieldSpec.max == null && !fieldSpec.shape && !fieldSpec.beneficiaries && fieldSpec.maxCrises == null && fieldSpec.maxDomains == null) {
      continue;
    }
    const next = applyFieldCap(value[field], fieldSpec);
    if (next !== value[field]) {
      out[field] = next;
      changed = true;
    }
  }
  return changed ? out : value;
}

// Copy-on-cap. Federation always drops actorKeys from the copy the
// serializer walks; the live bag is left alone so in-process verification
// still works until the next boot.
function preparePersistedState(key, value) {
  if (key === "federation" && value && typeof value === "object" && !(value instanceof Map) && !Array.isArray(value)) {
    const copy = { ...value };
    delete copy.actorKeys;
    return capBag(copy, SNAPSHOT_STORE_CAPS.federation);
  }
  const spec = SNAPSHOT_STORE_CAPS[key];
  if (!spec) return value;
  return capBag(value, spec);
}

function stripSecretFields(v, seen = new WeakSet()) {
  if (!v || typeof v !== "object") return;
  if (seen.has(v)) return;
  seen.add(v);
  if (v instanceof Map) {
    for (const key of [...v.keys()]) {
      if (typeof key === "string" && SNAPSHOT_SECRET_FIELDS.has(key)) v.delete(key);
    }
    for (const child of v.values()) stripSecretFields(child, seen);
    return;
  }
  if (v instanceof Set) {
    for (const child of v) stripSecretFields(child, seen);
    return;
  }
  if (Array.isArray(v)) {
    for (const child of v) stripSecretFields(child, seen);
    return;
  }
  if (!isPlainObject(v)) return;
  for (const key of Object.keys(v)) {
    if (SNAPSHOT_SECRET_FIELDS.has(key)) delete v[key];
    else stripSecretFields(v[key], seen);
  }
}

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
function serializeValue(v, seen = new WeakSet(), scrub = false) {
  if (v instanceof Map) {
    if (seen.has(v)) return { __type: "Map", entries: [] };
    seen.add(v);
    const entries = Array.from(v.entries()).map(([k, vv]) => [k, serializeValue(vv, seen, scrub)]);
    seen.delete(v);
    return { __type: "Map", entries };
  }
  if (v instanceof Set) {
    if (seen.has(v)) return { __type: "Set", values: [] };
    seen.add(v);
    const values = Array.from(v).map((item) => serializeValue(item, seen, scrub));
    seen.delete(v);
    return { __type: "Set", values };
  }
  if (Array.isArray(v)) {
    if (seen.has(v)) return [];
    seen.add(v);
    const out = v.map((item) => serializeValue(item, seen, scrub));
    seen.delete(v);
    return out;
  }
  if (isPlainObject(v)) {
    if (seen.has(v)) return {};
    seen.add(v);
    const out = {};
    for (const [k, vv] of Object.entries(v)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (scrub && SNAPSHOT_SECRET_FIELDS.has(k)) continue;
      out[k] = serializeValue(vv, seen, scrub);
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

// Walk every registered lens key on STATE, serialize nested Map/Set into
// JSON-safe envelopes. Returns a plain object suitable for JSON.stringify.
export function serializeLensState(STATE) {
  if (!STATE || typeof STATE !== "object") return {};
  const out = {};
  for (const key of LENS_STATE_KEYS) {
    const lens = STATE[key];
    if (lens == null) continue;
    const prepared = preparePersistedState(key, lens);
    const scrub = SECRET_SCRUB_KEYS.has(key);
    // A top-level Map/Set has no enumerable fields. Object.entries(map)
    // is [] and JSON.stringify(map) is "{}", which is how these stores
    // used to vanish. Persist the collection itself.
    if (prepared instanceof Map || prepared instanceof Set) {
      out[key] = serializeValue(prepared, new WeakSet(), scrub);
      continue;
    }
    // Sequence counters (_profileVisitorSeq, _companionNotifSeq) are numbers.
    if (typeof prepared !== "object") {
      out[key] = prepared;
      continue;
    }
    const lensOut = {};
    for (const [field, val] of Object.entries(prepared)) {
      if (scrub && SNAPSHOT_SECRET_FIELDS.has(field)) continue;
      lensOut[field] = serializeValue(val, new WeakSet(), scrub);
    }
    out[key] = lensOut;
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
    } else {
      const lensOut = {};
      for (const [field, val] of Object.entries(lensPersisted)) {
        if (SECRET_SCRUB_KEYS.has(key) && SNAPSHOT_SECRET_FIELDS.has(field)) continue;
        lensOut[field] = deserializeValue(val);
      }
      STATE[key] = lensOut;
    }
    if (SECRET_SCRUB_KEYS.has(key)) stripSecretFields(STATE[key]);
  }
}
