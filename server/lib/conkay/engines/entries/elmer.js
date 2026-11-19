/**
 * Engine entry — elmer (SXE-10, Elmer FEM).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Elmer finite-element multiphysics. GPL-2/LGPL: the kernel drives the ElmerSolver binary as a separate process and imports nothing of it — linkMode "process" satisfies the manifest's GPL rule.
 *
 * Licence as catalogued for the pinned release (Elmer FEM
 * 9.0, GPL-2.0-only/LGPL-2.1-only (process)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-elmer.py");

defineEngine({
  id: "elmer",
  version: "9.0",
  licence: "GPL-2.0-only/LGPL-2.1-only (process)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_ELMER_BIN",
  defaultPath: "/opt/concord-engines/elmer/bin/python",
  healthOp: "health",
  ops: ["health", "coil"],
  kernel: KERNEL,
  installHint:
    "Elmer not provisioned on this host: install Elmer 9.0 with its test tree and provision the driver env at /opt/concord-engines/elmer (see docs/conkay/engines/elmer.md). Until then Elmer tiers are NOT_COMPUTED engine_unavailable:elmer.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 4 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { case: "string", scalar: "number" },
    },
    "coil": {
      request: { caseName: "string" },
      result: { case: "string", scalar: "number" },
    }
  },
});
