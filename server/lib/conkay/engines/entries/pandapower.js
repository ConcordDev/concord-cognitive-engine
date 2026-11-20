/**
 * Engine entry — pandapower (SXE-19, pandapower).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * pandapower power-system analysis (Newton power flow). BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (pandapower
 * 2.14.11, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pandapower.py");

defineEngine({
  id: "pandapower",
  version: "2.14.11",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PANDAPOWER_BIN",
  defaultPath: "/opt/concord-engines/pandapower/bin/python",
  healthOp: "health",
  ops: ["health", "load-flow"],
  kernel: KERNEL,
  installHint:
    "pandapower not provisioned on this host: provision the pandapower driver env (2.14.11) at /opt/concord-engines/pandapower (see docs/conkay/engines/pandapower.md). Until then power-flow tiers are NOT_COMPUTED engine_unavailable:pandapower.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { maxVmError: "number", converged: "boolean" },
    },
    "load-flow": {
      request: { scaleLoad: "number" },
      result: { maxVmPu: "number", minVmPu: "number", totalLossMW: "number", converged: "boolean" },
    }
  },
});
