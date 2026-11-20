/**
 * Engine entry — specfem (SXE-35, SPECFEM2D).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * SPECFEM2D spectral-element seismology. GPL-3: the kernel drives the stock xmeshfem2D / xspecfem2D binaries as separate processes.
 *
 * Licence as catalogued for the pinned release (SPECFEM2D
 * 8.1.0, GPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-specfem.py");

defineEngine({
  id: "specfem",
  version: "8.1.0",
  licence: "GPL-3.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_SPECFEM_BIN",
  defaultPath: "/opt/concord-engines/specfem/bin/python",
  healthOp: "health",
  ops: ["health", "example"],
  kernel: KERNEL,
  installHint:
    "SPECFEM2D not provisioned on this host: provision xmeshfem2D + xspecfem2D (SPECFEM2D 8.1.0) on PATH, an example case at CONKAY_SPECFEM_EXAMPLE, and the driver env at /opt/concord-engines/specfem (see docs/conkay/engines/specfem.md). Until then seismic-wave tiers are NOT_COMPUTED engine_unavailable:specfem.",
  footprint: { diskMb: 1024, memoryMb: 1024, threads: 4 },
  timeoutMs: 3600000,
  opSchemas: {
    "health": {
      request: {},
      result: { traces: "number", maxAmplitude: "number", converged: "boolean" },
    },
    "example": {
      request: { timeoutS: "number" },
      result: { traces: "number", maxAmplitude: "number", converged: "boolean" },
    }
  },
});
