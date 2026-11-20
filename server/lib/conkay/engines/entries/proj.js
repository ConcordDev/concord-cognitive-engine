/**
 * Engine entry — proj (SXE-35, PROJ (via pyproj)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * PROJ coordinate transformations via pyproj (the plan §4 leg folded into SXE-35). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (PROJ (via pyproj)
 * 9.6.0, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-proj.py");

defineEngine({
  id: "proj",
  version: "9.6.0",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PROJ_BIN",
  defaultPath: "/opt/concord-engines/proj/bin/python",
  healthOp: "health",
  ops: ["health", "web-mercator"],
  kernel: KERNEL,
  installHint:
    "PROJ not provisioned on this host: provision the proj driver env (pyproj 3.7.2 / PROJ 9.6.0) at /opt/concord-engines/proj (see docs/conkay/engines/proj.md). Until then CRS tiers are NOT_COMPUTED engine_unavailable:proj.",
  footprint: { diskMb: 256, memoryMb: 256, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { xM: "number", yM: "number", expectedXM: "number", expectedYM: "number", maxRelError: "number", converged: "boolean" },
    },
    "web-mercator": {
      request: { lon: "number", lat: "number" },
      result: { xM: "number", yM: "number", expectedXM: "number", expectedYM: "number", maxRelError: "number", converged: "boolean" },
    }
  },
});
