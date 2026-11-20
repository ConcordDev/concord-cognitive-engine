/**
 * Engine entry — pvlib (SXE-37, pvlib).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * pvlib solar-energy modelling. BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (pvlib
 * 0.13.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pvlib.py");

defineEngine({
  id: "pvlib",
  version: "0.13.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PVLIB_BIN",
  defaultPath: "/opt/concord-engines/pvlib/bin/python",
  healthOp: "health",
  ops: ["health", "clear-sky"],
  kernel: KERNEL,
  installHint:
    "pvlib not provisioned on this host: provision the pvlib driver env (0.13.0) at /opt/concord-engines/pvlib (see docs/conkay/engines/pvlib.md). Until then solar tiers are NOT_COMPUTED engine_unavailable:pvlib.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { zenithDeg: "number", expectedZenithDeg: "number", zenithErrorDeg: "number", ghiWm2: "number", solisGhiWm2: "number", ghiRelDiff: "number", converged: "boolean" },
    },
    "clear-sky": {
      request: { linkeTurbidity: "number" },
      result: { zenithDeg: "number", expectedZenithDeg: "number", zenithErrorDeg: "number", ghiWm2: "number", solisGhiWm2: "number", ghiRelDiff: "number", converged: "boolean" },
    }
  },
});
