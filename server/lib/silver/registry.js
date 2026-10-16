// server/lib/silver/registry.js
//
// Universal Silver, phase 1: one read-only registry over every compute
// surface Concord already has: ConKay solvers (physics/registry.js), Runtime
// capabilities (runtime/capability-registry.js) and plain macros
// (LENS_ACTIONS + MACROS), scored against the Silver contract (contract.js).
//
// buildSilverRegistry() is pure: give it the sources, get entries + a summary.
// collectLiveSources() reads the RUNNING server's maps (runtime truth, not a
// source grep): call it inside the server process (the `silver` macros, or
// scripts/silver-registry-report.mjs, which boots the server in-process).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_FIELDS, CONTRACT_VERSION, assessConkaySolver, assessCapability, assessMacro, isPromotionCandidate, candidateReason } from "./contract.js";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_DIR = path.resolve(SERVER_DIR, "..");

/**
 * sources: {
 *   conkaySolvers: listSolvers() rows,
 *   capabilities: listCapabilities() rows,
 *   lensActionKeys: ["domain.name", ...]           (LENS_ACTIONS)
 *   macroKeys: ["domain.name", ...]                (MACROS)
 *   inputHints: { "domain.name": [...] },
 *   macroDepth: [{ domain, macro, hasTest, tier }],
 *   oracleCases: [{ id, domain, action }],
 *   classify: (domain, name) => { class, reason, headlessSafe },
 *   testExists: (repoRelativePath) => boolean,
 * }
 */
export function buildSilverRegistry(sources) {
  const {
    conkaySolvers = [], capabilities = [], lensActionKeys = [], macroKeys = [],
    inputHints = {}, macroDepth = [], oracleCases = [], classify = null, testExists = () => false,
    handlerIds = {},
  } = sources;
  const entries = [];

  for (const s of conkaySolvers) entries.push(assessConkaySolver(s, { testExists: (t) => testExists(`server/${t}`) }));

  // macros: union of both registries, each tagged with where it lives
  const split = (k) => { const i = k.indexOf("."); return [k.slice(0, i), k.slice(i + 1)]; };
  const macros = new Map();
  for (const k of lensActionKeys) macros.set(k, { registries: ["LENS_ACTIONS"] });
  for (const k of macroKeys) macros.set(k, { registries: [...(macros.get(k)?.registries || []), "MACROS"] });
  const rawKeys = macros.size;
  // 1. sub-lens delegates (lib/sub-lens-handlers.js): "code.rust.git-commit" forwards to "code.git-commit".
  //    Folded into the parent entry: they are aliases, not engines.
  const delegatesOf = new Map();
  for (const k of [...macros.keys()]) {
    const p = k.split(".");
    if (p.length < 3) continue;
    const base = `${p[0]}.${p.slice(2).join(".")}`;
    if (!macros.has(base) || base === k) continue;
    const d = delegatesOf.get(base) || new Set();
    d.add(`${p[0]}.${p[1]}`);
    delegatesOf.set(base, d);
    macros.delete(k);
  }
  const delegateKeys = rawKeys - macros.size;
  // 2. one handler function registered on many domains (the shared common actions: save, share,
  //    star, ...): one entry per handler, carrying the domains it is mounted on.
  const groups = new Map();
  for (const k of macros.keys()) {
    const id = handlerIds[k];
    if (id == null) continue;
    groups.set(id, [...(groups.get(id) || []), k]);
  }
  const sharedOf = new Map();
  for (const keys of groups.values()) {
    if (keys.length < 2) continue;
    const domains = new Set(keys.map((k) => split(k)[0]));
    if (domains.size < 2) continue; // same-domain aliases stay separate (an alias name is part of that lens's API)
    const sorted = [...keys].sort();
    sharedOf.set(sorted[0], { keys: sorted.length, domains: domains.size, example: sorted.slice(0, 5) });
    for (const k of sorted.slice(1)) macros.delete(k);
  }
  const sharedFolded = [...sharedOf.values()].reduce((a, g) => a + g.keys - 1, 0);
  const depthOf = new Map(macroDepth.map((d) => [`${d.domain}.${d.macro}`, d]));
  const oracleOf = new Map();
  for (const c of oracleCases) {
    const k = `${c.domain}.${c.action}`;
    oracleOf.set(k, [...(oracleOf.get(k) || []), c.id]);
  }
  const capOf = new Map(capabilities.map((c) => [c.capability, c]));

  for (const [k, m] of [...macros.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [domain, name] = split(k);
    const e = assessMacro({ domain, name, registries: m.registries, hint: inputHints[k], depth: depthOf.get(k), cls: classify ? classify(domain, name) : null, oracle: oracleOf.get(k) || [] });
    if (delegatesOf.has(k)) e.subLensDelegates = [...delegatesOf.get(k)].sort();
    if (sharedOf.has(k)) { e.sharedHandler = sharedOf.get(k); e.domain = "(shared)"; e.id = `*.${name}`; e.key = `macro:*.${name}`; }
    // a Runtime capability descriptor declares more about the same macro: merge it in
    const cap = capOf.get(k);
    if (cap) {
      const c = assessCapability(cap);
      for (const f of CONTRACT_FIELDS) if (c.fields[f.id] === "declared") e.fields[f.id] = "declared";
      e.capability = { owner: cap.owner, ...c.evidence };
    }
    entries.push(e);
  }
  // capabilities with no macro behind them: their own entries. Those that declare another
  // implementation (an MCP tool) are not orphans; a "macro" capability with no macro is.
  for (const cap of capabilities) {
    if (macros.has(cap.capability)) continue;
    const c = assessCapability(cap);
    if (c.evidence.implementation === "macro") c.evidence.unregisteredMacro = true;
    entries.push(c);
  }

  const summary = summarize(entries);
  summary.registryKeys = { raw: rawKeys, subLensDelegatesFolded: delegateKeys, sharedHandlerKeysFolded: sharedFolded, distinctMacroEntries: entries.filter((e) => e.source === "macro").length };
  return { contractVersion: CONTRACT_VERSION, fields: CONTRACT_FIELDS, entries, summary };
}

export function summarize(entries) {
  const bySource = {};
  for (const e of entries) {
    const s = (bySource[e.source] ||= { count: 0, fields: {}, validation: {} });
    s.count += 1;
    s.validation[e.validation] = (s.validation[e.validation] || 0) + 1;
    for (const [f, st] of Object.entries(e.fields)) {
      const row = (s.fields[f] ||= {});
      row[st] = (row[st] || 0) + 1;
    }
  }
  const macros = entries.filter((e) => e.source === "macro");
  const classes = {};
  for (const e of macros) classes[e.evidence.class ?? "unclassified"] = (classes[e.evidence.class ?? "unclassified"] || 0) + 1;
  const candidates = macros.filter(isPromotionCandidate);
  const candDomains = {};
  for (const e of candidates) candDomains[e.domain] = (candDomains[e.domain] || 0) + 1;
  const conkay = entries.filter((e) => e.source === "conkay-solver");
  const fullyDeclared = entries.filter((e) => Object.values(e.fields).every((st) => st === "declared")).length;
  return {
    total: entries.length,
    domains: new Set(entries.map((e) => e.domain)).size,
    bySource,
    validation: Object.fromEntries(["uncertified", "benchmarked", "accepted"].map((v) => [v, entries.filter((e) => e.validation === v).length])),
    fullyDeclared,
    macroClasses: classes,
    macrosWithBehavioralTest: macros.filter((e) => e.evidence.behavioralTest === true).length,
    macrosInOracleCases: macros.filter((e) => e.evidence.oracleCases.length > 0).length,
    macrosWithInputHint: macros.filter((e) => e.fields.inputs === "hint").length,
    macrosInBothRegistries: macros.filter((e) => e.registries.length === 2).length,
    capabilitiesOutsideMacroMaps: entries.filter((e) => e.source === "runtime-capability").length,
    capabilitiesByImplementation: entries.filter((e) => e.source === "runtime-capability").reduce((a, e) => ({ ...a, [e.evidence.implementation]: (a[e.evidence.implementation] || 0) + 1 }), {}),
    capabilitiesUnregisteredMacro: entries.filter((e) => e.evidence?.unregisteredMacro).length,
    promotionCandidates: candidates.length,
    promotionCandidatesBy: { classifier: candidates.filter((e) => candidateReason(e) === "classifier").length, pureCompute: candidates.filter((e) => candidateReason(e) === "pure-compute").length },
    macrosPureCompute: macros.filter((e) => e.evidence.pureCompute === true).length,
    promotionCandidateDomains: Object.entries(candDomains).sort((a, b) => b[1] - a[1]),
    conkaySolversWithReferencedTests: conkay.filter((e) => e.evidence.referencedTests.some((t) => t.exists)).length,
  };
}

/** Read the sources from the running server process (call after boot). */
export async function collectLiveSources() {
  const { listSolvers } = await import("../conkay/index.js"); // importing it registers every ConKay solver
  const { listCapabilities } = await import("../runtime/capability-registry.js");
  const { classifyMacro } = await import("../runtime/macro-capability-classifier.js");
  const { SUBSTRATE_ORACLE_CASES } = await import("../runtime/substrate-oracles.js");
  const { MACRO_INPUT_HINTS } = await import("../macro-input-hints.js");
  const la = globalThis.__concordLensActions;
  const mm = globalThis._concordMACROS;
  if (!(la instanceof Map) || !(mm instanceof Map)) throw new Error("silver: the server's LENS_ACTIONS / MACROS maps are not available (call inside the booted server)");
  const macroKeys = [];
  for (const [d, sub] of mm) if (sub instanceof Map) for (const n of sub.keys()) macroKeys.push(`${d}.${n}`);
  // handler identity, so one function mounted on many domains is counted once
  const ids = new Map();
  const handlerIds = {};
  for (const [k, fn] of la) {
    if (typeof fn !== "function") continue;
    if (!ids.has(fn)) ids.set(fn, ids.size);
    handlerIds[k] = ids.get(fn);
  }
  let macroDepth = [];
  try {
    macroDepth = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "audit", "macro-depth-honest.json"), "utf8")).macros || [];
  } catch { macroDepth = []; }
  return {
    conkaySolvers: listSolvers(),
    capabilities: listCapabilities(),
    lensActionKeys: [...la.keys()],
    macroKeys,
    inputHints: MACRO_INPUT_HINTS,
    macroDepth,
    oracleCases: SUBSTRATE_ORACLE_CASES.map((c) => ({ id: c.id, domain: c.domain, action: c.action })),
    classify: classifyMacro,
    handlerIds,
    testExists: (rel) => fs.existsSync(path.join(REPO_DIR, rel)),
  };
}
