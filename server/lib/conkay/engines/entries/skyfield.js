/**
 * Engine entry — skyfield (SXE-36, Skyfield).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Skyfield astronomy library over the JPL DE421 ephemeris. MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (Skyfield
 * 1.49, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-skyfield.py");

defineEngine({
  id: "skyfield",
  version: "1.49",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_SKYFIELD_BIN",
  defaultPath: "/opt/concord-engines/skyfield/bin/python",
  healthOp: "health",
  ops: ["health", "position"],
  kernel: KERNEL,
  installHint:
    "Skyfield not provisioned on this host: provision the Skyfield driver env (1.49) and the DE421 ephemeris at /opt/concord-engines/skyfield (see docs/conkay/engines/skyfield.md). Until then ephemeris tiers are NOT_COMPUTED engine_unavailable:skyfield.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { xKm: "number", yKm: "number", zKm: "number", distanceAu: "number", converged: "boolean" },
    },
    "position": {
      request: { epochYear: "number" },
      result: { xKm: "number", yKm: "number", zKm: "number", distanceAu: "number", refErrorKm: "number", converged: "boolean" },
    }
  },
});
