/**
 * Engine entry — biopython (SXE-28, Biopython).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Biopython sequence analysis (the library leg of SXE-28). Imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (Biopython
 * 1.85, BSD-3-Clause (Biopython License Agreement)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-biopython.py");

defineEngine({
  id: "biopython",
  version: "1.85",
  licence: "BSD-3-Clause (Biopython License Agreement)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_BIOPYTHON_BIN",
  defaultPath: "/opt/concord-engines/biopython/bin/python",
  healthOp: "health",
  ops: ["health", "analyze"],
  kernel: KERNEL,
  installHint:
    "Biopython not provisioned on this host: provision the biopython driver env (Biopython 1.85) at /opt/concord-engines/biopython (see docs/conkay/engines/biopython.md). Until then sequence-analysis tiers are NOT_COMPUTED engine_unavailable:biopython.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { lengthN: "number", gcFraction: "number", expectedGcFraction: "number", protein: "string", converged: "boolean" },
    },
    "analyze": {
      request: { sequence: "string" },
      result: { lengthN: "number", gcFraction: "number", protein: "string" },
    }
  },
});
