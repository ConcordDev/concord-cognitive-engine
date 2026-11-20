/**
 * Engine entry — spiceypy (SXE-36, SpiceyPy).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * SpiceyPy, the Python wrapper for NAIF's SPICE toolkit. MIT: imported only inside the child kernel process; the NAIF kernels are provisioned data.
 *
 * Licence as catalogued for the pinned release (SpiceyPy
 * 6.0.0, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-spiceypy.py");

defineEngine({
  id: "spiceypy",
  version: "6.0.0",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_SPICEYPY_BIN",
  defaultPath: "/opt/concord-engines/spiceypy/bin/python",
  healthOp: "health",
  ops: ["health", "position"],
  kernel: KERNEL,
  installHint:
    "SpiceyPy not provisioned on this host: provision the SpiceyPy driver env (6.0.0) and the NAIF kernels at /opt/concord-engines/spiceypy (see docs/conkay/engines/spiceypy.md). Until then SPICE tiers are NOT_COMPUTED engine_unavailable:spiceypy.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { xKm: "number", yKm: "number", zKm: "number", distanceKm: "number", converged: "boolean" },
    },
    "position": {
      request: { epochYear: "number" },
      result: { xKm: "number", yKm: "number", zKm: "number", distanceKm: "number", refErrorKm: "number", converged: "boolean" },
    }
  },
});
