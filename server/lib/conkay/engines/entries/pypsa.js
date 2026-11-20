/**
 * Engine entry — pypsa (SXE-19, PyPSA).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * PyPSA energy-system optimisation (linopy/HiGHS LOPF). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (PyPSA
 * 0.35.2, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pypsa.py");

defineEngine({
  id: "pypsa",
  version: "0.35.2",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PYPSA_BIN",
  defaultPath: "/opt/concord-engines/pypsa/bin/python",
  healthOp: "health",
  ops: ["health", "dispatch"],
  kernel: KERNEL,
  installHint:
    "PyPSA not provisioned on this host: provision the PyPSA driver env (0.35.2) at /opt/concord-engines/pypsa (see docs/conkay/engines/pypsa.md). Until then energy-optimisation tiers are NOT_COMPUTED engine_unavailable:pypsa.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { genCheapMW: "number", genDearMW: "number", objective: "number", expectedObjective: "number", relError: "number", converged: "boolean" },
    },
    "dispatch": {
      request: { loadMW: "number" },
      result: { genCheapMW: "number", genDearMW: "number", objective: "number", expectedObjective: "number", relError: "number", converged: "boolean" },
    }
  },
});
