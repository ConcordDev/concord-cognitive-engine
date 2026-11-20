/**
 * Engine entry — hcipy (SXE-33, HCIPy).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * HCIPy high-contrast-imaging optics propagation. BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (HCIPy
 * 0.6.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-hcipy.py");

defineEngine({
  id: "hcipy",
  version: "0.6.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_HCIPY_BIN",
  defaultPath: "/opt/concord-engines/hcipy/bin/python",
  healthOp: "health",
  ops: ["health", "airy"],
  kernel: KERNEL,
  installHint:
    "HCIPy not provisioned on this host: provision the HCIPy driver env (0.6.0) at /opt/concord-engines/hcipy (see docs/conkay/engines/hcipy.md). Until then coronagraph-optics tiers are NOT_COMPUTED engine_unavailable:hcipy.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { nullRadiusM: "number", expectedNullRadiusM: "number", relError: "number", converged: "boolean" },
    },
    "airy": {
      request: { focalM: "number" },
      result: { nullRadiusM: "number", expectedNullRadiusM: "number", relError: "number", converged: "boolean" },
    }
  },
});
