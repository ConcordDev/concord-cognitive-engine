// tests/dhtp.test.js — Sprint 60+ unit tests
import { applyDHTP, selectPreset, getDHTPStats, getBlockCache, resetBlockCache } from "../lib/dhtp.js";
import { DHTP_PRESETS } from "../lib/dhtp-presets.js";

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("\n=== DHTP — Dynamic Hybrid Tokenization Protocol ===");

// Test 1: Pattern detection
console.log("\n[1] Pattern detection");
const greeting = selectPreset("hi there!");
assert(greeting.matched && greeting.preset.id === "greeting_casual", "greeting_casual matches 'hi there!'");

const factual = selectPreset("what is consciousness?");
assert(factual.matched && factual.preset.id === "explain_concept", "explain_concept matches 'what is consciousness?'");

const codeReq = selectPreset("write me a function that does X");
assert(codeReq.matched && codeReq.preset.id === "code_request", "code_request matches 'write me a function...'");

const debug = selectPreset("I have this error: TypeError");
assert(debug.matched && debug.preset.id === "debug_request", "debug_request matches 'I have this error...'");

const compare = selectPreset("compare Python vs JavaScript");
assert(compare.matched && compare.preset.id === "compare", "compare matches 'compare Python vs...'");

const noMatch = selectPreset("xyzzx foobar nonsense");
assert(!noMatch.matched, "unmatched prompt returns matched=false");

// Test 2: Compression ratios
console.log("\n[2] Compression ratios");
const dtus = Array(33).fill(0).map((_, i) => ({
  id: `dtu_${i}`,
  title: `Sample DTU ${i} about something interesting and educational`,
  tier: i < 5 ? "mega" : "regular",
  updatedAt: `2026-08-14T16:00:0${i % 10}Z`,
}));

const realisticBase = `
[Identity] You are Concord. Direct, knowledgeable, never hedge unnecessarily.
[Mode] Chat mode. Engage with curiosity and warmth.
[Lens] "explore" lens active.
[Entity State] User engaged, no fatigue, mood neutral-positive.
[Rules] Never harmful. Respect privacy. Always honest.
[Memory] Earlier discussed DTU substrate and compression.
`.trim();

const testPrompts = [
  ["hi there", "greeting_casual"],
  ["what is X?", "explain_concept"],
  ["list all Y", "list_request"],
  ["summarize this", "summarize"],
  ["debug error", "debug_request"],
];

for (const [prompt, expectedId] of testPrompts) {
  const r = applyDHTP({ prompt, workingSetDtus: dtus, baseSystemPrompt: realisticBase });
  assert(r.presetId === expectedId, `${prompt} -> preset=${expectedId}`);
  assert(r.ratio >= 30, `${prompt} ratio >= 30:1 (got ${r.ratio.toFixed(1)})`);
  assert(r.maxResponseTokens > 0, `${prompt} maxResponseTokens=${r.maxResponseTokens}`);
}

// Test 3: Cache
console.log("\n[3] Block cache");
resetBlockCache();
const r1 = applyDHTP({ prompt: "list X", workingSetDtus: dtus, baseSystemPrompt: realisticBase });
const r2 = applyDHTP({ prompt: "list Y", workingSetDtus: dtus, baseSystemPrompt: realisticBase });
assert(r1.dtuHash === r2.dtuHash, "same DTUs produce same hash");
const stats = getBlockCache().stats();
assert(stats.size === 1, "cache size = 1 (only one entry)");
assert(stats.hits >= 1, "second call hits cache");

// Test 4: All 20 presets have valid regex
console.log("\n[4] Preset validation");
for (const p of DHTP_PRESETS) {
  try {
    new RegExp(p.pattern);
    assert(true, `valid regex: ${p.id}`);
  } catch (e) {
    assert(false, `valid regex: ${p.id} (${e.message})`);
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
