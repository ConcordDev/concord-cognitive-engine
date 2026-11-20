/**
 * Engine entry — cobrapy (SXE-28, COBRApy).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * COBRApy constraint-based metabolic modelling (FBA). BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (COBRApy
 * 0.29.1, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-cobrapy.py");

defineEngine({
  id: "cobrapy",
  version: "0.29.1",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_COBRAPY_BIN",
  defaultPath: "/opt/concord-engines/cobrapy/bin/python",
  healthOp: "health",
  ops: ["health", "fba"],
  kernel: KERNEL,
  installHint:
    "COBRApy not provisioned on this host: provision the cobrapy driver env (COBRApy 0.29.1) at /opt/concord-engines/cobrapy (see docs/conkay/engines/cobrapy.md). Until then FBA tiers are NOT_COMPUTED engine_unavailable:cobrapy.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { growthRate: "number", expectedGrowthRate: "number", relError: "number", converged: "boolean" },
    },
    "fba": {
      request: { model: "string" },
      result: { growthRate: "number", expectedGrowthRate: "number", relError: "number", converged: "boolean" },
    }
  },
});
