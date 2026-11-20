/**
 * Engine entry — energyplus (SXE-37, EnergyPlus).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * EnergyPlus building-energy simulation. Its BSD-3-style licence: the kernel drives the stock energyplus binary as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (EnergyPlus
 * 25.1.0, BSD-3-Clause (EnergyPlus licence)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-energyplus.py");

defineEngine({
  id: "energyplus",
  version: "25.1.0",
  licence: "BSD-3-Clause (EnergyPlus licence)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_ENERGYPLUS_BIN",
  defaultPath: "/opt/concord-engines/energyplus/bin/python",
  healthOp: "health",
  ops: ["health", "run"],
  kernel: KERNEL,
  installHint:
    "EnergyPlus not provisioned on this host: provision the EnergyPlus 25.1.0 install at /opt/concord-engines/energyplus (see docs/conkay/engines/energyplus.md). Until then building-energy tiers are NOT_COMPUTED engine_unavailable:energyplus.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 1200000,
  opSchemas: {
    "health": {
      request: {},
      result: { errLines: "number", esoLines: "number", converged: "boolean" },
    },
    "run": {
      request: { idfName: "string" },
      result: { errLines: "number", esoLines: "number", converged: "boolean" },
    }
  },
});
