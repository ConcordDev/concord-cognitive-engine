/**
 * Engine entry — fenicsx (SXE-09, FEniCSx/DOLFINx + pyadjoint).
 *
 * Registered on import via engines/entries/index.js. The
 * framework resolves this env's Python: the conda env exists
 * only where provisioned, so presence tracks provisioning.
 * LGPL-3: the library is imported only inside the child
 * kernel process, never linked into Node — linkMode "process"
 * satisfies the manifest's GPL-family rule.
 *
 * Licence re-read from the pinned release (DOLFINx 0.11.0,
 * LGPL-3.0-or-later) at registration time, 2026-11-18.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-fenicsx.py");

defineEngine({
  id: "fenicsx",
  version: "0.11.0",
  licence: "LGPL-3.0-or-later",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_FENICSX_BIN",
  defaultPath: "/opt/concord-engines/fenicsx/bin/python",
  healthOp: "health",
  ops: ["health", "poisson", "elasticity"],
  kernel: KERNEL,
  installHint:
    "FEniCSx not provisioned on this host: provision the fenicsx conda env (fenics-dolfinx 0.11.0) at /opt/concord-engines/fenicsx (see docs/conkay/engines/fenicsx.md). Until then PDE tiers are NOT_COMPUTED engine_unavailable:fenicsx.",
  footprint: { diskMb: 1024, memoryMb: 1024, threads: 4 },
  timeoutMs: 300_000,
  opSchemas: {
    health: {
      request: {},
      result: { l2Error: "number", dofs: "number" },
    },
    poisson: {
      request: { nx: "number" },
      result: { l2Error: "number", dofs: "number" },
    },
    elasticity: {
      request: { traction: "number" },
      result: { tipDeflection: "number", beamTheory: "number", relDeviation: "number" },
    },
  },
});
