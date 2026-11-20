/**
 * Engine entry — astropy (SXE-36, Astropy).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Astropy astronomy library (ephemerides via its solar-system machinery). BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (Astropy
 * 7.1.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-astropy.py");

defineEngine({
  id: "astropy",
  version: "7.1.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_ASTROPY_BIN",
  defaultPath: "/opt/concord-engines/astropy/bin/python",
  healthOp: "health",
  ops: ["health", "position"],
  kernel: KERNEL,
  installHint:
    "Astropy not provisioned on this host: provision the Astropy driver env (7.1.0) at /opt/concord-engines/astropy (see docs/conkay/engines/astropy.md). Until then ephemeris tiers are NOT_COMPUTED engine_unavailable:astropy.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { xKm: "number", yKm: "number", zKm: "number", distanceKm: "number", converged: "boolean" },
    },
    "position": {
      request: { epochYear: "number" },
      result: { xKm: "number", yKm: "number", zKm: "number", distanceKm: "number", refErrorKm: "number", bandKm: "number", converged: "boolean" },
    }
  },
});
