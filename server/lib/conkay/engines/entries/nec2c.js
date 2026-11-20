/**
 * Engine entry — nec2c (SXE-17, NEC2 (nec2c)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * NEC2 method-of-moments antenna modelling via the nec2c translator. Public domain: the kernel drives the stock nec2c binary as a separate process.
 *
 * Licence as catalogued for the pinned release (NEC2 (nec2c)
 * 1.3.1, Public domain) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-nec2c.py");

defineEngine({
  id: "nec2c",
  version: "1.3.1",
  licence: "Public domain",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_NEC2C_BIN",
  defaultPath: "/opt/concord-engines/nec2c/bin/python",
  healthOp: "health",
  ops: ["health", "dipole-impedance"],
  kernel: KERNEL,
  installHint:
    "nec2c not provisioned on this host: provision the nec2c 1.3.1 binary on PATH plus the driver env at /opt/concord-engines/nec2c (see docs/conkay/engines/nec2c.md). Until then antenna tiers are NOT_COMPUTED engine_unavailable:nec2c.",
  footprint: { diskMb: 128, memoryMb: 256, threads: 1 },
  timeoutMs: 180000,
  opSchemas: {
    "health": {
      request: {},
      result: { resistanceOhm: "number", reactanceOhm: "number", expectedResistanceOhm: "number", expectedReactanceOhm: "number", absErrorR: "number", absErrorX: "number", converged: "boolean" },
    },
    "dipole-impedance": {
      request: { frequencyMHz: "number" },
      result: { resistanceOhm: "number", reactanceOhm: "number", expectedResistanceOhm: "number", expectedReactanceOhm: "number", absErrorR: "number", absErrorX: "number", converged: "boolean" },
    }
  },
});
