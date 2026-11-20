/**
 * Engine entry — pyroomacoustics (SXE-34, pyroomacoustics).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * pyroomacoustics room-acoustics simulation (image-source RIRs). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (pyroomacoustics
 * 0.8.3, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pyroomacoustics.py");

defineEngine({
  id: "pyroomacoustics",
  version: "0.8.3",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PYROOMACOUSTICS_BIN",
  defaultPath: "/opt/concord-engines/pyroomacoustics/bin/python",
  healthOp: "health",
  ops: ["health", "rir"],
  kernel: KERNEL,
  installHint:
    "pyroomacoustics not provisioned on this host: provision the pyroomacoustics driver env (0.8.3) at /opt/concord-engines/pyroomacoustics (see docs/conkay/engines/pyroomacoustics.md). Until then room-acoustics tiers are NOT_COMPUTED engine_unavailable:pyroomacoustics.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 180000,
  opSchemas: {
    "health": {
      request: {},
      result: { arrivalSamples: "number", expectedSamples: "number", absErrorSamples: "number", converged: "boolean" },
    },
    "rir": {
      request: { distanceM: "number" },
      result: { arrivalSamples: "number", expectedSamples: "number", absErrorSamples: "number", converged: "boolean" },
    }
  },
});
