/**
 * Engine entry — casadi (SXE-20, CasADi).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * CasADi nonlinear optimisation / algorithmic differentiation. LGPL-3: imported only inside the child kernel process, never linked into Node — linkMode "process" satisfies the manifest's GPL-family rule.
 *
 * Licence as catalogued for the pinned release (CasADi
 * 3.7.0, LGPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-casadi.py");

defineEngine({
  id: "casadi",
  version: "3.7.0",
  licence: "LGPL-3.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_CASADI_BIN",
  defaultPath: "/opt/concord-engines/casadi/bin/python",
  healthOp: "health",
  ops: ["health", "nlp"],
  kernel: KERNEL,
  installHint:
    "CasADi not provisioned on this host: provision the casadi driver env (casadi 3.7.0) at /opt/concord-engines/casadi (see docs/conkay/engines/casadi.md). Until then CasADi tiers are NOT_COMPUTED engine_unavailable:casadi.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 2 },
  timeoutMs: 120000,
  opSchemas: {
    "health": {
      request: {},
      result: { x: "number", y: "number", objective: "number", expectedX: "number", expectedY: "number", expectedObjective: "number", maxRelError: "number" },
    },
    "nlp": {
      request: { cx: "number", cy: "number", s: "number" },
      result: { x: "number", y: "number", objective: "number", expectedX: "number", expectedY: "number", expectedObjective: "number", maxRelError: "number" },
    }
  },
});
