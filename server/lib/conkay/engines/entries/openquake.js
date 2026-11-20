/**
 * Engine entry — openquake (SXE-35, OpenQuake).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenQuake seismic hazard/risk. AGPL-3: registered UNMODIFIED and process-only per the founder F7 ruling — the kernel only ever invokes the stock oq CLI as a separate process.
 *
 * Licence as catalogued for the pinned release (OpenQuake
 * 3.21.0, AGPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openquake.py");

defineEngine({
  id: "openquake",
  version: "3.21.0",
  licence: "AGPL-3.0-only",
  linkMode: "process",
  unmodified: true,
  envVar: "CONKAY_ENGINE_OPENQUAKE_BIN",
  defaultPath: "/opt/concord-engines/openquake/bin/python",
  healthOp: "health",
  ops: ["health", "hazard"],
  kernel: KERNEL,
  installHint:
    "OpenQuake not provisioned on this host: provision the oq CLI (OpenQuake 3.21.0) plus a demo case at CONKAY_OQ_DEMO and the driver env at /opt/concord-engines/openquake (see docs/conkay/engines/openquake.md). Until then seismic tiers are NOT_COMPUTED engine_unavailable:openquake.",
  footprint: { diskMb: 2048, memoryMb: 2048, threads: 4 },
  timeoutMs: 3600000,
  opSchemas: {
    "health": {
      request: {},
      result: { curves: "number", maxPoe: "number", converged: "boolean" },
    },
    "hazard": {
      request: { jobIni: "string" },
      result: { curves: "number", maxPoe: "number", converged: "boolean" },
    }
  },
});
