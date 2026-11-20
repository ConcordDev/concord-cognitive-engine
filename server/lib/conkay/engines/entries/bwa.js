/**
 * Engine entry — bwa (SXE-28, BWA).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * BWA short-read alignment (the catalogue §4 fold-in to SXE-28). MIT: the kernel drives the stock bwa CLI as a separate process.
 *
 * Licence as catalogued for the pinned release (BWA
 * 0.7.19, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-bwa.py");

defineEngine({
  id: "bwa",
  version: "0.7.19",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_BWA_BIN",
  defaultPath: "/opt/concord-engines/bwa/bin/python",
  healthOp: "health",
  ops: ["health", "align"],
  kernel: KERNEL,
  installHint:
    "BWA not provisioned on this host: provision bwa 0.7.19 on PATH plus the driver env at /opt/concord-engines/bwa (see docs/conkay/engines/bwa.md). Until then read-alignment tiers are NOT_COMPUTED engine_unavailable:bwa.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { position: "number", expectedPosition: "number", converged: "boolean" },
    },
    "align": {
      request: { read: "string" },
      result: { position: "number" },
    }
  },
});
