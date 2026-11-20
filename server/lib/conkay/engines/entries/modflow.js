/**
 * Engine entry — modflow (SXE-35, MODFLOW 6 (via FloPy)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * MODFLOW 6 groundwater flow via FloPy (USGS public domain). FloPy is imported only inside the child kernel process; mf6 itself runs as its own process.
 *
 * Licence as catalogued for the pinned release (MODFLOW 6 (via FloPy)
 * 6.5.0, Public domain (USGS)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-modflow.py");

defineEngine({
  id: "modflow",
  version: "6.5.0",
  licence: "Public domain (USGS)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_MODFLOW_BIN",
  defaultPath: "/opt/concord-engines/modflow/bin/python",
  healthOp: "health",
  ops: ["health", "aquifer"],
  kernel: KERNEL,
  installHint:
    "MODFLOW 6 not provisioned on this host: provision the mf6 binary (MODFLOW 6.5.0) plus the flopy driver env at /opt/concord-engines/modflow (see docs/conkay/engines/modflow.md). Until then groundwater tiers are NOT_COMPUTED engine_unavailable:modflow.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 1 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { headMid: "number", expectedHeadMid: "number", relError: "number", converged: "boolean" },
    },
    "aquifer": {
      request: { headLeft: "number", headRight: "number" },
      result: { headMid: "number", expectedHeadMid: "number", relError: "number", converged: "boolean" },
    }
  },
});
