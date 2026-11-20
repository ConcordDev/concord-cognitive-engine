/**
 * Engine entry — poppy (SXE-33, POPPY).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * POPPY physical-optics propagation. BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (POPPY
 * 1.1.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-poppy.py");

defineEngine({
  id: "poppy",
  version: "1.1.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_POPPY_BIN",
  defaultPath: "/opt/concord-engines/poppy/bin/python",
  healthOp: "health",
  ops: ["health", "airy"],
  kernel: KERNEL,
  installHint:
    "POPPY not provisioned on this host: provision the POPPY driver env (1.1.0) at /opt/concord-engines/poppy (see docs/conkay/engines/poppy.md). Until then physical-optics tiers are NOT_COMPUTED engine_unavailable:poppy.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { nullArcsec: "number", expectedNullArcsec: "number", relError: "number", converged: "boolean" },
    },
    "airy": {
      request: { wavelengthNm: "number" },
      result: { nullArcsec: "number", expectedNullArcsec: "number", relError: "number", converged: "boolean" },
    }
  },
});
