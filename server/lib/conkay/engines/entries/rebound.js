/**
 * Engine entry — rebound (SXE-36, REBOUND).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * REBOUND N-body dynamics. GPL-3: imported only inside the child kernel process, which is the separate process the manifest declares.
 *
 * Licence as catalogued for the pinned release (REBOUND
 * 4.4.0, GPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-rebound.py");

defineEngine({
  id: "rebound",
  version: "4.4.0",
  licence: "GPL-3.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_REBOUND_BIN",
  defaultPath: "/opt/concord-engines/rebound/bin/python",
  healthOp: "health",
  ops: ["health", "orbit"],
  kernel: KERNEL,
  installHint:
    "REBOUND not provisioned on this host: provision the REBOUND driver env (4.4.0) at /opt/concord-engines/rebound (see docs/conkay/engines/rebound.md). Until then N-body tiers are NOT_COMPUTED engine_unavailable:rebound.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { period: "number", expectedPeriod: "number", relError: "number", closureError: "number", converged: "boolean" },
    },
    "orbit": {
      request: { semiMajor: "number" },
      result: { period: "number", expectedPeriod: "number", relError: "number", closureError: "number", converged: "boolean" },
    }
  },
});
