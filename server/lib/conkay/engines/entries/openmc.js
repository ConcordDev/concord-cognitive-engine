/**
 * Engine entry — openmc (SXE-30, OpenMC).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenMC Monte Carlo neutron transport (+ the ENDF/B-VIII.0 library as environment data). MIT: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (OpenMC
 * 0.15.2, MIT) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openmc.py");

defineEngine({
  id: "openmc",
  version: "0.15.2",
  licence: "MIT",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENMC_BIN",
  defaultPath: "/opt/concord-engines/openmc/bin/python",
  healthOp: "health",
  ops: ["health", "godiva"],
  kernel: KERNEL,
  installHint:
    "OpenMC not provisioned on this host: provision the openmc driver env (OpenMC 0.15.2) plus the ENDF/B-VIII.0 library at /opt/concord-engines/openmc (see docs/conkay/engines/openmc.md). Until then transport tiers are NOT_COMPUTED engine_unavailable:openmc.",
  footprint: { diskMb: 4096, memoryMb: 2048, threads: 4 },
  timeoutMs: 3600000,
  opSchemas: {
    "health": {
      request: {},
      result: { keff: "number", keffStd: "number", expectedKeff: "number", converged: "boolean" },
    },
    "godiva": {
      request: { batches: "number", particles: "number" },
      result: { keff: "number", keffStd: "number", expectedKeff: "number", converged: "boolean" },
    }
  },
});
