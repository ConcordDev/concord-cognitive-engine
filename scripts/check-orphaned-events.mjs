#!/usr/bin/env node
/**
 * check-orphaned-events.mjs — CI guard against dead UI wiring.
 *
 * The bug class: a component dispatches `new CustomEvent('concordia:foo')` that
 * NOTHING listens to — a button/action that looks functional but silently does
 * nothing (e.g. the ActionWheel skill wheel, NPCActionMenu Trade/Hire, the
 * time-loop world-tint). This script cross-references every dispatched DOM
 * CustomEvent against every `addEventListener` + the event-router handler map,
 * and fails if a NEW orphan appears.
 *
 * It is a RATCHET: ALLOWLIST holds the currently-known intentional orphans
 * (telemetry-only signals, future hooks) so today's tree passes, but any newly
 * introduced orphan fails CI. Fix the wire or, if genuinely intentional, add it
 * to ALLOWLIST with a reason.
 *
 * Usage: node scripts/check-orphaned-events.mjs   (exit 1 on new orphans)
 *        node scripts/check-orphaned-events.mjs --list   (report only, exit 0)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "concord-frontend");
const SCAN_DIRS = ["app", "components", "lib", "hooks"];

// Known-intentional orphans (telemetry-only signals / forward hooks). Each entry
// MUST carry a reason. Adding here is a deliberate ack that nothing consumes it.
const ALLOWLIST = new Map([
  ["concordia:wheel-action", "ActionWheel quick_panel/tool spokes also run an inline action(); dispatch is redundant telemetry."],
  ["concordia:appearance-changed", "Avatar customiser feedback signal; state is written separately."],
  ["concordia:active-world-changed", "World-travel telemetry; world switch is handled via state, not this event."],
  ["concordia:hud-settings-changed", "HUD settings telemetry; store writes happen inline."],
  ["concordia:nudges-reset", "Telemetry-only signal."],
  ["concordia:open-fishing", "Forward hook for a future 3D fishing scene consumer."],
  ["concordia:reduce-motion", "A11y telemetry; the a11y store write happens inline."],
  ["concordia:awakening-offered", "Notification telemetry."],
  ["concordia:power-cluster-claimed", "Forward hook for a future claim-HUD; PowerClusterLayer already pops the orb + plays juice."],
  ["concordia:perfect-defense", "Combat feedback hook (juice/impact consumer is future work)."],
  ["concordia:freecam", "PhotoMode forward hook."],
  ["concordia:photo-mode-end", "PhotoMode cleanup hook."],
  ["concordia:scene-request-ready", "Startup-readiness signal superseded by other readiness events."],
  ["concordia:visibility-shader", "Horror-mode shader hook (consumer is future work)."],
  ["concordia:interaction-recorded", "Intentional click telemetry (WorldInteractionSink); no functional consumer by design."],
]);

// Strip // line + /* */ block comments so example dispatches inside JSDoc (e.g.
// event-router.ts's `new CustomEvent('foo:bar')` doc) aren't counted.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (e === "node_modules" || e === ".next" || e === "dist") continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\./.test(e)) {
      acc.push(p);
    }
  }
  return acc;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

const dispatched = new Map(); // name -> [file:line]
const listened = new Set();

const DISPATCH_RE = /new CustomEvent\(\s*['"`]([^'"`]+)['"`]/g;
const LISTEN_RE = /addEventListener\(\s*['"`]([^'"`]+)['"`]/g;
// event-router maps event names to handlers as object keys; collect quoted keys.
const ROUTER_KEY_RE = /['"`]([a-zA-Z][\w-]*:[\w:-]+)['"`]\s*:/g;

for (const f of files) {
  const src = stripComments(readFileSync(f, "utf8"));
  const isRouter = /event-router/.test(f);
  let m;
  while ((m = DISPATCH_RE.exec(src))) {
    const name = m[1];
    if (!dispatched.has(name)) {
      const line = src.slice(0, m.index).split("\n").length;
      dispatched.set(name, `${f.replace(ROOT + "/", "")}:${line}`);
    }
  }
  while ((m = LISTEN_RE.exec(src))) listened.add(m[1]);
  if (isRouter) while ((m = ROUTER_KEY_RE.exec(src))) listened.add(m[1]);
}

const orphans = [...dispatched.keys()].filter((n) => !listened.has(n));
const newOrphans = orphans.filter((n) => !ALLOWLIST.has(n));
const listOnly = process.argv.includes("--list");

console.log(`Scanned ${files.length} files · ${dispatched.size} dispatched events · ${listened.size} listened names`);
console.log(`Orphans: ${orphans.length} total, ${ALLOWLIST.size} allowlisted, ${newOrphans.length} new\n`);

if (listOnly) {
  for (const n of orphans) {
    const tag = ALLOWLIST.has(n) ? "ok  " : "NEW ";
    console.log(`  [${tag}] ${n}  (${dispatched.get(n)})`);
  }
  // Surface allowlist entries that are now actually consumed (stale allowlist).
  const stale = [...ALLOWLIST.keys()].filter((n) => listened.has(n) || !dispatched.has(n));
  if (stale.length) {
    console.log("\nStale allowlist entries (now wired or removed — please delete):");
    for (const n of stale) console.log(`  - ${n}`);
  }
  process.exit(0);
}

if (newOrphans.length) {
  console.error("✗ New orphaned CustomEvent(s) — dispatched but nothing listens:\n");
  for (const n of newOrphans) console.error(`  • ${n}  (${dispatched.get(n)})`);
  console.error("\nWire a consumer (addEventListener / event-router), or if intentional add it");
  console.error("to ALLOWLIST in scripts/check-orphaned-events.mjs with a reason.");
  process.exit(1);
}

console.log("✓ No new orphaned events.");
process.exit(0);
