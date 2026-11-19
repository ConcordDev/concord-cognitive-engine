/**
 * Engine entry — phreeqc (SXE-24, PHREEQC (via phreeqpy)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * PHREEQC aqueous geochemistry via phreeqpy/IPhreeqc (USGS public domain; the library runs inside this child kernel process only).
 *
 * Licence as catalogued for the pinned release (PHREEQC (via phreeqpy)
 * 3.8.6, Public domain (USGS)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-phreeqc.py");

defineEngine({
  id: "phreeqc",
  version: "3.8.6",
  licence: "Public domain (USGS)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PHREEQC_BIN",
  defaultPath: "/opt/concord-engines/phreeqc/bin/python",
  healthOp: "health",
  ops: ["health", "example1"],
  kernel: KERNEL,
  installHint:
    "PHREEQC not provisioned on this host: provision the phreeqc driver env (phreeqpy + IPhreeqc 3.8.6) at /opt/concord-engines/phreeqc (see docs/conkay/engines/phreeqc.md). Until then aqueous-geochemistry tiers are NOT_COMPUTED engine_unavailable:phreeqc.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 120000,
  opSchemas: {
    "health": {
      request: {},
      result: { ph: "number", expectedPh: "number", absError: "number" },
    },
    "example1": {
      request: { tempC: "number" },
      result: { ph: "number", expectedPh: "number", absError: "number" },
    }
  },
});
