/**
 * Engine entry — su2 (SXE-12, SU2 CFD).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * SU2 CFD. LGPL-2.1: the kernel drives the SU2_CFD binary as a separate process and imports nothing of it — linkMode "process" satisfies the manifest's GPL-family rule. Its SXE-39 dependency is the MPI lane (parallel SU2 builds ride it); this entry registers the serial lane.
 *
 * Licence as catalogued for the pinned release (SU2 CFD
 * 8.3.0, LGPL-2.1-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-su2.py");

defineEngine({
  id: "su2",
  version: "8.3.0",
  licence: "LGPL-2.1-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_SU2_BIN",
  defaultPath: "/opt/concord-engines/su2/bin/python",
  healthOp: "health",
  ops: ["health", "naca"],
  kernel: KERNEL,
  installHint:
    "SU2 not provisioned on this host: install SU2 8.3.0 with the inv_NACA0012 tutorial mesh and provision the driver env at /opt/concord-engines/su2 (see docs/conkay/engines/su2.md). Until then CFD tiers are NOT_COMPUTED engine_unavailable:su2.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 4 },
  timeoutMs: 3600000,
  opSchemas: {
    "health": {
      request: {},
      result: { cl: "number", expectedCl: "number", absError: "number" },
    },
    "naca": {
      request: { mach: "number", aoaDeg: "number", iter: "number" },
      result: { cl: "number", expectedCl: "number", absError: "number" },
    }
  },
});
