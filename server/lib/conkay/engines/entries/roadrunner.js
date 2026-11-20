/**
 * Engine entry — roadrunner (SXE-28, libRoadRunner).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * libRoadRunner SBML simulation (the systems-biology leg of SXE-28). Apache-2: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (libRoadRunner
 * 2.8.0, Apache-2.0) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-roadrunner.py");

defineEngine({
  id: "roadrunner",
  version: "2.8.0",
  licence: "Apache-2.0",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_ROADRUNNER_BIN",
  defaultPath: "/opt/concord-engines/roadrunner/bin/python",
  healthOp: "health",
  ops: ["health", "decay"],
  kernel: KERNEL,
  installHint:
    "libRoadRunner not provisioned on this host: provision the roadrunner driver env (libRoadRunner 2.8.0) at /opt/concord-engines/roadrunner (see docs/conkay/engines/roadrunner.md). Until then SBML tiers are NOT_COMPUTED engine_unavailable:roadrunner.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { xFinal: "number", expectedXFinal: "number", relError: "number", converged: "boolean" },
    },
    "decay": {
      request: { x0: "number", k: "number", tEnd: "number" },
      result: { xFinal: "number", expectedXFinal: "number", relError: "number", converged: "boolean" },
    }
  },
});
