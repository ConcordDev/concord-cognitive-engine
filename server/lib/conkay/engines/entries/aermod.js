/**
 * Engine entry — aermod (SXE-35, AERMOD).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * AERMOD air-dispersion modelling (US EPA public domain). The kernel drives the stock aermod binary as a separate process.
 *
 * Licence as catalogued for the pinned release (AERMOD
 * 24142, Public domain (US EPA)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-aermod.py");

defineEngine({
  id: "aermod",
  version: "24142",
  licence: "Public domain (US EPA)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_AERMOD_BIN",
  defaultPath: "/opt/concord-engines/aermod/bin/python",
  healthOp: "health",
  ops: ["health", "plume"],
  kernel: KERNEL,
  installHint:
    "AERMOD not provisioned on this host: provision the aermod binary (AERMOD 24142) on PATH plus the driver env at /opt/concord-engines/aermod (see docs/conkay/engines/aermod.md). Until then dispersion tiers are NOT_COMPUTED engine_unavailable:aermod.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { maxConcUgM3: "number", converged: "boolean" },
    },
    "plume": {
      request: { emissionRate: "number" },
      result: { maxConcUgM3: "number", converged: "boolean" },
    }
  },
});
