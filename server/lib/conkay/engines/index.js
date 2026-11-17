/**
 * ConKay engine framework — SXE-00 public surface.
 *
 * GET /api/conkay/engines and the MCP conkay_engine_list tool both serve
 * engineListReport() from here, so the REST and MCP views of the engine
 * fleet can never drift apart.
 */

import { getEngine, listEngines, defineEngine, validateManifestEntry } from "./manifest.js";
import { runEngine, runProcessKernel, engineHealth, resolveEngineBinary, kernelHash } from "./run-engine.js";

export { getEngine, listEngines, defineEngine, validateManifestEntry, runEngine, runProcessKernel, engineHealth };

/**
 * One row per manifest entry. `engineDependent: true` on every row — the
 * flag solver listings (conkay_solver_list) mirror for solvers whose top
 * tier rides on an engine.
 */
export function engineListReport(env = process.env) {
  const engines = listEngines().map((entry) => ({
    id: entry.id,
    version: entry.version,
    licence: entry.licence,
    linkMode: entry.linkMode,
    present: resolveEngineBinary(entry, env) != null,
    healthOp: entry.healthOp,
    ops: entry.ops,
    footprint: entry.footprint ?? null,
    engineDependent: true,
    kernelHash: kernelHash(entry),
  }));
  return { engines, total: engines.length };
}
