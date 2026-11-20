/**
 * Engine entry — sgp4 (SXE-36, sgp4).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * the python-sgp4 orbit propagator. MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (sgp4
 * 2.24, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-sgp4.py");

defineEngine({
  id: "sgp4",
  version: "2.24",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_SGP4_BIN",
  defaultPath: "/opt/concord-engines/sgp4/bin/python",
  healthOp: "health",
  ops: ["health", "propagate"],
  kernel: KERNEL,
  installHint:
    "sgp4 not provisioned on this host: provision the sgp4 driver env (2.24) at /opt/concord-engines/sgp4 (see docs/conkay/engines/sgp4.md). Until then TLE propagation tiers are NOT_COMPUTED engine_unavailable:sgp4.",
  footprint: { diskMb: 128, memoryMb: 256, threads: 1 },
  timeoutMs: 180000,
  opSchemas: {
    "health": {
      request: {},
      result: { radiusKm: "number", speedKmS: "number", energyDrift: "number", angMomDrift: "number", converged: "boolean" },
    },
    "propagate": {
      request: { minutes: "number" },
      result: { radiusKm: "number", speedKmS: "number", energyDrift: "number", angMomDrift: "number", converged: "boolean" },
    }
  },
});
