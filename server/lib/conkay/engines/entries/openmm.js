/**
 * Engine entry — openmm (SXE-27, OpenMM).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenMM molecular simulation toolkit (CPU platform here). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (OpenMM
 * 8.2.0, MIT (OpenMM licence)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openmm.py");

defineEngine({
  id: "openmm",
  version: "8.2.0",
  licence: "MIT (OpenMM licence)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENMM_BIN",
  defaultPath: "/opt/concord-engines/openmm/bin/python",
  healthOp: "health",
  ops: ["health", "oscillator"],
  kernel: KERNEL,
  installHint:
    "OpenMM not provisioned on this host: provision the OpenMM driver env (8.2.0) at /opt/concord-engines/openmm (see docs/conkay/engines/openmm.md). Until then OpenMM tiers are NOT_COMPUTED engine_unavailable:openmm.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { periodPs: "number", expectedPeriodPs: "number", relError: "number", converged: "boolean" },
    },
    "oscillator": {
      request: { springK: "number" },
      result: { periodPs: "number", expectedPeriodPs: "number", relError: "number", converged: "boolean" },
    }
  },
});
