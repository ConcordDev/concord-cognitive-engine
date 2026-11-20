/**
 * Engine entry — bempp-cl (SXE-34, bempp-cl).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * bempp-cl boundary-element method (exterior Helmholtz). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (bempp-cl
 * 0.4.2, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-bempp-cl.py");

defineEngine({
  id: "bempp-cl",
  version: "0.4.2",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_BEMPP_CL_BIN",
  defaultPath: "/opt/concord-engines/bempp-cl/bin/python",
  healthOp: "health",
  ops: ["health", "scatter"],
  kernel: KERNEL,
  installHint:
    "bempp-cl not provisioned on this host: provision the bempp-cl driver env (0.4.2) at /opt/concord-engines/bempp-cl (see docs/conkay/engines/bempp-cl.md). Until then BEM tiers are NOT_COMPUTED engine_unavailable:bempp-cl.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 2 },
  timeoutMs: 900000,
  opSchemas: {
    "health": {
      request: {},
      result: { farFieldAbs: "number", expectedFarFieldAbs: "number", relError: "number", converged: "boolean" },
    },
    "scatter": {
      request: { wavenumber: "number" },
      result: { farFieldAbs: "number", expectedFarFieldAbs: "number", relError: "number", converged: "boolean" },
    }
  },
});
