/**
 * Engine entry — lammps (SXE-27, LAMMPS).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * LAMMPS molecular dynamics. GPL-2: the kernel drives the stock lmp binary as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (LAMMPS
 * 20240829, GPL-2.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-lammps.py");

defineEngine({
  id: "lammps",
  version: "20240829",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_LAMMPS_BIN",
  defaultPath: "/opt/concord-engines/lammps/bin/python",
  healthOp: "health",
  ops: ["health", "nve-run"],
  kernel: KERNEL,
  installHint:
    "LAMMPS not provisioned on this host: provision the LAMMPS stable 20240829 binary on PATH plus the driver env at /opt/concord-engines/lammps (see docs/conkay/engines/lammps.md). Until then MD tiers are NOT_COMPUTED engine_unavailable:lammps.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 4 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { initialEnergy: "number", finalEnergy: "number", relDrift: "number", converged: "boolean" },
    },
    "nve-run": {
      request: { steps: "number" },
      result: { initialEnergy: "number", finalEnergy: "number", relDrift: "number", converged: "boolean" },
    }
  },
});
