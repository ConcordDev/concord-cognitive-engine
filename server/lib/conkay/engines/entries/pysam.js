/**
 * Engine entry — pysam (SXE-37, PySAM).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * NREL PySAM system-advisor models (PVWatts v8 here). BSD-3-style: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (PySAM
 * 7.1.0, BSD-3-Clause (NREL SAM licence)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pysam.py");

defineEngine({
  id: "pysam",
  version: "7.1.0",
  licence: "BSD-3-Clause (NREL SAM licence)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PYSAM_BIN",
  defaultPath: "/opt/concord-engines/pysam/bin/python",
  healthOp: "health",
  ops: ["health", "simulate"],
  kernel: KERNEL,
  installHint:
    "PySAM not provisioned on this host: provision the PySAM driver env (7.1.0) at /opt/concord-engines/pysam (see docs/conkay/engines/pysam.md). Until then SAM tiers are NOT_COMPUTED engine_unavailable:pysam.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { peakAcW: "number", capacityKw: "number", converged: "boolean" },
    },
    "simulate": {
      request: { capacityKw: "number" },
      result: { peakAcW: "number", capacityKw: "number", converged: "boolean" },
    }
  },
});
