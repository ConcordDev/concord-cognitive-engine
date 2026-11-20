/**
 * Engine entry — blast (SXE-28, BLAST+).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * NCBI BLAST+ sequence search. Public domain: the kernel drives the stock makeblastdb/blastn CLIs as separate processes.
 *
 * Licence as catalogued for the pinned release (BLAST+
 * 2.16.0, Public domain (NCBI)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-blast.py");

defineEngine({
  id: "blast",
  version: "2.16.0",
  licence: "Public domain (NCBI)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_BLAST_BIN",
  defaultPath: "/opt/concord-engines/blast/bin/python",
  healthOp: "health",
  ops: ["health", "search"],
  kernel: KERNEL,
  installHint:
    "BLAST+ not provisioned on this host: provision the BLAST+ 2.16.0 tools on PATH plus the driver env at /opt/concord-engines/blast (see docs/conkay/engines/blast.md). Until then sequence-search tiers are NOT_COMPUTED engine_unavailable:blast.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { identityPct: "number", hitAccession: "string", converged: "boolean" },
    },
    "search": {
      request: { sequence: "string" },
      result: { identityPct: "number", hitAccession: "string" },
    }
  },
});
