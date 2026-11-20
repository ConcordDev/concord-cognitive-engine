/**
 * Engine entry — climlab (SXE-35, climlab).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * climlab climate-process modelling (EBM/RCM hierarchy). BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (climlab
 * 0.10.1, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-climlab.py");

defineEngine({
  id: "climlab",
  version: "0.10.1",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_CLIMLAB_BIN",
  defaultPath: "/opt/concord-engines/climlab/bin/python",
  healthOp: "health",
  ops: ["health", "ebm"],
  kernel: KERNEL,
  installHint:
    "climlab not provisioned on this host: provision the climlab driver env (climlab 0.10.1) at /opt/concord-engines/climlab (see docs/conkay/engines/climlab.md). Until then climate-process tiers are NOT_COMPUTED engine_unavailable:climlab.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 1 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { globalMeanTsK: "number", maxTendencyK: "number", converged: "boolean" },
    },
    "ebm": {
      request: { solarFactor: "number" },
      result: { globalMeanTsK: "number", maxTendencyK: "number", converged: "boolean" },
    }
  },
});
