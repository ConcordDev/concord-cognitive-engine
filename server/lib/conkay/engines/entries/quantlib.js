/**
 * Engine entry — quantlib (SXE-23, QuantLib).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * QuantLib financial calculation (SXE-23: calculation only — payments are untouched by this engine). Modified BSD: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (QuantLib
 * 1.40, BSD-3-Clause (QuantLib modified BSD)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-quantlib.py");

defineEngine({
  id: "quantlib",
  version: "1.40",
  licence: "BSD-3-Clause (QuantLib modified BSD)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_QUANTLIB_BIN",
  defaultPath: "/opt/concord-engines/quantlib/bin/python",
  healthOp: "health",
  ops: ["health", "european-call"],
  kernel: KERNEL,
  installHint:
    "QuantLib not provisioned on this host: provision the quantlib driver env (QuantLib-Python 1.40) at /opt/concord-engines/quantlib (see docs/conkay/engines/quantlib.md). Until then finance tiers are NOT_COMPUTED engine_unavailable:quantlib.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 2 },
  timeoutMs: 120000,
  opSchemas: {
    "health": {
      request: {},
      result: { price: "number", expectedPrice: "number", relError: "number" },
    },
    "european-call": {
      request: { spot: "number", strike: "number", rate: "number", vol: "number", tYears: "number", dividend: "number" },
      result: { price: "number", expectedPrice: "number", relError: "number" },
    }
  },
});
