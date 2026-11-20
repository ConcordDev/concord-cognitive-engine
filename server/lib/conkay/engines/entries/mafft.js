/**
 * Engine entry — mafft (SXE-28, MAFFT).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * MAFFT multiple sequence alignment. The kernel drives the stock mafft CLI as a separate process.
 *
 * Licence as catalogued for the pinned release (MAFFT
 * 7.526, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-mafft.py");

defineEngine({
  id: "mafft",
  version: "7.526",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_MAFFT_BIN",
  defaultPath: "/opt/concord-engines/mafft/bin/python",
  healthOp: "health",
  ops: ["health", "align"],
  kernel: KERNEL,
  installHint:
    "MAFFT not provisioned on this host: provision mafft 7.526 on PATH plus the driver env at /opt/concord-engines/mafft (see docs/conkay/engines/mafft.md). Until then alignment tiers are NOT_COMPUTED engine_unavailable:mafft.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 2 },
  timeoutMs: 900000,
  opSchemas: {
    "health": {
      request: {},
      result: { rows: "number", alignedLength: "number", conservedColumns: "number", converged: "boolean" },
    },
    "align": {
      request: { sequences: "array" },
      result: { rows: "number", alignedLength: "number", conservedColumns: "number" },
    }
  },
});
