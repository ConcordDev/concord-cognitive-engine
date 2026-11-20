/**
 * Engine entry — opensim (SXE-28, OpenSim).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenSim musculoskeletal dynamics. Apache-2: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (OpenSim
 * 4.5.0, Apache-2.0) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-opensim.py");

defineEngine({
  id: "opensim",
  version: "4.5.0",
  licence: "Apache-2.0",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENSIM_BIN",
  defaultPath: "/opt/concord-engines/opensim/bin/python",
  healthOp: "health",
  ops: ["health", "pendulum"],
  kernel: KERNEL,
  installHint:
    "OpenSim not provisioned on this host: provision the opensim driver env (OpenSim 4.5.0, conda-forge) at /opt/concord-engines/opensim (see docs/conkay/engines/opensim.md). Until then musculoskeletal tiers are NOT_COMPUTED engine_unavailable:opensim.",
  footprint: { diskMb: 1024, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { periodS: "number", expectedPeriodS: "number", relError: "number", energyDriftRel: "number", converged: "boolean" },
    },
    "pendulum": {
      request: { lengthM: "number" },
      result: { periodS: "number", expectedPeriodS: "number", relError: "number", energyDriftRel: "number", converged: "boolean" },
    }
  },
});
