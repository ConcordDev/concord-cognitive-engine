/**
 * Engine entry — vina (SXE-28, AutoDock Vina).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * AutoDock Vina molecular docking. Apache-2: the kernel drives the stock vina binary as a separate process.
 *
 * Licence as catalogued for the pinned release (AutoDock Vina
 * 1.2.7, Apache-2.0) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-vina.py");

defineEngine({
  id: "vina",
  version: "1.2.7",
  licence: "Apache-2.0",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_VINA_BIN",
  defaultPath: "/opt/concord-engines/vina/bin/python",
  healthOp: "health",
  ops: ["health", "redock"],
  kernel: KERNEL,
  installHint:
    "AutoDock Vina not provisioned on this host: provision vina 1.2.7 on PATH, a docking case at CONKAY_VINA_CASE_DIR, and the driver env at /opt/concord-engines/vina (see docs/conkay/engines/vina.md). Until then docking tiers are NOT_COMPUTED engine_unavailable:vina.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 4 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { bestAffinity: "number", rmsdBest: "number", converged: "boolean" },
    },
    "redock": {
      request: { exhaustiveness: "number" },
      result: { bestAffinity: "number", rmsdBest: "number", converged: "boolean" },
    }
  },
});
