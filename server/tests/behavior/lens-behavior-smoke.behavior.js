/**
 * Lens Behavior Smoke Test (auto-derived from runtime MACROS map)
 *
 * The promise of "185/185 lenses pass production gate" was a structural
 * gate (manifest, status, hooks present). This file is the runtime gate:
 * for every (domain, action) macro that's been registered, invoke it
 * with a minimal/empty input and assert the response is a well-formed
 * object with `ok: boolean`. Any throw, malformed return, or missing
 * `ok` field fails the corresponding test — and forces a fix in the
 * lens itself, not the harness.
 *
 * Heuristics:
 *   - Macros whose name suggests live-LLM dependence (chat, respond,
 *     deliberate, narrate, brainstorm, …) are skipped unless the env
 *     CONCORD_BEHAVIOR_TEST_LLM=true is set + a brain endpoint is
 *     reachable. The user runs that path on RunPod where the GPU lives.
 *   - Destructive macros (delete, reset, purge, …) are skipped — they
 *     deserve their own fixture-based contract tests, not blind smoke.
 *   - A small per-macro fixture map provides minimal valid input for
 *     the few macros that need a non-empty body to avoid trivial
 *     no-input failures (e.g. ocean.waveAnalysis wants artifact.data).
 *
 * Run:  npm run test:behavior              (this harness alone)
 *       npm test                            (full server suite + this harness)
 *       CONCORD_BEHAVIOR_TEST_LLM=true ...  (also exercise LLM macros)
 *
 * The file is intentionally outside the main 'tests/**\/*.test.js' glob.
 * It imports server.js at module top to populate the MACROS map, which
 * shares STATE singletons across tests in the same node process. Running
 * it alongside other test files that also import server.js causes
 * cross-file state interference. Its own npm script gives it a clean
 * subprocess.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFallthroughMasking } from "../../lib/macro-contract.js";

// Top-level await — Node ESM supports it. Importing the server triggers
// every register() / registerLensAction() call so MACROS is fully populated
// by the time this module finishes initializing.
const mod = await import("../../server.js");
const { __TEST__ } = mod;
if (!__TEST__) throw new Error("server.js did not export __TEST__");

const { MACROS, runMacro, makeInternalCtx } = __TEST__;
if (!(MACROS instanceof Map)) throw new Error("__TEST__.MACROS must be a Map");
if (typeof runMacro !== "function") throw new Error("__TEST__.runMacro must be a function");
if (typeof makeInternalCtx !== "function") throw new Error("__TEST__.makeInternalCtx must be a function");

// ── Skip heuristics ──────────────────────────────────────────────────────────

const _llmEnabled = String(process.env.CONCORD_BEHAVIOR_TEST_LLM || "").toLowerCase() === "true";

// Macros whose names match this regex are likely to call an LLM brain.
// Skipped by default; the user runs them manually on RunPod where Ollama
// is reachable. False positives are tolerated — over-skipping is safer
// than over-firing brain calls in CI.
const LLM_HINT_RE = /^(respond|chat|reply|deliberate|narrate|synthesize|generate|brainstorm|propose|critique|reason|explain|elaborate|expand|rewrite|translate|tutor|teach|answer|ask|dream|imagine|score|evaluate|grade|review|writeReply|composeMessage|debate|persuade|argue)$|llm|brain/i;

// Destructive macros: previously skipped under the assumption that they
// needed bespoke fixtures. In practice, calling a destructive macro with
// empty/synthetic input either (a) fails the macro's own input validation
// and returns {ok:false, error:"id required"} — safe, or (b) throws,
// which the dispatcher catches and converts to {ok:false, error:
// "macro_uncaught_throw"} — also safe. The smoke harness only asserts a
// well-formed {ok:boolean} envelope, which both paths satisfy. Setting
// CONCORD_BEHAVIOR_SKIP_DESTRUCTIVE=true restores the old skip if
// circumstances ever require it.
const _skipDestructive = String(process.env.CONCORD_BEHAVIOR_SKIP_DESTRUCTIVE || "").toLowerCase() === "true";
const DESTRUCTIVE_HINT_RE = /^(delete|destroy|reset|wipe|clear|purge|drop|kill|terminate|revoke|unpublish)$|^(forceDelete|hardDelete|nuke)/i;

// Domains that are intentionally LLM-only — keep oracle + concordance
// skipped because they fire multi-stage LLM pipelines that need real
// inputs. council is now opted-in: most of its macros are CRUD
// (action-create, agenda-add, attendee-add) that return clean envelopes
// without an LLM round-trip.
const SKIP_DOMAINS_DEFAULT = new Set([
  "oracle",       // multi-phase reasoning pipeline; needs a real query
  "concordance",  // sovereign-only governance ops
]);

// Per-(domain,name) fixture overrides. Only add a fixture when a macro
// genuinely needs a non-empty input shape to do anything. Empty default
// is fine for the other ~900 macros.
const FIXTURES = {
  // Oceans of seed data → exercise the wave-physics path.
  "ocean.waveAnalysis":   { artifact: { data: { waveHeightMeters: 2, wavePeriodSeconds: 8, windSpeedKnots: 12 } } },
  "ocean.tidalPrediction": { artifact: { data: { location: "test-bay", tidalRangeMeters: 1.8 } } },
  "ocean.salinityProfile": { artifact: { data: { readings: [{depth:0,salinity:34,temperature:18},{depth:50,salinity:35,temperature:14}] } } },
  "ocean.marineEcosystem": { artifact: { data: { species: [{trophicLevel:"primary"},{trophicLevel:"secondary",threatened:true}] } } },
  "poetry.meterAnalysis":  { artifact: { data: { text: "Shall I compare thee to a summer's day\nThou art more lovely and more temperate" } } },
  "poetry.rhymeScheme":    { artifact: { data: { text: "Roses are red\nViolets are blue\nSugar is sweet\nAnd so are you" } } },
  "poetry.formGuide":      { artifact: { data: { form: "haiku" } } },
  "poetry.wordFrequency":  { artifact: { data: { text: "the quick brown fox jumps over the lazy dog" } } },
  "robotics.kinematicsCalc": { artifact: { data: { joints: [{type:"revolute",angle:45,length:200}] } } },
  "robotics.pathPlan":     { artifact: { data: { waypoints: [{x:0,y:0,z:0},{x:100,y:50,z:10}] } } },
  "robotics.sensorFusion": { artifact: { data: { sensors: [{name:"imu",value:1.2,confidence:0.9}] } } },
  "robotics.batteryLife":  { artifact: { data: { batteryCapacityWh: 100, motorDrawW: 25 } } },
};

function buildInput(domain, name) {
  const key = `${domain}.${name}`;
  if (FIXTURES[key]) return { ...FIXTURES[key] };
  // Default empty input — macros should tolerate this and either
  // return ok:true with a "needs input" message or ok:false with
  // a clear validation error. Either is acceptable; throws are not.
  return { artifact: { id: "smoke-test-artifact", data: {} } };
}

function shouldSkip(domain, name) {
  if (SKIP_DOMAINS_DEFAULT.has(domain)) return { skip: true, reason: "intentionally-skipped domain (heavy/LLM-only)" };
  if (_skipDestructive && DESTRUCTIVE_HINT_RE.test(name)) return { skip: true, reason: "destructive — disabled via CONCORD_BEHAVIOR_SKIP_DESTRUCTIVE" };
  if (!_llmEnabled && LLM_HINT_RE.test(name)) return { skip: true, reason: "LLM-dependent — set CONCORD_BEHAVIOR_TEST_LLM=true to include" };
  return { skip: false };
}

// ── Build cases at module init ───────────────────────────────────────────────

const cases = [];
for (const [domain, macros] of MACROS.entries()) {
  for (const [name] of macros.entries()) {
    cases.push({ domain, name });
  }
}
// Sort for deterministic output
cases.sort((a, b) => (a.domain + a.name).localeCompare(b.domain + b.name));

// ── Sanity ───────────────────────────────────────────────────────────────────

describe("Lens behavior smoke — pre-flight", () => {
  it("MACROS map is populated by server.js import", () => {
    assert.ok(MACROS.size > 50, `Expected >50 lens domains, got ${MACROS.size}`);
    assert.ok(cases.length > 200, `Expected >200 macros total, got ${cases.length}`);
  });
});

// ── Per-macro smoke tests (auto-generated) ───────────────────────────────────

// concurrency: true runs siblings in parallel within this file. With ~925
// test cases, serial execution would push the file past --test-timeout;
// concurrent finishes in seconds.
describe("Lens behavior smoke — per-macro", { concurrency: true }, () => {
  for (const { domain, name } of cases) {
    const decision = shouldSkip(domain, name);
    const opts = decision.skip
      ? { skip: decision.reason, concurrency: true }
      : { concurrency: true };

    it(`${domain}.${name} returns a well-formed response`, opts, async () => {
      const ctx = makeInternalCtx(`smoke:${domain}.${name}`);
      const input = buildInput(domain, name);
      let result;
      try {
        result = await runMacro(domain, name, input, ctx);
      } catch (err) {
        // Wrap to surface (domain, name) in the failure message — node:test
        // by default just shows the assert location, which loses the macro
        // identity in a 900-test run.
        throw new Error(`[${domain}.${name}] threw: ${err?.message || err}`);
      }
      assert.ok(result !== null && result !== undefined, `[${domain}.${name}] returned ${result}`);
      assert.strictEqual(typeof result, "object", `[${domain}.${name}] returned non-object: ${typeof result}`);
      assert.ok("ok" in result, `[${domain}.${name}] response missing 'ok' field. Got: ${JSON.stringify(result).slice(0, 200)}`);
      assert.strictEqual(typeof result.ok, "boolean", `[${domain}.${name}] response.ok is not boolean: ${typeof result.ok} (${result.ok})`);

      // L2 — no fallthrough-masking. A macro that quietly returns the brain-router's
      // "LLM unavailable" fallthrough object (e.g. {ok:false, source:'utility-brain'})
      // is masking an unwired/throwing path as if it were a normal negative result —
      // the #3/#27 class. A non-LLM macro must never surface that shape. (LLM-hint
      // macros are already skipped above via LLM_HINT_RE, so this only fires on the
      // deterministic surface where the mask is genuinely a bug.)
      assert.ok(
        !isFallthroughMasking(result),
        `[${domain}.${name}] returned a brain-fallthrough mask (LLM-unavailable shape leaking as a result): ${JSON.stringify(result).slice(0, 200)}`,
      );
    });
  }
});
