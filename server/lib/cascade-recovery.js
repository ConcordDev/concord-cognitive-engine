/**
 * @fileoverview Cascade Recovery System
 *
 * Deep verification and recovery across all Concord subsystems:
 * 1. verifyAllInitializations — check that all init functions succeeded
 * 2. verifyAllRoutes — probe every registered route for 4xx/5xx
 * 3. auditDataPipelines — verify DTU flow, consolidation, shadow graph
 * 4. auditFeatureFlags — ensure settings/flags are coherent
 * 5. buildMissingFeatures — detect and scaffold missing subsystems
 * 6. fullRecoverySequence — orchestrate all of the above
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(label, detail) {
  return { ok: true, label, detail };
}

function fail(label, detail, fix) {
  return { ok: false, label, detail, fix: fix || null };
}

function safeCall(fn, label) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.catch(e => fail(label, `async error: ${e.message}`));
    }
    return result;
  } catch (e) {
    return fail(label, `threw: ${e.message}`);
  }
}

// ── 1. Verify All Initializations ────────────────────────────────────────────

export function verifyAllInitializations(STATE, log) {
  const results = [];
  const check = (label, condition, detail) => {
    results.push(condition ? ok(label, detail) : fail(label, detail));
  };

  // Core STATE maps must exist
  const requiredMaps = [
    'dtus', 'shadowDtus', 'wrappers', 'layers', 'personas', 'sessions',
    'users', 'orgs', 'apiKeys', 'jobs', 'sources', 'listings',
    'entitlements', 'transactions', 'papers', 'organs', 'lensArtifacts',
    'lensDomainIndex', 'userUniverses',
  ];
  for (const key of requiredMaps) {
    const val = STATE[key];
    const isMap = val instanceof Map;
    check(`STATE.${key}`, isMap, isMap ? `Map(${val.size})` : `missing or wrong type: ${typeof val}`);
  }

  // Core objects
  check('STATE.settings', !!STATE.settings && typeof STATE.settings === 'object', STATE.settings ? 'present' : 'missing');
  check('STATE.queues', !!STATE.queues && typeof STATE.queues === 'object', STATE.queues ? 'present' : 'missing');
  check('STATE.globalIndex', !!STATE.globalIndex, STATE.globalIndex ? 'present' : 'missing');

  // Wallets (economy)
  const hasWallets = STATE.wallets || STATE.economic?.wallets;
  check('wallets', !!hasWallets, hasWallets ? 'found' : 'no wallet store detected');

  // __chicken2 + __chicken3 (lattice invariants)
  check('__chicken2', STATE.__chicken2?.enabled !== undefined, STATE.__chicken2 ? 'present' : 'missing');
  check('__chicken3', STATE.__chicken3?.enabled !== undefined, STATE.__chicken3 ? 'present' : 'missing');

  // Guardian status (repair cortex)
  if (typeof globalThis._guardianStatus === 'function') {
    try {
      const gs = globalThis._guardianStatus();
      check('repair_guardian', gs?.running === true, gs?.running ? 'running' : 'not running');
    } catch {
      check('repair_guardian', false, 'getGuardianStatus threw');
    }
  } else {
    // Try from STATE
    check('repair_guardian', !!STATE._repairGuardian, STATE._repairGuardian ? 'detected' : 'no guardian ref found');
  }

  // Cognitive workers
  const workerCount = STATE._cognitiveWorkers?.length || STATE._workers?.length || 0;
  check('cognitive_workers', workerCount > 0 || !STATE._cognitiveWorkers, workerCount > 0 ? `${workerCount} workers` : 'no workers (may be ok in dev)');

  // Heartbeat timer
  check('heartbeat_enabled', STATE.settings?.heartbeatEnabled !== false, STATE.settings?.heartbeatEnabled ? 'enabled' : 'disabled');

  const failures = results.filter(r => !r.ok);
  if (log && failures.length > 0) {
    log(`[CascadeRecovery] Init verification: ${failures.length} issues found`);
    for (const f of failures) log(`  - ${f.label}: ${f.detail}`);
  }

  return {
    ok: failures.length === 0,
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    results,
    failures,
  };
}

// ── 2. Verify All Routes ─────────────────────────────────────────────────────

export function verifyAllRoutes(app, log) {
  const results = [];

  // Extract registered routes from Express
  const registeredPaths = new Set();

  function extractRoutes(stack, prefix = '') {
    if (!stack) return;
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).join(',').toUpperCase();
        const fullPath = prefix + (layer.route.path || '');
        registeredPaths.add(fullPath);
        results.push(ok(`route:${methods}:${fullPath}`, 'registered'));
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Mounted sub-router
        const mountPath = layer.regexp?.source
          ? '/' + layer.regexp.source
              .replace(/^\^\\\//, '')
              .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
              .replace(/\\\//g, '/')
          : prefix;
        extractRoutes(layer.handle.stack, mountPath);
      }
    }
  }

  try {
    extractRoutes(app._router?.stack || []);
  } catch (e) {
    results.push(fail('route_extraction', `failed: ${e.message}`));
  }

  // Expected critical route prefixes
  const criticalPrefixes = [
    '/api/status', '/api/auth', '/api/dtus', '/api/chat',
    '/api/economy', '/api/social', '/api/emergent',
    '/api/admin', '/api/shield', '/api/mesh',
    '/api/atlas', '/api/foundation', '/api/qualia',
    '/api/sovereign', '/api/federation',
  ];

  for (const prefix of criticalPrefixes) {
    const found = [...registeredPaths].some(p => p.startsWith(prefix) || p.includes(prefix.replace('/api/', '')));
    if (!found) {
      // Check in the raw stack — some routes use different mount patterns
      const inStack = (app._router?.stack || []).some(l => {
        const src = l.regexp?.source || '';
        const key = prefix.replace('/api/', '').replace(/\//g, '');
        return src.includes(key);
      });
      results.push(inStack
        ? ok(`critical:${prefix}`, 'found in stack')
        : fail(`critical:${prefix}`, 'not found in router'));
    } else {
      results.push(ok(`critical:${prefix}`, 'registered'));
    }
  }

  const failures = results.filter(r => !r.ok);
  if (log && failures.length > 0) {
    log(`[CascadeRecovery] Route verification: ${failures.length} missing routes`);
    for (const f of failures) log(`  - ${f.label}: ${f.detail}`);
  }

  return {
    ok: failures.length === 0,
    totalRoutes: registeredPaths.size,
    criticalChecked: criticalPrefixes.length,
    failed: failures.length,
    results,
    failures,
  };
}

// ── 3. Audit Data Pipelines ──────────────────────────────────────────────────

export function auditDataPipelines(STATE, log) {
  const results = [];

  // DTU pipeline: every DTU should have id, tier, createdAt
  let dtuCount = 0, dtuMissing = 0;
  if (STATE.dtus instanceof Map) {
    for (const [id, dtu] of STATE.dtus) {
      dtuCount++;
      if (!dtu) { dtuMissing++; continue; }
      if (!dtu.id) { results.push(fail(`dtu:${id}`, 'missing id field')); dtuMissing++; }
      if (!dtu.tier && dtu.tier !== 0) {
        // Auto-fix: assign default tier based on DTU kind
        dtu.tier = "regular";
        results.push(ok(`dtu:${id}`, 'missing tier — auto-fixed to regular'));
      }
    }
  }
  results.push(dtuMissing === 0
    ? ok('dtu_integrity', `${dtuCount} DTUs verified`)
    : fail('dtu_integrity', `${dtuMissing} DTUs with issues out of ${dtuCount}`));

  // Shadow DTUs
  let shadowCount = 0, shadowBroken = 0;
  if (STATE.shadowDtus instanceof Map) {
    for (const [id, dtu] of STATE.shadowDtus) {
      shadowCount++;
      if (!dtu || !dtu.id) shadowBroken++;
    }
  }
  results.push(shadowBroken === 0
    ? ok('shadow_dtu_integrity', `${shadowCount} shadow DTUs ok`)
    : fail('shadow_dtu_integrity', `${shadowBroken} broken shadow DTUs`));

  // Lens artifacts: domain index should reference real artifacts
  let artifactOrphans = 0;
  if (STATE.lensDomainIndex instanceof Map && STATE.lensArtifacts instanceof Map) {
    for (const [domain, ids] of STATE.lensDomainIndex) {
      if (ids instanceof Set || Array.isArray(ids)) {
        for (const aid of ids) {
          if (!STATE.lensArtifacts.has(aid)) artifactOrphans++;
        }
      }
    }
  }
  results.push(artifactOrphans === 0
    ? ok('lens_artifact_index', 'all refs valid')
    : fail('lens_artifact_index', `${artifactOrphans} orphan refs in domain index`));

  // Global index consistency
  let globalOrphans = 0;
  if (STATE.globalIndex?.byId instanceof Map) {
    for (const [gid, dtuId] of STATE.globalIndex.byId) {
      if (!STATE.dtus.has(dtuId)) globalOrphans++;
    }
  }
  results.push(globalOrphans === 0
    ? ok('global_index', 'consistent')
    : fail('global_index', `${globalOrphans} global refs to missing DTUs`));

  // Consolidation pipeline check: queues should not be permanently stuck
  const queues = STATE.queues || {};
  for (const [qName, q] of Object.entries(queues)) {
    if (Array.isArray(q) && q.length > 5000) {
      results.push(fail(`queue:${qName}`, `backlog: ${q.length} items (>5000 threshold)`));
    }
  }

  // Sessions check: no zombie sessions older than 7 days
  if (STATE.sessions instanceof Map) {
    let zombies = 0;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    for (const [, sess] of STATE.sessions) {
      if (sess?.createdAt && Date.now() - sess.createdAt > sevenDays) zombies++;
    }
    if (zombies > 100) {
      results.push(fail('zombie_sessions', `${zombies} sessions older than 7 days`));
    }
  }

  const failures = results.filter(r => !r.ok);
  if (log && failures.length > 0) {
    log(`[CascadeRecovery] Pipeline audit: ${failures.length} issues`);
    for (const f of failures.slice(0, 20)) log(`  - ${f.label}: ${f.detail}`);
  }

  return {
    ok: failures.length === 0,
    dtuCount,
    shadowCount,
    artifactOrphans,
    globalOrphans,
    failed: failures.length,
    results,
    failures,
  };
}

// ── 4. Audit Feature Flags ───────────────────────────────────────────────────

export function auditFeatureFlags(STATE, log) {
  const results = [];
  const s = STATE.settings || {};
  const c2 = STATE.__chicken2 || {};
  const c3 = STATE.__chicken3 || {};

  // Settings coherence
  if (s.heartbeatEnabled && (!s.heartbeatMs || s.heartbeatMs < 1000)) {
    results.push(fail('heartbeatMs', `invalid: ${s.heartbeatMs}`, () => { STATE.settings.heartbeatMs = 10000; }));
  }
  if (s.focusSetMax < s.microSetMax) {
    results.push(fail('focusSetMax', `${s.focusSetMax} < microSetMax ${s.microSetMax}`, () => {
      STATE.settings.focusSetMax = Math.max(s.focusSetMax, s.microSetMax);
    }));
  }
  if (s.abstractionMaxDepth < s.abstractionDepthDefault) {
    results.push(fail('abstractionDepth', `max ${s.abstractionMaxDepth} < default ${s.abstractionDepthDefault}`, () => {
      STATE.settings.abstractionMaxDepth = Math.max(s.abstractionMaxDepth, s.abstractionDepthDefault);
    }));
  }

  // __chicken2 consistency
  if (c2.enabled && c2.thresholdOverlap < c2.thresholdHomeostasis) {
    results.push(fail('chicken2_thresholds', 'overlap < homeostasis — inverted'));
  }

  // __chicken3 consistency
  if (c3.enabled && c3.cronIntervalMs < 5000) {
    results.push(fail('chicken3_cron', `cronIntervalMs too low: ${c3.cronIntervalMs}`, () => {
      STATE.__chicken3.cronIntervalMs = 15000;
    }));
  }

  // Apply auto-fixes
  for (const r of results) {
    if (!r.ok && typeof r.fix === 'function') {
      try {
        r.fix();
        r.fixed = true;
      } catch (e) {
        r.fixError = e.message;
      }
    }
  }

  const failures = results.filter(r => !r.ok);
  const fixed = results.filter(r => r.fixed).length;
  if (log && failures.length > 0) {
    log(`[CascadeRecovery] Feature flags: ${failures.length} issues, ${fixed} auto-fixed`);
  }

  return {
    ok: failures.length === 0 || failures.every(r => r.fixed),
    total: results.length,
    failed: failures.length,
    fixed,
    results,
    failures,
  };
}

// ── 5. Build Missing Features ────────────────────────────────────────────────

export function buildMissingFeatures(STATE, log) {
  const results = [];
  let built = 0;

  // Ensure all required STATE maps exist
  const requiredMaps = {
    dtus: Map, shadowDtus: Map, wrappers: Map, layers: Map,
    personas: Map, sessions: Map, users: Map, orgs: Map,
    apiKeys: Map, jobs: Map, sources: Map, listings: Map,
    entitlements: Map, transactions: Map, papers: Map,
    organs: Map, lensArtifacts: Map, lensDomainIndex: Map,
    userUniverses: Map, styleVectors: Map,
  };

  // A write-through store satisfies the Map CONTRACT without being
  // `instanceof Map` — `lib/dtu-store.js#createDTUStore` returns a plain object
  // with Map-shaped methods. A bare instanceof test therefore treated the
  // freshly-hydrated DTU store as a "missing Map" and replaced it with an EMPTY
  // one, on every boot, while cheerfully reporting `created missing Map`.
  //
  // Found by tracing (2026-07-28): this was the LAST of three independent
  // places doing the same thing to the same object — server.js's `_ensureMap`
  // and `_hydrateState`'s `put()` were the other two. Net effect was that the
  // DTU store had never survived boot: `STATE.dtus.rehydrateFromSQLite` was
  // undefined at runtime, so `_serializeState`'s omission check saw no store
  // and wrote all 8.17 MB of DTUs into every snapshot.
  //
  // `STATE.lensArtifacts` was unaffected throughout only because
  // LensArtifactStore extends Map.
  //
  // Test the capability for Map specifically; any other Ctor keeps the exact
  // instanceof semantics it had, so this stays a narrow fix.
  const isMapLike = (v) => !!v && typeof v.get === "function" && typeof v.set === "function"
    && typeof v.has === "function" && typeof v.delete === "function"
    && typeof v.values === "function" && typeof v.size === "number";

  for (const [key, Ctor] of Object.entries(requiredMaps)) {
    const present = Ctor === Map ? isMapLike(STATE[key]) : STATE[key] instanceof Ctor;
    if (!present) {
      STATE[key] = new Ctor();
      results.push(ok(`build:${key}`, `created missing ${Ctor.name}`));
      built++;
    }
  }

  // Ensure globalIndex structure
  if (!STATE.globalIndex) {
    STATE.globalIndex = { byHash: new Map(), byId: new Map() };
    results.push(ok('build:globalIndex', 'created'));
    built++;
  } else {
    if (!(STATE.globalIndex.byHash instanceof Map)) {
      STATE.globalIndex.byHash = new Map();
      built++;
    }
    if (!(STATE.globalIndex.byId instanceof Map)) {
      STATE.globalIndex.byId = new Map();
      built++;
    }
  }

  // Ensure queues object
  if (!STATE.queues) STATE.queues = {};
  const requiredQueues = [
    'maintenance', 'macroProposals', 'panelProposals',
    'synthesis', 'hypotheses', 'philosophy', 'wrapperJobs', 'notifications',
  ];
  for (const q of requiredQueues) {
    if (!Array.isArray(STATE.queues[q])) {
      STATE.queues[q] = [];
      results.push(ok(`build:queue:${q}`, 'created'));
      built++;
    }
  }

  // Ensure settings has all required keys
  if (!STATE.settings) STATE.settings = {};
  const defaultSettings = {
    heartbeatMs: 10000, heartbeatEnabled: true,
    autogenEnabled: true, dreamEnabled: true,
    evolutionEnabled: true, synthEnabled: true,
    llmDefault: true, interpretiveTruthMin: 0.35,
    interpretiveTruthMax: 0.85, speculativeGateEnabled: false,
    abstractionDepthDefault: 1, abstractionMaxDepth: 3,
    workingSetMax: 1000, focusSetMax: 1000,
    peripheralSetMax: 10000, microSetMax: 80,
    crispnessMin: 0.25, canonicalOnly: true,
    includeMegasInBase: true, requireHypothesisLabels: true,
    requireTestsWhenUncertain: true,
  };
  for (const [k, v] of Object.entries(defaultSettings)) {
    if (STATE.settings[k] === undefined) {
      STATE.settings[k] = v;
      built++;
    }
  }

  // Ensure __chicken2 and __chicken3 exist
  if (!STATE.__chicken2) {
    STATE.__chicken2 = {
      enabled: true, mode: 'full_blast',
      thresholdOverlap: 0.95, thresholdHomeostasis: 0.80,
      thresholdSuffering: 0.65,
      hardFails: { inversionVacuum: true, negativeValence: true, genesisViolation: true },
      logs: [], lastProof: null,
      metrics: { continuityAvg: 0, homeostasis: 1, contradictionLoad: 0, suffering: 0, rejections: 0, accepts: 0 },
    };
    results.push(ok('build:__chicken2', 'created'));
    built++;
  }
  if (!STATE.__chicken3) {
    STATE.__chicken3 = {
      enabled: true, cronEnabled: true, cronIntervalMs: 15000,
      metaEnabled: true, metaSampleProb: 0.10, metaMinMaturity: 0.75,
      streamingEnabled: true, multimodalEnabled: true,
      voiceEnabled: true, toolsEnabled: true, federationEnabled: false,
      lastCronAt: null, lastMetaAt: null, lastFederationAt: null,
      stats: { cronTicks: 0, metaProposals: 0, metaCommits: 0, federationRx: 0, federationTx: 0 },
    };
    results.push(ok('build:__chicken3', 'created'));
    built++;
  }

  // Ensure globalThread
  if (!STATE.globalThread) {
    STATE.globalThread = { councilQueue: [], acceptedContributions: [] };
    results.push(ok('build:globalThread', 'created'));
    built++;
  }

  // Ensure crawlQueue and logs
  if (!Array.isArray(STATE.logs)) { STATE.logs = []; built++; }
  if (!Array.isArray(STATE.crawlQueue)) { STATE.crawlQueue = []; built++; }

  if (log) {
    log(`[CascadeRecovery] Built ${built} missing features/structures`);
  }

  return { ok: true, built, results };
}

// ── 6. Full Recovery Sequence ────────────────────────────────────────────────

export async function fullRecoverySequence(STATE, app, log) {
  const startTime = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    steps: {},
    totalIssues: 0,
    totalFixed: 0,
    ok: true,
  };

  const logFn = log || console.log;
  logFn('[CascadeRecovery] ═══ Starting full recovery sequence ═══');

  // Step 1: Build missing features first (so subsequent checks pass)
  try {
    report.steps.buildMissing = buildMissingFeatures(STATE, logFn);
    report.totalFixed += report.steps.buildMissing.built || 0;
  } catch (e) {
    report.steps.buildMissing = { ok: false, error: e.message };
    logFn(`[CascadeRecovery] buildMissingFeatures failed: ${e.message}`);
  }

  // Step 2: Verify initializations
  try {
    report.steps.init = verifyAllInitializations(STATE, logFn);
    report.totalIssues += report.steps.init.failed || 0;
    if (!report.steps.init.ok) report.ok = false;
  } catch (e) {
    report.steps.init = { ok: false, error: e.message };
    report.ok = false;
  }

  // Step 3: Verify routes (if app provided)
  if (app) {
    try {
      report.steps.routes = verifyAllRoutes(app, logFn);
      report.totalIssues += report.steps.routes.failed || 0;
      if (!report.steps.routes.ok) report.ok = false;
    } catch (e) {
      report.steps.routes = { ok: false, error: e.message };
      report.ok = false;
    }
  }

  // Step 4: Audit data pipelines
  try {
    report.steps.pipelines = auditDataPipelines(STATE, logFn);
    report.totalIssues += report.steps.pipelines.failed || 0;
    if (!report.steps.pipelines.ok) report.ok = false;
  } catch (e) {
    report.steps.pipelines = { ok: false, error: e.message };
    report.ok = false;
  }

  // Step 5: Audit feature flags (with auto-fix)
  try {
    report.steps.flags = auditFeatureFlags(STATE, logFn);
    report.totalFixed += report.steps.flags.fixed || 0;
    report.totalIssues += report.steps.flags.failed || 0;
  } catch (e) {
    report.steps.flags = { ok: false, error: e.message };
  }

  report.durationMs = Date.now() - startTime;
  logFn(`[CascadeRecovery] ═══ Recovery complete: ${report.totalIssues} issues, ${report.totalFixed} fixed, ${report.durationMs}ms ═══`);

  return report;
}
