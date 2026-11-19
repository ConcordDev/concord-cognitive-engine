/**
 * Engine entry — acados (SXE-20, acados).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * acados fast nonlinear optimal control. BSD-2: imported only inside the child kernel process (its code generation and compiled solvers live and die in that process) — linkMode "process" regardless.
 *
 * Licence as catalogued for the pinned release (acados
 * 0.5.0, BSD-2-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-acados.py");

defineEngine({
  id: "acados",
  version: "0.5.0",
  licence: "BSD-2-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_ACADOS_BIN",
  defaultPath: "/opt/concord-engines/acados/bin/python",
  healthOp: "health",
  ops: ["health", "ocp"],
  kernel: KERNEL,
  installHint:
    "acados not provisioned on this host: provision the acados driver env (acados 0.5.0 + acados_template) at /opt/concord-engines/acados (see docs/conkay/engines/acados.md). Until then acados tiers are NOT_COMPUTED engine_unavailable:acados.",
  footprint: { diskMb: 1024, memoryMb: 1024, threads: 2 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { u0: "number", u0Reference: "number", relError: "number", pFinal: "number" },
    },
    "ocp": {
      request: { p0: "number", nSteps: "number", tFinal: "number" },
      result: { u0: "number", u0Reference: "number", relError: "number", pFinal: "number" },
    }
  },
});
