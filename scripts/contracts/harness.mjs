// scripts/contracts/harness.mjs
//
// Shared boot + enumeration + input-synthesis + skip-rules for the Orchestrated
// Invariant Engine. This deliberately REPLICATES the boot sequence, skip
// heuristics, and input synthesis of
// server/tests/behavior/lens-behavior-smoke.behavior.js so the engine drives
// the exact same surface the smoke harness already pins — no divergence in
// which macros are considered headless-safe.
//
// The smoke harness lives under tests/ and is a node:test file (top-level
// describe/it); importing it would register its tests. So we lift its proven
// pieces here instead, keeping them in lockstep by copying the same regexes and
// fixture map.

// ── Boot env (matches crud-invariants.mjs / smoke harness expectations) ──────
process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "invariant-engine-fixed-secret-key-32plus-characters-2026";

let _boot = null;

/**
 * Boot the app in-process and return the live test surface.
 * Reuses the smoke harness's exact mechanism: import server.js (which runs every
 * register()/registerLensAction() call), then read __TEST__ for runMacro +
 * makeInternalCtx + MACROS, and globalThis.__CARTOGRAPHER__ for the registry.
 * @returns {Promise<{ runMacro:Function, makeInternalCtx:Function, MACROS:Map, cartographer:object }>}
 */
export async function bootEngine() {
  if (_boot) return _boot;
  const mod = await import(new URL("../../server/server.js", import.meta.url).href);
  const T = mod.__TEST__ || mod.default?.__TEST__;
  if (!T) throw new Error("server.js did not export __TEST__");
  const { MACROS, runMacro, makeInternalCtx } = T;
  if (!(MACROS instanceof Map)) throw new Error("__TEST__.MACROS must be a Map");
  if (typeof runMacro !== "function") throw new Error("__TEST__.runMacro must be a function");
  if (typeof makeInternalCtx !== "function") throw new Error("__TEST__.makeInternalCtx must be a function");
  const cartographer = globalThis.__CARTOGRAPHER__ || { MACROS };
  _boot = { runMacro, makeInternalCtx, MACROS, cartographer };
  return _boot;
}

// ── Skip heuristics (verbatim from lens-behavior-smoke.behavior.js) ──────────

const _llmEnabled =
  String(process.env.CONCORD_BEHAVIOR_TEST_LLM || "").toLowerCase() === "true";

export const LLM_HINT_RE =
  /^(respond|chat|reply|deliberate|narrate|synthesize|generate|brainstorm|propose|critique|reason|explain|elaborate|expand|rewrite|translate|tutor|teach|answer|ask|dream|imagine|score|evaluate|grade|review|writeReply|composeMessage|debate|persuade|argue)$|llm|brain/i;

const _skipDestructive =
  String(process.env.CONCORD_BEHAVIOR_SKIP_DESTRUCTIVE || "").toLowerCase() === "true";
export const DESTRUCTIVE_HINT_RE =
  /^(delete|destroy|reset|wipe|clear|purge|drop|kill|terminate|revoke|unpublish)$|^(forceDelete|hardDelete|nuke)/i;

// External-IO macros make a real outbound HTTP call to a third-party API
// (NASA/MET/GBIF/PubMed/FRED/crypto/dictionary/… — every `live_*` macro lives
// in a *-live.js / free-api-live.js domain file). They are NOT headless-safe to
// fuzz: the network call (a) times out non-deterministically under load, so a
// V2 vector produces a flaky `fuzz_timeout` that is timing — not a code defect —
// and (b) it would hammer a third party with adversarial payloads (NaN/1e308/
// <script>). Like LLM-hint + destructive macros, they get a STATIC contract only,
// never an adversarial drive. (The lone internal `live_*` — cognition.live_understanding,
// a pure state read with no numeric input — is harmless to skip too.)
export const EXTERNAL_IO_HINT_RE = /^live_/i;

export const SKIP_DOMAINS_DEFAULT = new Set(["oracle", "concordance"]);

// Heavy whole-system introspection macros — not headless-safe to FUZZ for the
// same timing reason as external_io: they read/parse/serialize a large generated
// artifact (audit/cartograph/SYSTEMS.json) or walk the whole source tree, ignore
// their numeric input entirely, and so a V2 adversarial-fuzz vector tests nothing
// meaningful while flakily exceeding the 8s MACRO_TIMEOUT_MS as the repo grows
// (a timing artifact, NOT a code defect). They get a STATIC contract only, never
// an adversarial drive — identical justification to the `live_*` external-IO skip.
export const HEAVY_FUZZ_SKIP_IDS = new Set([
  "system.cartograph",
]);

// Per-(domain,name) fixture overrides — copied from the smoke harness so the
// few macros that need a non-empty body don't trivially fail.
export const FIXTURES = {
  "ocean.waveAnalysis": { artifact: { data: { waveHeightMeters: 2, wavePeriodSeconds: 8, windSpeedKnots: 12 } } },
  "ocean.tidalPrediction": { artifact: { data: { location: "test-bay", tidalRangeMeters: 1.8 } } },
  "ocean.salinityProfile": { artifact: { data: { readings: [{ depth: 0, salinity: 34, temperature: 18 }, { depth: 50, salinity: 35, temperature: 14 }] } } },
  "ocean.marineEcosystem": { artifact: { data: { species: [{ trophicLevel: "primary" }, { trophicLevel: "secondary", threatened: true }] } } },
  "poetry.meterAnalysis": { artifact: { data: { text: "Shall I compare thee to a summer's day\nThou art more lovely and more temperate" } } },
  "poetry.rhymeScheme": { artifact: { data: { text: "Roses are red\nViolets are blue\nSugar is sweet\nAnd so are you" } } },
  "poetry.formGuide": { artifact: { data: { form: "haiku" } } },
  "poetry.wordFrequency": { artifact: { data: { text: "the quick brown fox jumps over the lazy dog" } } },
  "robotics.kinematicsCalc": { artifact: { data: { joints: [{ type: "revolute", angle: 45, length: 200 }] } } },
  "robotics.pathPlan": { artifact: { data: { waypoints: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 50, z: 10 }] } } },
  "robotics.sensorFusion": { artifact: { data: { sensors: [{ name: "imu", value: 1.2, confidence: 0.9 }] } } },
  "robotics.batteryLife": { artifact: { data: { batteryCapacityWh: 100, motorDrawW: 25 } } },
};

/**
 * Minimal-valid default input for a macro (matches smoke harness buildInput).
 * @returns {object}
 */
export function buildDefaultInput(domain, name) {
  const key = `${domain}.${name}`;
  if (FIXTURES[key]) return { ...FIXTURES[key] };
  return { artifact: { id: "invariant-engine-artifact", data: {} } };
}

/**
 * Decide whether a macro is headless-safe to drive/fuzz. Mirrors the smoke
 * harness shouldSkip() exactly.
 * @returns {{ skip: boolean, reason?: string }}
 */
export function shouldSkip(domain, name) {
  if (SKIP_DOMAINS_DEFAULT.has(domain)) return { skip: true, reason: "skip_domain" };
  if (HEAVY_FUZZ_SKIP_IDS.has(`${domain}.${name}`)) return { skip: true, reason: "heavy_introspection" };
  if (EXTERNAL_IO_HINT_RE.test(name)) return { skip: true, reason: "external_io" };
  if (_skipDestructive && DESTRUCTIVE_HINT_RE.test(name)) return { skip: true, reason: "destructive" };
  if (!_llmEnabled && LLM_HINT_RE.test(name)) return { skip: true, reason: "llm_hint" };
  return { skip: false };
}

/**
 * Enumerate every (domain, name, spec) macro from the live MACROS map, sorted
 * deterministically, each tagged with its headless-safe decision.
 * @param {Map} MACROS
 * @returns {Array<{ domain:string, name:string, macroId:string, spec:object, skip:boolean, skipReason:string|null }>}
 */
export function enumerateMacros(MACROS) {
  const out = [];
  for (const [domain, macros] of MACROS.entries()) {
    for (const [name, entry] of macros.entries()) {
      const decision = shouldSkip(domain, name);
      out.push({
        domain,
        name,
        macroId: `${domain}.${name}`,
        spec: entry?.spec || { domain, name },
        skip: decision.skip,
        skipReason: decision.skip ? decision.reason : null,
      });
    }
  }
  out.sort((a, b) => a.macroId.localeCompare(b.macroId));
  return out;
}

// ── Deterministic JSON (sorted keys) for idempotent file writes ──────────────

/**
 * Stringify with recursively sorted object keys so re-derivation produces
 * byte-identical output (idempotent contract files).
 */
export function stableStringify(value, indent = 2) {
  const seen = new WeakSet();
  function sortValue(v) {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(sortValue);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return JSON.stringify(sortValue(value), null, indent) + "\n";
}
