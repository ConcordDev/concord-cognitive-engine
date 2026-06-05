#!/usr/bin/env node
// server/scripts/verify-prod-flags.mjs
//
// "Is the prod env actually in the posture we intend?" — the boot-time flag asserter.
// Two failure modes it catches: (1) a FEATURE the living layer needs silently still OFF
// (agent never wakes, awareness loop dead), and (2) a SECURITY FOOTGUN silently ON (CSRF
// disabled, rate-limit bypassed, chaos injector live, unauthenticated webhooks). Both are
// invisible until something breaks in prod — this turns them into a red line at boot.
//
// Run it with the prod env loaded:
//   set -a; . ./.env.runpod; set +a; node server/scripts/verify-prod-flags.mjs
// Exit 0 = posture correct; exit 1 = at least one flag is wrong (prints which + the fix).
//
// This is intentionally a PURE env read — no DB, no network, no imports from the monolith
// — so it can run as the first gate in runpod-up.sh before anything binds a port.

const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, y = (s) => `\x1b[33m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;

// truthiness matching the server's own gates: most read `=== "true"` or `=== "1"`.
const on = (v) => v === "true" || v === "1";
const set = (v) => v !== undefined && v !== "";

// FEATURES that must be ON for the living layer to actually run in prod. Each carries the
// gate's accepted form + why it matters. (The on-by-default Wave 7 switches aren't asserted
// here — absence is correct for them; we only assert the ones that ship OFF and we flipped.)
const FEATURES = [
  ["CONCORD_AGENT_ENABLED", "the persistent autonomous agent (master gate — all agent ticks respect it)"],
  ["CONCORD_AWARENESS_LOOP", "the tier-3 awareness loop + reasoning journal"],
  ["GPU_ENABLED", "GPU inference (the Blackwell) — off would force CPU brains"],
  ["CONCORD_SPEED_AOI", "area-of-interest culling — the world-sim smoothness lever"],
  ["CONCORD_NPC_DIALOGUE_LLM", "LLM-nuanced NPC dialogue (deterministic fallback stays)"],
  ["CONCORD_DREAM_LLM", "LLM dream composition (deterministic fallback stays)"],
  ["CONCORD_QUEST_DIALOGUE_LLM", "LLM quest dialogue (deterministic fallback stays)"],
];

// SECURITY FOOTGUNS that must be OFF/unset in prod. These look like features but are holes;
// a blind "everything on" would open them. Being ON is the failure.
const FOOTGUNS = [
  ["CONCORD_DISABLE_CSRF", "disables CSRF protection on writes"],
  ["CONCORD_RATE_LIMIT_BYPASS", "removes per-actor rate limiting"],
  ["CONCORD_CHAOS_ENABLED", "the chaos fault-injector — live failures"],
  ["CONCORD_DISABLE_HEARTBEAT", "stops the governor tick (the whole sim)"],
  ["CONCORD_DISABLE_BRAINS", "disables the Ollama brains entirely"],
  ["CONCORD_WEBHOOK_ALLOW_OPEN", "opens unauthenticated webhooks"],
  ["CONCORD_FEDERATION_ALLOW_LOOPBACK", "relaxes the federation loopback guard"],
  ["COMPUTER_USE_ENABLED", "lets the model drive a computer-use surface"],
  ["REPAIR_NETWORK_ENABLED", "lets the repair cortex reach the network"],
];

// SECURITY HARDENING that should be ON (protections whose default-off is itself a finding).
const HARDENING = [
  ["CONCORD_ENFORCE_CSRF", "require CSRF tokens on writes"],
  ["CONCORD_AP_REQUIRE_SIGNATURE", "reject unsigned ActivityPub federation"],
];

let fail = false;
const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";
console.log(`\nConcord — prod flag posture ${dim(`(NODE_ENV=${process.env.NODE_ENV || "unset"})`)}\n`);

console.log("FEATURES (must be ON for the living layer):");
for (const [k, why] of FEATURES) {
  const ok = on(process.env[k]);
  console.log(`  ${ok ? g("✓ ON ") : r("✗ OFF")}  ${k.padEnd(30)} ${dim(why)}`);
  if (!ok) { fail = true; }
}

console.log("\nSECURITY FOOTGUNS (must be OFF/unset):");
for (const [k, why] of FOOTGUNS) {
  const lit = on(process.env[k]);
  console.log(`  ${lit ? r("✗ ON ") : g("✓ off")}  ${k.padEnd(34)} ${dim(why)}`);
  if (lit) { fail = true; }
}

console.log("\nSECURITY HARDENING (should be ON in prod):");
for (const [k, why] of HARDENING) {
  const ok = on(process.env[k]);
  const sev = isProd ? r("✗ OFF") : y("⚠ off");
  console.log(`  ${ok ? g("✓ ON ") : sev}  ${k.padEnd(30)} ${dim(why)}`);
  if (!ok && isProd) { fail = true; }
}

// JWT_SECRET in prod is a hard requirement (the [FATAL] path).
if (isProd && !set(process.env.JWT_SECRET)) {
  console.log(`\n${r("✗")} JWT_SECRET is unset in production — the server falls back to a random secret (sessions die on restart).`);
  fail = true;
}

console.log("");
if (fail) {
  console.log(r("✗ Prod flag posture is WRONG — fix the flagged lines in .env.runpod before boot."));
  console.log(dim("  Features OFF → the living layer won't run. Footguns ON → a security hole is open."));
  process.exit(1);
}
console.log(g("✓ Prod flag posture correct — living layer enabled, footguns closed, hardening on."));
process.exit(0);
