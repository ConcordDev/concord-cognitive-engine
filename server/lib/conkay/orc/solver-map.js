// server/lib/conkay/orc/solver-map.js
//
// SX-ORC-05 — orc.solver-map: subsystem -> solver graph (catalogue
// wave 0, PRG-17). Given subsystems and the capability needs of each,
// map every need to the registry's declared solvers and report, per
// need, the candidate solvers (top fidelity tier first, labelled) or
// a GAP naming the need verbatim. Every unread input lands in the gap
// list — nothing is dropped, nothing is matched by invention.
//
// Matching is a declared, deterministic rule (no model, no fuzzy
// magic): a need is tokenized; a solver is a candidate when its
// declared {id, method, domain, regime} text (tokenized the same way)
// matches at least one need token of length >= 3 — with a floor that
// keeps generic single words from force-matching: a multi-token need
// requires at least TWO distinct matched tokens, a single-token need
// requires its one token. (Priced during this build: "telepathy link"
// matched a solver on the word "link" alone — a false mapping, the
// exact failure the gap list exists to prevent.) The score is the
// count of distinct matched tokens; candidates sort by score, then by
// declared fidelity descending, then by id — the same inputs always
// produce the same map, and the map can be re-derived by hand from
// the registry's own declarations (that is the point: SXC-20's status
// data and this map read the same declarations).
//
// The top candidate per need is labelled `selected` with its tier;
// lower candidates are labelled fast paths with their tiers (the
// solver.select discipline, SX-XC-01, consumes this shape when it
// lands). A subsystem with no declared needs maps to a named gap.

import { registerSolver, listSolvers } from "../physics/registry.js";

const NS = "orc.solver-map";

function tokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3)
  );
}

function solverText(s) {
  return tokens(`${s.id} ${s.method} ${s.domain} ${(s.domains || []).join(" ")} ${s.regime || ""}`);
}

/** Rank the registry against one need. Pure over the given solver list. */
export function rankSolvers(need, solvers) {
  const needTokens = tokens(need);
  const threshold = needTokens.size <= 1 ? 1 : 2;
  const scored = [];
  for (const s of solvers) {
    const st = solverText(s);
    let score = 0;
    for (const t of needTokens) if (st.has(t)) score += 1;
    if (score >= threshold) scored.push({ id: s.id, fidelity: s.fidelity, score });
  }
  scored.sort((a, b) => b.score - a.score || b.fidelity - a.fidelity || a.id.localeCompare(b.id));
  return scored;
}

/** The pure solver function. Exported for direct testing. */
export function solverMap(props = {}, solvers = null) {
  const registry = solvers || listSolvers();
  const subsystems = props?.subsystems;
  if (!Array.isArray(subsystems) || !subsystems.length) {
    return { notComputed: "missing_input:subsystems", inputs: {} };
  }
  const map = [];
  const gaps = [];
  for (const [i, sub] of subsystems.entries()) {
    const name = sub?.name;
    if (typeof name !== "string" || !name) {
      return { notComputed: `INVALID_INPUT: subsystems[${i}].name must be a non-empty string`, inputs: {} };
    }
    const needs = sub?.needs;
    if (!Array.isArray(needs)) {
      return { notComputed: `missing_input:subsystems[${i}].needs`, inputs: {} };
    }
    const entries = [];
    if (!needs.length) {
      gaps.push({ subsystem: name, need: null, reason: "no needs declared for this subsystem — nothing to map" });
    }
    for (const need of needs) {
      if (typeof need !== "string" || !need.trim()) {
        return { notComputed: `INVALID_INPUT: subsystems[${i}].needs entries must be non-empty strings`, inputs: {} };
      }
      const ranked = rankSolvers(need, registry);
      if (!ranked.length) {
        gaps.push({ subsystem: name, need, reason: "no registered solver declares a matching capability — unread input, kept verbatim" });
        entries.push({ need, candidates: [], gap: true });
      } else {
        entries.push({
          need,
          candidates: ranked.map((c, j) => ({
            solver: c.id,
            tier: `L${c.fidelity}`,
            score: c.score,
            role: j === 0 ? "selected" : "fast-path",
          })),
        });
      }
    }
    map.push({ subsystem: name, entries });
  }
  return {
    inputs: { subsystems },
    outputs: {
      map,
      gaps,
      registrySize: registry.length,
      fullyMapped: gaps.length === 0,
    },
    assumptions: [],
    warnings: gaps.length ? [`${gaps.length} gap(s): needs with no matching registered solver are listed in outputs.gaps, verbatim`] : [],
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function mapTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function mapRun(ctx, id) {
  let all = null;
  try {
    all = ctx.get(id, "props");
  } catch {
    all = null;
  }
  const props = all ? all[NS] : null;
  if (!props || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
    return { notComputed: `props.${NS} is empty or absent on node ${id}`, inputs: {} };
  }
  return solverMap(props);
}

registerSolver({
  id: "orc.solver-map",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "solver-map.match",
  fidelity: 1,
  regime: "the live registry's contents at run time; matching is over declared id/method/domain/regime text only",
  units: "n/a — the map is over solver declarations; scores are distinct matched-token counts, tiers are declared fidelity levels",
  tolerance: "deterministic: identical registry + inputs always produce the identical map (score, then fidelity, then id)",
  screening: true,
  reference: "the registry's own declarations (listSolvers) — the map is re-derivable from them by hand; reference case in server/tests/conkay-orc-solver-map.test.js",
  graphProp: NS,
  targets: mapTargets,
  run: mapRun,
});

export default { solverMap, rankSolvers };
