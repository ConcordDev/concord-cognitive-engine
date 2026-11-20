/**
 * Engine entry — swmm (SXE-35, EPA SWMM).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * EPA SWMM stormwater hydrology/hydraulics (US EPA public domain). The kernel drives the stock runswmm binary as a separate process.
 *
 * Licence as catalogued for the pinned release (EPA SWMM
 * 5.2.4, Public domain (US EPA)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-swmm.py");

defineEngine({
  id: "swmm",
  version: "5.2.4",
  licence: "Public domain (US EPA)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_SWMM_BIN",
  defaultPath: "/opt/concord-engines/swmm/bin/python",
  healthOp: "health",
  ops: ["health", "runoff"],
  kernel: KERNEL,
  installHint:
    "EPA SWMM not provisioned on this host: provision runswmm (SWMM 5.2.4) on PATH plus the driver env at /opt/concord-engines/swmm (see docs/conkay/engines/swmm.md). Until then stormwater tiers are NOT_COMPUTED engine_unavailable:swmm.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 900000,
  opSchemas: {
    "health": {
      request: {},
      result: { outfallVolumeM3: "number", expectedVolumeM3: "number", relError: "number", converged: "boolean" },
    },
    "runoff": {
      request: { rainMm: "number" },
      result: { outfallVolumeM3: "number", expectedVolumeM3: "number", relError: "number", converged: "boolean" },
    }
  },
});
