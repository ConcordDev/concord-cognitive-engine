/**
 * Engine entry — radiance (SXE-33, Radiance).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Radiance ray-tracing (lighting simulation). Its own licence: the kernel drives the stock oconv and rtrace binaries as separate processes and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (Radiance
 * 5.4, Radiance License) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-radiance.py");

defineEngine({
  id: "radiance",
  version: "5.4",
  licence: "Radiance License",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_RADIANCE_BIN",
  defaultPath: "/opt/concord-engines/radiance/bin/python",
  healthOp: "health",
  ops: ["health", "trace"],
  kernel: KERNEL,
  installHint:
    "Radiance not provisioned on this host: provision the Radiance 5.4 binaries on PATH plus the driver env at /opt/concord-engines/radiance (see docs/conkay/engines/radiance.md). Until then lighting tiers are NOT_COMPUTED engine_unavailable:radiance.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { radiance: "number", expectedRadiance: "number", relError: "number", converged: "boolean" },
    },
    "trace": {
      request: { intensity: "number" },
      result: { radiance: "number", expectedRadiance: "number", relError: "number", converged: "boolean" },
    }
  },
});
