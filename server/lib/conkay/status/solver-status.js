// server/lib/conkay/status/solver-status.js
//
// SXC-20 — buyer-facing solver status, regenerated mechanically.
// The status a buyer reads must be a function of the registry,
// not a document someone remembers to update: every row below is
// derived from the live registry plus two censuses, and the pin
// (server/tests/conkay-solver-status.test.js) regenerates the
// rows and fails if docs/conkay/solver-status.md has drifted.
//
// Columns and their sources — no column is hand-written:
//   tier            the solver's declared fidelity (registry
//                   descriptor). SCREENING solvers (declared
//                   screening fast paths) are labelled as such —
//                   fast paths are never dressed as top tier.
//   engineDependent read from the solver DESCRIPTOR via
//                   getSolver — listSolvers()' projection drops
//                   this field (finding filed at SX-CAD-01), so
//                   status never reads the projection.
//   tested          a ConKay suite file (server/tests/conkay-
//                   *.test.js) references the solver id. The
//                   corpus boundary is stated, not implied:
//                   suites outside that glob are not counted.
//   signed          docs/conkay/signoffs.json — an entry exists
//                   only when an independent checker agent has
//                   re-pulled the solver's cited reference and
//                   recomputed it (the catalogue's signing rule;
//                   self-review never counts). No entry = UNSIGNED,
//                   printed as such. A status page that implies
//                   signatures it does not hold is the failure
//                   this column exists to prevent.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listSolvers, getSolver } from "../physics/registry.js";

/** Census: solver ids referenced by the ConKay suite corpus. */
export function censusTestedIds(testsDir) {
  const ids = new Set();
  const files = readdirSync(testsDir).filter((f) => f.startsWith("conkay-") && f.endsWith(".test.js"));
  const known = listSolvers().map((s) => s.id);
  for (const f of files) {
    const text = readFileSync(join(testsDir, f), "utf8");
    for (const id of known) {
      if (!ids.has(id) && text.includes(id)) ids.add(id);
    }
  }
  return { tested: ids, corpusFiles: files.length };
}

/** Build the status rows from the live registry + censuses. */
export function buildStatusRows({ tested, signoffs }) {
  return listSolvers()
    .map((s) => {
      const d = getSolver(s.id);
      const engines = d && Array.isArray(d.engineDependent) ? d.engineDependent : [];
      const sign = signoffs ? signoffs[s.id] : null;
      return {
        id: s.id,
        domain: s.domain,
        tier: s.fidelity,
        screening: s.screening === true,
        engineDependent: engines,
        tested: tested.has(s.id),
        signed: sign ? sign.by : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Render the pinned block (the pin compares exactly this text). */
export function renderStatusBlock(rows) {
  const lines = [];
  const byTier = {};
  let engineBound = 0, testedCount = 0, signedCount = 0, screeningCount = 0;
  for (const r of rows) {
    byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    if (r.engineDependent.length) engineBound += 1;
    if (r.tested) testedCount += 1;
    if (r.signed) signedCount += 1;
    if (r.screening) screeningCount += 1;
  }
  lines.push(`Solvers registered: ${rows.length} · by tier: ${Object.keys(byTier).sort((a, b) => a - b).map((t) => `L${t} ${byTier[t]}`).join(" · ")}`);
  lines.push(`Engine-dependent: ${engineBound} · tested (ConKay suite corpus): ${testedCount} · signed (independent): ${signedCount} · screening fast paths: ${screeningCount}`);
  lines.push("");
  lines.push("| solver | domain | tier | engines | tested | signed |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    const tier = r.screening ? `L${r.tier} SCREENING` : `L${r.tier}`;
    const engines = r.engineDependent.length ? r.engineDependent.join(", ") : "—";
    lines.push(`| ${r.id} | ${r.domain} | ${tier} | ${engines} | ${r.tested ? "yes" : "NO"} | ${r.signed ? `yes (${r.signed})` : "UNSIGNED"} |`);
  }
  return lines.join("\n");
}

export default { censusTestedIds, buildStatusRows, renderStatusBlock };
