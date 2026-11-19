/**
 * Engine entry — control (SXE-20, python-control (+ slycot)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * python-control control-systems library. BSD-3; its slycot dependency is GPL-2 and runs only inside this child kernel process, never linked into Node — the licence string records that split and linkMode "process" satisfies the GPL rule.
 *
 * Licence as catalogued for the pinned release (python-control (+ slycot)
 * 0.10.1, BSD-3-Clause; slycot GPL-2.0-only (child process)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-control.py");

defineEngine({
  id: "control",
  version: "0.10.1",
  licence: "BSD-3-Clause; slycot GPL-2.0-only (child process)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_CONTROL_BIN",
  defaultPath: "/opt/concord-engines/control/bin/python",
  healthOp: "health",
  ops: ["health", "lqr"],
  kernel: KERNEL,
  installHint:
    "python-control not provisioned on this host: provision the control driver env (python-control 0.10.1 + slycot) at /opt/concord-engines/control (see docs/conkay/engines/control.md). Until then control-design tiers are NOT_COMPUTED engine_unavailable:control.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 2 },
  timeoutMs: 120000,
  opSchemas: {
    "health": {
      request: {},
      result: { k: "array", kAnalytic: "array", maxRelError: "number", closedLoopStable: "boolean" },
    },
    "lqr": {
      request: { q1: "number", q2: "number", r: "number" },
      result: { k: "array", kAnalytic: "array", maxRelError: "number", closedLoopStable: "boolean" },
    }
  },
});
