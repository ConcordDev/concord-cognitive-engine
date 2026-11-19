/**
 * Engine entry — calculix (SXE-07, CalculiX FEA).
 *
 * Registered on import via engines/entries/index.js. The
 * framework resolves this lane's driver-env Python; the
 * kernel it runs shells out to `ccx` on PATH (provisioned
 * alongside the env on a host). GPL-2: CalculiX stays
 * across the process boundary — linkMode "process" is the
 * manifest rule for GPL engines, and nothing of CalculiX
 * is imported or linked by this code.
 *
 * Licence re-read from the pinned release (CalculiX 2.23,
 * GPL-2.0-only) at registration time, 2026-11-18.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-calculix.py");

defineEngine({
  id: "calculix",
  version: "2.23",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_CALCULIX_BIN",
  defaultPath: "/opt/concord-engines/calculix/bin/python",
  healthOp: "health",
  ops: ["health", "tension", "cantilever"],
  kernel: KERNEL,
  installHint:
    "CalculiX not provisioned on this host: provision the calculix driver env plus ccx 2.23 at /opt/concord-engines/calculix (see docs/conkay/engines/calculix.md). Until then structural FEA tiers are NOT_COMPUTED engine_unavailable:calculix.",
  footprint: { diskMb: 128, memoryMb: 512, threads: 4 },
  timeoutMs: 300_000,
  opSchemas: {
    health: {
      request: {},
      result: {
        stress: "number", stressExact: "number", deflection: "number",
        deflectionExact: "number", maxRelError: "number",
      },
    },
    tension: {
      request: {},
      result: {
        stress: "number", stressExact: "number", deflection: "number",
        deflectionExact: "number", maxRelError: "number",
      },
    },
    cantilever: {
      request: {
        length: "number", height: "number", load: "number",
        e: "number", nu: "number", nx: "number",
      },
      result: { tipDeflection: "number", beamTheory: "number", relDeviation: "number" },
    },
  },
});
