/**
 * Engine entry — gmat (SXE-36, GMAT).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * NASA GMAT mission analysis. Apache-2.0: the kernel drives the stock GmatConsole binary as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (GMAT
 * R2025a, Apache-2.0) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-gmat.py");

defineEngine({
  id: "gmat",
  version: "R2025a",
  licence: "Apache-2.0",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_GMAT_BIN",
  defaultPath: "/opt/concord-engines/gmat/bin/python",
  healthOp: "health",
  ops: ["health", "propagate"],
  kernel: KERNEL,
  installHint:
    "GMAT not provisioned on this host: provision the GMAT R2025a console binary on PATH plus the case dir and driver env at /opt/concord-engines/gmat (see docs/conkay/engines/gmat.md). Until then mission-analysis tiers are NOT_COMPUTED engine_unavailable:gmat.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 2 },
  timeoutMs: 900000,
  opSchemas: {
    "health": {
      request: {},
      result: { finalXKm: "number", finalYKm: "number", finalZKm: "number", radiusKm: "number", converged: "boolean" },
    },
    "propagate": {
      request: { propagateSecs: "number" },
      result: { finalXKm: "number", finalYKm: "number", finalZKm: "number", radiusKm: "number", converged: "boolean" },
    }
  },
});
