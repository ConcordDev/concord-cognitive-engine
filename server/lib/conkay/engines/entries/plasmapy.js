/**
 * Engine entry — plasmapy (SXE-31, PlasmaPy).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * PlasmaPy plasma formulary (the light half of SXE-31; the WarpX PIC leg is its own entry). BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (PlasmaPy
 * 2025.1.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-plasmapy.py");

defineEngine({
  id: "plasmapy",
  version: "2025.1.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PLASMAPY_BIN",
  defaultPath: "/opt/concord-engines/plasmapy/bin/python",
  healthOp: "health",
  ops: ["health", "formulary"],
  kernel: KERNEL,
  installHint:
    "PlasmaPy not provisioned on this host: provision the plasmapy driver env (PlasmaPy 2025.1.0) at /opt/concord-engines/plasmapy (see docs/conkay/engines/plasmapy.md). Until then plasma-formulary tiers are NOT_COMPUTED engine_unavailable:plasmapy.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 120000,
  opSchemas: {
    "health": {
      request: {},
      result: { omegaP: "number", expectedOmegaP: "number", debyeM: "number", expectedDebyeM: "number", maxRelError: "number" },
    },
    "formulary": {
      request: { densityM3: "number", tempK: "number" },
      result: { omegaP: "number", expectedOmegaP: "number", debyeM: "number", expectedDebyeM: "number", maxRelError: "number" },
    }
  },
});
