/**
 * Engine entry — samtools (SXE-28, samtools + bcftools).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * samtools + bcftools alignment/variant file tools (one entry, as the catalogue row names the pair). MIT: the kernel drives the stock CLIs as separate processes.
 *
 * Licence as catalogued for the pinned release (samtools + bcftools
 * 1.21, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-samtools.py");

defineEngine({
  id: "samtools",
  version: "1.21",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_SAMTOOLS_BIN",
  defaultPath: "/opt/concord-engines/samtools/bin/python",
  healthOp: "health",
  ops: ["health", "count"],
  kernel: KERNEL,
  installHint:
    "samtools/bcftools not provisioned on this host: provision samtools + bcftools 1.21 on PATH plus the driver env at /opt/concord-engines/samtools (see docs/conkay/engines/samtools.md). Until then alignment-file tiers are NOT_COMPUTED engine_unavailable:samtools.",
  footprint: { diskMb: 256, memoryMb: 256, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { records: "number", expectedRecords: "number", converged: "boolean" },
    },
    "count": {
      request: { sam: "string" },
      result: { records: "number" },
    }
  },
});
