/**
 * Engine entry — petsc (SXE-03, PETSc + SLEPc).
 *
 * Registered on import via engines/entries/index.js. Per
 * SOLVER-ENGINES-PLAN.md §2, PETSc installs INTO the FEniCSx
 * env (conda-forge petsc4py/slepc4py), so this entry's
 * defaultPath deliberately names the fenicsx env's Python;
 * the env var is its own (CONKAY_ENGINE_PETSC_BIN) so a
 * split install can override it. The footprint is the
 * marginal petsc4py/slepc4py increment inside that env.
 *
 * Licence re-read from the pinned release (PETSc 3.24,
 * BSD-2-Clause) at registration time, 2026-11-18; the
 * conda-forge pairing (petsc 3.24.x with dolfinx 0.11) is
 * re-read at lane build time per the plan.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-petsc.py");

defineEngine({
  id: "petsc",
  version: "3.24.0",
  licence: "BSD-2-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PETSC_BIN",
  defaultPath: "/opt/concord-engines/fenicsx/bin/python",
  healthOp: "health",
  ops: ["health", "ksp-poisson1d", "eigen"],
  kernel: KERNEL,
  installHint:
    "PETSc not provisioned on this host: provision the fenicsx conda env with petsc4py/slepc4py 3.24 (PETSc installs into the FEniCSx env — see docs/conkay/engines/petsc.md). Until then sparse-solver tiers are NOT_COMPUTED engine_unavailable:petsc.",
  footprint: { diskMb: 614, memoryMb: 512, threads: 4 },
  timeoutMs: 300_000,
  opSchemas: {
    health: {
      request: {},
      result: { maxError: "number", iterations: "number" },
    },
    "ksp-poisson1d": {
      request: { n: "number" },
      result: { maxError: "number", iterations: "number" },
    },
    eigen: {
      request: { n: "number" },
      result: { eigenvalue: "number", exactEigenvalue: "number", relError: "number" },
    },
  },
});
