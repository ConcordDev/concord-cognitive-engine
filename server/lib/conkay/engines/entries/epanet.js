/**
 * Engine entry — epanet (SXE-35, EPANET).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * EPANET water-distribution hydraulics (US EPA public domain). The kernel drives the EPANET toolkit shared library through ctypes — the library runs inside this child kernel process only.
 *
 * Licence as catalogued for the pinned release (EPANET
 * 2.3.0, Public domain (US EPA)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-epanet.py");

defineEngine({
  id: "epanet",
  version: "2.3.0",
  licence: "Public domain (US EPA)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_EPANET_BIN",
  defaultPath: "/opt/concord-engines/epanet/bin/python",
  healthOp: "health",
  ops: ["health", "pipe"],
  kernel: KERNEL,
  installHint:
    "EPANET not provisioned on this host: provision the EPANET toolkit library (EPANET 2.3.0) at CONKAY_EPANET_LIB plus the driver env at /opt/concord-engines/epanet (see docs/conkay/engines/epanet.md). Until then water-network tiers are NOT_COMPUTED engine_unavailable:epanet.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { headM: "number", expectedHeadM: "number", relError: "number", converged: "boolean" },
    },
    "pipe": {
      request: { demandM3s: "number" },
      result: { headM: "number", expectedHeadM: "number", relError: "number", converged: "boolean" },
    }
  },
});
