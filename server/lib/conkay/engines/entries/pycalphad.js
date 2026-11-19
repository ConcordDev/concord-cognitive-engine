/**
 * Engine entry — pycalphad (SXE-24, pycalphad).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * pycalphad CALPHAD equilibria from OPEN thermodynamic databases (the TDB is environment data with its provenance recorded in the doc; no paid databases, ever). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (pycalphad
 * 0.11.0, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pycalphad.py");

defineEngine({
  id: "pycalphad",
  version: "0.11.0",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PYCALPHAD_BIN",
  defaultPath: "/opt/concord-engines/pycalphad/bin/python",
  healthOp: "health",
  ops: ["health", "equilibrium"],
  kernel: KERNEL,
  installHint:
    "pycalphad not provisioned on this host: provision the pycalphad driver env (pycalphad 0.11.0) plus an open TDB at /opt/concord-engines/pycalphad (see docs/conkay/engines/pycalphad.md). Until then CALPHAD tiers are NOT_COMPUTED engine_unavailable:pycalphad.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { phases: "array", fractionSum: "number" },
    },
    "equilibrium": {
      request: { components: "array", tK: "number", xSecond: "number" },
      result: { phases: "array", fractionSum: "number" },
    }
  },
});
