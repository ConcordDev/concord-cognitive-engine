/**
 * Engine entry — tmm (SXE-33, tmm).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * tmm transfer-matrix optics (thin-film stacks). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (tmm
 * 0.2.0, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-tmm.py");

defineEngine({
  id: "tmm",
  version: "0.2.0",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_TMM_BIN",
  defaultPath: "/opt/concord-engines/tmm/bin/python",
  healthOp: "health",
  ops: ["health", "reflectance"],
  kernel: KERNEL,
  installHint:
    "tmm not provisioned on this host: provision the tmm driver env (0.2.0) at /opt/concord-engines/tmm (see docs/conkay/engines/tmm.md). Until then thin-film tiers are NOT_COMPUTED engine_unavailable:tmm.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 180000,
  opSchemas: {
    "health": {
      request: {},
      result: { reflectance: "number", expectedReflectance: "number", absError: "number", converged: "boolean" },
    },
    "reflectance": {
      request: { wavelengthNm: "number", filmNm: "number" },
      result: { reflectance: "number", expectedReflectance: "number", absError: "number", converged: "boolean" },
    }
  },
});
