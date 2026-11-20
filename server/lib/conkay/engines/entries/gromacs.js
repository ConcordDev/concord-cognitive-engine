/**
 * Engine entry — gromacs (SXE-27, GROMACS).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * GROMACS molecular dynamics. LGPL-2.1: the kernel drives the stock gmx binary as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (GROMACS
 * 2024.4, LGPL-2.1-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-gromacs.py");

defineEngine({
  id: "gromacs",
  version: "2024.4",
  licence: "LGPL-2.1-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_GROMACS_BIN",
  defaultPath: "/opt/concord-engines/gromacs/bin/python",
  healthOp: "health",
  ops: ["health", "minimize"],
  kernel: KERNEL,
  installHint:
    "GROMACS not provisioned on this host: provision the GROMACS 2024.4 binary on PATH plus the lysozyme case dir and driver env at /opt/concord-engines/gromacs (see docs/conkay/engines/gromacs.md). Until then biomolecular-MD tiers are NOT_COMPUTED engine_unavailable:gromacs.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 4 },
  timeoutMs: 900000,
  opSchemas: {
    "health": {
      request: {},
      result: { potentialEnergy: "number", converged: "boolean" },
    },
    "minimize": {
      request: { caseDir: "string" },
      result: { potentialEnergy: "number", converged: "boolean" },
    }
  },
});
