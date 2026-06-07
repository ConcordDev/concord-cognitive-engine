#!/usr/bin/env node
// server/scripts/verify-brain-wiring.mjs
//
// "Are all five brains wired to their respective Ollamas?" — the verifier.
// Reads the live BRAIN_CONFIG (which resolves BRAIN_<ROLE>_URL + BRAIN_<ROLE>_MODEL
// from the environment), probes each role's endpoint(s), and confirms the configured
// MODEL is actually loaded there. Prints a per-brain green/red matrix. Exit 0 if every
// brain reaches its endpoint AND has its model; exit 1 otherwise. CI / startup-pipeable.
//
// Usage (from server/):  node scripts/verify-brain-wiring.mjs
//   honors the same env as the server, so run it with your .env.runpod loaded:
//   set -a; . ../.env.runpod; set +a; node scripts/verify-brain-wiring.mjs

import { BRAIN_CONFIG } from "../lib/brain-config.js";

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function tags(url) {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    const body = await res.json();
    const models = (body.models || []).map((m) => m.name || m.model).filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, reason: e?.name === "TimeoutError" ? "timeout" : (e?.cause?.code || e?.message || "unreachable") };
  }
}

// a model "matches" if the configured name is a prefix of an available tag (ollama
// tags are like "qwen2.5:3b"; a config of "qwen2.5:3b" or "qwen2.5" both match).
function hasModel(available, want) {
  if (!want) return false;
  const w = String(want).toLowerCase();
  return available.some((m) => {
    const a = String(m).toLowerCase();
    return a === w || a.startsWith(w) || a.startsWith(w.split(":")[0] + ":");
  });
}

console.log(`\nConcord — brain ⇆ Ollama wiring check`);
console.log(dim(`each role must reach its own endpoint AND have its model loaded\n`));

let allOk = true;
const ROLE_ORDER = ["conscious", "subconscious", "utility", "repair", "multimodal"];
const roles = ROLE_ORDER.filter((k) => BRAIN_CONFIG[k]).concat(Object.keys(BRAIN_CONFIG).filter((k) => !ROLE_ORDER.includes(k)));

for (const role of roles) {
  const cfg = BRAIN_CONFIG[role];
  if (!cfg || !cfg.url) continue;
  const endpoints = Array.isArray(cfg.urls) && cfg.urls.length ? cfg.urls : [cfg.url];
  const want = cfg.model;

  // a role is OK if at least one of its endpoints is reachable AND serves its model.
  let roleOk = false;
  const lines = [];
  for (const url of endpoints) {
    const probe = await tags(url);
    if (!probe.ok) { lines.push(`    ${r("✗")} ${url} ${dim("— " + probe.reason)}`); continue; }
    const present = hasModel(probe.models, want);
    if (present) { roleOk = true; lines.push(`    ${g("✓")} ${url} ${dim("— model present")}`); }
    else { lines.push(`    ${y("⚠")} ${url} ${dim(`— reachable, but model "${want}" NOT loaded (has: ${probe.models.slice(0, 4).join(", ") || "none"})`)}`); }
  }

  const status = roleOk ? g("WIRED") : r("BROKEN");
  console.log(`${status}  ${role.padEnd(13)} ${dim("→ " + want)}`);
  lines.forEach((l) => console.log(l));
  if (!roleOk) allOk = false;
}

console.log("");
if (allOk) {
  console.log(g("✓ All brains are wired to their respective Ollamas with their models loaded."));
  process.exit(0);
} else {
  console.log(r("✗ One or more brains are not wired. Fix BRAIN_<ROLE>_URL / BRAIN_<ROLE>_MODEL"));
  console.log(dim("  (or pull the missing model into that role's Ollama: ollama pull <model> against that endpoint),"));
  console.log(dim("  then re-run. The server's initFiveBrains() probes the same paths at boot."));
  process.exit(1);
}
