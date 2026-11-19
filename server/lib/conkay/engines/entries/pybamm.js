/**
 * Engine entry — pybamm (SXE-25, PyBaMM battery modelling).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * PyBaMM battery modelling (depends on the SXE-20 controls env pattern, not its binaries). BSD-3: imported only inside the child kernel process — linkMode "process" regardless.
 *
 * Licence as catalogued for the pinned release (PyBaMM battery modelling
 * 25.1.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pybamm.py");

defineEngine({
  id: "pybamm",
  version: "25.1.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PYBAMM_BIN",
  defaultPath: "/opt/concord-engines/pybamm/bin/python",
  healthOp: "health",
  ops: ["health", "discharge"],
  kernel: KERNEL,
  installHint:
    "PyBaMM not provisioned on this host: provision the pybamm driver env (PyBaMM 25.1.0) at /opt/concord-engines/pybamm (see docs/conkay/engines/pybamm.md). Until then battery tiers are NOT_COMPUTED engine_unavailable:pybamm.",
  footprint: { diskMb: 1024, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { capacityAh: "number", nominalAh: "number", relDeviation: "number" },
    },
    "discharge": {
      request: { cRate: "number" },
      result: { capacityAh: "number", nominalAh: "number", relDeviation: "number" },
    }
  },
});
