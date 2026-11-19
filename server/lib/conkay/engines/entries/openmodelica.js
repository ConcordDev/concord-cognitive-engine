/**
 * Engine entry — openmodelica (SXE-15, OpenModelica + MSL).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenModelica system simulation (Modelica + the Modelica Standard Library). OSMC-PL/GPL-3: the kernel DRIVES the omc binary as a separate process and imports nothing of it — linkMode "process" satisfies the manifest's GPL rule.
 *
 * Licence as catalogued for the pinned release (OpenModelica + MSL
 * 1.25.0, OSMC-PL/GPL-3.0-only (process); MSL BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openmodelica.py");

defineEngine({
  id: "openmodelica",
  version: "1.25.0",
  licence: "OSMC-PL/GPL-3.0-only (process); MSL BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENMODELICA_BIN",
  defaultPath: "/opt/concord-engines/openmodelica/bin/python",
  healthOp: "health",
  ops: ["health", "first"],
  kernel: KERNEL,
  installHint:
    "OpenModelica not provisioned on this host: install OpenModelica 1.25.0 and provision the driver env at /opt/concord-engines/openmodelica (see docs/conkay/engines/openmodelica.md). Until then system-simulation tiers are NOT_COMPUTED engine_unavailable:openmodelica.",
  footprint: { diskMb: 2048, memoryMb: 1024, threads: 2 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { wFinal: "number", expectedW: "number", relError: "number" },
    },
    "first": {
      request: { inertia: "number", torque: "number", tEnd: "number" },
      result: { wFinal: "number", expectedW: "number", relError: "number" },
    }
  },
});
