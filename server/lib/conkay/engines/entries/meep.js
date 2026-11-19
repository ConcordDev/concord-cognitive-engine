/**
 * Engine entry — meep (SXE-18, Meep FDTD).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Meep FDTD electromagnetics (the plan's existing-Meep row, generalised to the SXE-00 framework). GPL-2: imported only inside the child kernel process, never linked into Node.
 *
 * Licence as catalogued for the pinned release (Meep FDTD
 * 1.31.0, GPL-2.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-meep.py");

defineEngine({
  id: "meep",
  version: "1.31.0",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_MEEP_BIN",
  defaultPath: "/opt/concord-engines/meep/bin/python",
  healthOp: "health",
  ops: ["health", "fabry-perot"],
  kernel: KERNEL,
  installHint:
    "Meep not provisioned on this host: provision the meep conda env (pymeep 1.31.0, conda-forge) at /opt/concord-engines/meep (see docs/conkay/engines/meep.md). Until then FDTD tiers are NOT_COMPUTED engine_unavailable:meep.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 4 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { tMeepMid: "number", tTmmMid: "number", maxAbsDiff: "number" },
    },
    "fabry-perot": {
      request: { slabIndex: "number", slabThickness: "number", resolution: "number" },
      result: { tMeepMid: "number", tTmmMid: "number", maxAbsDiff: "number" },
    }
  },
});
