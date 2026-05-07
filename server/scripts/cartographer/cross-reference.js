// server/scripts/cartographer/cross-reference.js
//
// Joins static + runtime data to surface orphans, dead code, dormant
// modules, headless backends, unshaped events. The cartographer's
// audit-driving output. All consumers (Phase 2 audits + GAPS.md
// renderer) read crossRef.* arrays.

import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_READ_DOMAINS_RE = /publicReadDomains\s*=\s*\{([\s\S]*?)\}\s*;/;
const ALLOWED_DOMAIN_RE = /^\s*["']([a-z_]+)["']\s*:/gm;

export async function crossReferenceAll(repoRoot, staticData, runtimeData) {
  const publicReadDomains = await readPublicReadDomains(repoRoot);

  // ── Dead tables ─────────────────────────────────────────────────────────
  // staticData.tableRefs is [{ name, count }] from grep over server tree
  // (excluding migrations). count of 0 = no SELECT/INSERT/UPDATE/DELETE/JOIN/TABLE FROM/INTO
  const refsByTable = new Map(staticData.tableRefs.map(r => [r.name, r.count]));
  const deadTables = staticData.tables
    .filter(t => (refsByTable.get(t.name) ?? 0) === 0)
    .map(t => ({
      name: t.name,
      migration: t.migrationFile,
      reason: "no_ref_outside_migrations",
    }));
  // De-dupe — same table may appear in multiple migrations (CREATE IF NOT EXISTS)
  const deadTablesSeen = new Set();
  const deadTablesUnique = [];
  for (const d of deadTables) {
    if (deadTablesSeen.has(d.name)) continue;
    deadTablesSeen.add(d.name);
    deadTablesUnique.push(d);
  }

  // ── Orphan modules ──────────────────────────────────────────────────────
  const orphanModules = (runtimeData.moduleRegistry || [])
    .filter(m => Number(m.importedBy ?? 0) === 0)
    .map(m => ({ id: m.id, file: m.file, reason: "importedBy_zero" }));

  // ── Dormant ghost-fleet / emergent modules ─────────────────────────────
  // A module is "dormant" if it has no heartbeat AND its file isn't imported
  // by any router. We approximate: heartbeats are exact; router import is
  // estimated via module-registry's `importedBy`.
  const heartbeatIds = new Set((runtimeData.heartbeats || []).map(h => h.id));
  const dormantModules = (runtimeData.moduleRegistry || [])
    .filter(m => {
      if (Number(m.importedBy ?? 0) === 0) return false; // already orphan
      const id = m.id;
      // Is there a heartbeat whose id name-matches the module file? Best-effort.
      const hbMatch = [...heartbeatIds].some(hb => hb.includes(id) || id.includes(hb));
      if (hbMatch) return false;
      // Is it in the macro-callsite list? Then it's actively wired through ghost-fleet.
      const usedByMacro = (staticData.macroCallsites || []).some(mc =>
        mc.name && (id.includes(mc.name) || mc.name.includes(id.replace(/-/g, "_")))
      );
      if (usedByMacro) return false;
      // Subsystem 'utility' / 'shared' modules are infrastructure, not gameplay
      if (m.subsystem === "shared" || m.subsystem === "utility" || m.subsystem === "config") return false;
      return true;
    })
    .map(m => ({ id: m.id, file: m.file, subsystem: m.subsystem, importedBy: m.importedBy, reason: "no_heartbeat_no_macro" }));

  // ── Headless backends ──────────────────────────────────────────────────
  // Macro domains that exist but have no matching frontend lens dir.
  const lensDirNames = new Set((staticData.lensDirs || []).map(d => d.name.toLowerCase()));
  const macroDomains = new Set();
  if (runtimeData.macros && runtimeData.macros.length > 0) {
    for (const m of runtimeData.macros) macroDomains.add(m.domain);
  } else {
    // Fallback to static callsites
    for (const m of staticData.macroCallsites || []) macroDomains.add(m.domain);
  }
  const headlessBackends = [];
  for (const dom of macroDomains) {
    const lensCandidates = [dom, dom.replace(/_/g, "-"), dom.replace(/-/g, "_"), dom.replace(/_/g, "")];
    const found = lensCandidates.some(c => lensDirNames.has(c.toLowerCase()));
    if (!found) {
      const macroCount = runtimeData.macros
        ? runtimeData.macros.filter(m => m.domain === dom).length
        : (staticData.macroCallsites || []).filter(m => m.domain === dom).length;
      headlessBackends.push({ domain: dom, macroCount, reason: "no_matching_lens_dir" });
    }
  }

  // ── Orphan lenses ──────────────────────────────────────────────────────
  // Lens dirs without backend domain OR with empty page.tsx
  const orphanLenses = [];
  for (const lens of staticData.lensDirs || []) {
    if (!lens.hasPage) {
      orphanLenses.push({ frontendDir: lens.name, reason: "page_tsx_empty_or_missing" });
      continue;
    }
    const candidates = [lens.name, lens.name.replace(/-/g, "_"), lens.name.replace(/_/g, "-"), lens.name.replace(/-/g, "")];
    const matched = candidates.some(c => macroDomains.has(c.toLowerCase()));
    if (!matched && lens.name !== "(parent)" && !lens.name.startsWith(".")) {
      orphanLenses.push({ frontendDir: lens.name, pageBytes: lens.pageBytes, reason: "no_matching_backend_domain" });
    }
  }

  // ── Unused macros ─────────────────────────────────────────────────────
  // Macros not invoked by any router AND not in publicReadDomains allowlist
  // AND not in lens-manifest actions. Heuristic — chat router invokes by
  // name dynamically, so over-reports are expected.
  const unusedMacros = [];
  const allRouteContent = await readAllRouteContent(repoRoot);
  for (const m of (runtimeData.macros || staticData.macroCallsites || [])) {
    const dom = m.domain;
    const nm = m.name;
    if (!dom || !nm) continue;
    if (publicReadDomains.has(dom)) continue;
    const directPattern = new RegExp(`runMacro\\s*\\(\\s*["']${dom}["']\\s*,\\s*["']${nm}["']`);
    const indirectPattern = new RegExp(`["']${dom}["']\\s*[,)]\\s*["']${nm}["']`);
    if (directPattern.test(allRouteContent) || indirectPattern.test(allRouteContent)) continue;
    unusedMacros.push({ domain: dom, name: nm, reason: "no_runMacro_callsite_in_routes" });
  }

  // ── Unshaped events ───────────────────────────────────────────────────
  const eventShapes = new Set();
  try {
    const esContent = await readFile(path.join(repoRoot, "server", "lib", "event-shapes.js"), "utf-8");
    for (const m of esContent.matchAll(/["']([a-z][\w:.-]+)["']\s*:/g)) eventShapes.add(m[1]);
  } catch { /* event-shapes file may not exist on minimal builds */ }

  const eventNames = new Set((staticData.socketEvents || []).map(e => e.event));
  const unshapedEvents = [];
  for (const event of eventNames) {
    if (!eventShapes.has(event)) {
      const sample = (staticData.socketEvents || []).find(e => e.event === event);
      unshapedEvents.push({
        event,
        emitterFile: sample?.file ?? "(unknown)",
        emitterLine: sample?.line ?? 0,
        reason: "not_in_event_shapes_registry",
      });
    }
  }

  return {
    deadTables: deadTablesUnique,
    orphanModules,
    dormantModules,
    headlessBackends,
    orphanLenses,
    unusedMacros,
    unshapedEvents,
    routesNeverHit: { todo: "requires_prod_traffic_data" },
  };
}

async function readPublicReadDomains(repoRoot) {
  const set = new Set();
  try {
    const content = await readFile(path.join(repoRoot, "server", "server.js"), "utf-8");
    const m = content.match(PUBLIC_READ_DOMAINS_RE);
    if (m) {
      let dm;
      ALLOWED_DOMAIN_RE.lastIndex = 0;
      while ((dm = ALLOWED_DOMAIN_RE.exec(m[1]))) {
        set.add(dm[1]);
      }
    }
  } catch { /* ignore */ }
  return set;
}

async function readAllRouteContent(repoRoot) {
  const { readdir } = await import("node:fs/promises");
  const routesDir = path.join(repoRoot, "server", "routes");
  let files;
  try { files = await readdir(routesDir); } catch { return ""; }
  const all = [];
  for (const f of files.filter(f => f.endsWith(".js"))) {
    try { all.push(await readFile(path.join(routesDir, f), "utf-8")); }
    catch { /* skip */ }
  }
  // Also include server.js (large but contains many runMacro calls)
  try { all.push(await readFile(path.join(repoRoot, "server", "server.js"), "utf-8")); }
  catch { /* skip */ }
  return all.join("\n");
}
