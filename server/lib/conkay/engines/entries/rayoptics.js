/**
 * Engine entry — rayoptics (SXE-33, rayoptics).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * rayoptics sequential ray tracing and paraxial modelling. BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (rayoptics
 * 0.9.3, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-rayoptics.py");

defineEngine({
  id: "rayoptics",
  version: "0.9.3",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_RAYOPTICS_BIN",
  defaultPath: "/opt/concord-engines/rayoptics/bin/python",
  healthOp: "health",
  ops: ["health", "focal-length"],
  kernel: KERNEL,
  installHint:
    "rayoptics not provisioned on this host: provision the rayoptics driver env (0.9.3) at /opt/concord-engines/rayoptics (see docs/conkay/engines/rayoptics.md). Until then optics-design tiers are NOT_COMPUTED engine_unavailable:rayoptics.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { focalLengthMm: "number", expectedFocalLengthMm: "number", relError: "number", converged: "boolean" },
    },
    "focal-length": {
      request: { indexN: "number", radiusMm: "number" },
      result: { focalLengthMm: "number", expectedFocalLengthMm: "number", relError: "number", converged: "boolean" },
    }
  },
});
