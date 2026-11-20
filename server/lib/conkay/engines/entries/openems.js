/**
 * Engine entry — openems (SXE-17, openEMS).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * openEMS free-space FDTD electromagnetics. GPL-3: the kernel drives the openEMS Python bindings inside its own child process only.
 *
 * Licence as catalogued for the pinned release (openEMS
 * 0.0.35, GPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openems.py");

defineEngine({
  id: "openems",
  version: "0.0.35",
  licence: "GPL-3.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENEMS_BIN",
  defaultPath: "/opt/concord-engines/openems/bin/python",
  healthOp: "health",
  ops: ["health", "dipole-impedance"],
  kernel: KERNEL,
  installHint:
    "openEMS not provisioned on this host: provision the openEMS conda env (openEMS 0.0.35, conda-forge) at /opt/concord-engines/openems (see docs/conkay/engines/openems.md). Until then FDTD tiers are NOT_COMPUTED engine_unavailable:openems.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 4 },
  timeoutMs: 900000,
  opSchemas: {
    "health": {
      request: {},
      result: { resistanceOhm: "number", reactanceOhm: "number", converged: "boolean" },
    },
    "dipole-impedance": {
      request: { freqGHz: "number" },
      result: { resistanceOhm: "number", reactanceOhm: "number", converged: "boolean" },
    }
  },
});
