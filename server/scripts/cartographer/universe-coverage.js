// server/scripts/cartographer/universe-coverage.js
//
// For each category in categories.js, intersect its keyword set against:
//   - manifest.domainTags (runtime introspect)
//   - manifest.actions (runtime introspect)
//   - macroSpec.spec.* (runtime macros)
//   - route paths
//   - lens dir names
//
// Status:
//   present — at least 2 hits across these surfaces (multiple hooks)
//   partial — 1 hit only
//   missing — 0 hits
//
// NEVER greps raw code (too many comment false-positives).

import { CATEGORIES } from "./categories.js";

export function computeCoverage(staticData, runtimeData) {
  const results = [];
  for (const cat of CATEGORIES) {
    const matches = matchCategory(cat, staticData, runtimeData);
    const totalHits = matches.lensManifests.length + matches.macroDomains.length +
                      matches.routes.length + matches.lensDirs.length;
    let status;
    if (totalHits === 0) status = "missing";
    else if (totalHits === 1) status = "partial";
    else status = "present";
    results.push({
      category: cat.category,
      status,
      scope: cat.scope,
      matchedManifests: matches.lensManifests,
      matchedMacroDomains: matches.macroDomains,
      matchedRoutes: matches.routes,
      matchedLensDirs: matches.lensDirs,
      proposedTargetLens: cat.target_lens ?? null,
      priority: cat.priority ?? null,
      rationale: cat.rationale ?? null,
    });
  }
  return results;
}

function matchCategory(cat, staticData, runtimeData) {
  const kws = cat.keywords.map(k => String(k).toLowerCase());
  const matches = { lensManifests: [], macroDomains: [], routes: [], lensDirs: [] };

  // Lens manifests — runtime data
  const manifests = runtimeData?.lensManifests || [];
  for (const lm of manifests) {
    const fields = [
      lm.lensId, lm.domain,
      ...(lm.actions || []), ...(lm.actionTypes || []),
      ...(lm.domainTags || []),
    ].map(s => String(s).toLowerCase());
    if (kws.some(k => fields.some(f => f === k || f.includes(k)))) {
      matches.lensManifests.push(lm.lensId || lm.domain);
    }
  }

  // Macro domains — runtime preferred, fallback to static callsites
  const macroSet = new Set();
  if (runtimeData?.macros && runtimeData.macros.length > 0) {
    for (const m of runtimeData.macros) macroSet.add(`${m.domain}.${m.name}`.toLowerCase());
  } else {
    for (const m of staticData?.macroCallsites || []) macroSet.add(`${m.domain}.${m.name}`.toLowerCase());
  }
  for (const m of macroSet) {
    if (kws.some(k => m.includes(k))) {
      matches.macroDomains.push(m);
    }
  }

  // Route paths
  for (const r of staticData?.routes || []) {
    const lower = r.path.toLowerCase();
    if (kws.some(k => lower.includes(k))) {
      matches.routes.push(`${r.method} ${r.path}`);
    }
  }

  // Lens dir names
  for (const lens of staticData?.lensDirs || []) {
    const lower = lens.name.toLowerCase();
    if (kws.some(k => lower === k || lower === k.replace(/-/g, "_") || lower.includes(k))) {
      matches.lensDirs.push(lens.name);
    }
  }

  // De-dupe + cap
  matches.lensManifests = [...new Set(matches.lensManifests)].slice(0, 6);
  matches.macroDomains  = [...new Set(matches.macroDomains)].slice(0, 6);
  matches.routes        = [...new Set(matches.routes)].slice(0, 6);
  matches.lensDirs      = [...new Set(matches.lensDirs)].slice(0, 6);
  return matches;
}
