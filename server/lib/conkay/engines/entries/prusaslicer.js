/**
 * Engine entry — prusaslicer (SXE-38, PrusaSlicer additive slicer).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * PrusaSlicer additive-manufacturing slicer. AGPL-3: runs UNMODIFIED as a separate process (founder F7 rule; the manifest validator enforces unmodified: true on AGPL entries) — the kernel only ever invokes the stock CLI.
 *
 * Licence as catalogued for the pinned release (PrusaSlicer additive slicer
 * 2.9.0, AGPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-prusaslicer.py");

defineEngine({
  id: "prusaslicer",
  version: "2.9.0",
  licence: "AGPL-3.0-only",
  linkMode: "process",
  unmodified: true,
  envVar: "CONKAY_ENGINE_PRUSASLICER_BIN",
  defaultPath: "/opt/concord-engines/prusaslicer/bin/python",
  healthOp: "health",
  ops: ["health", "slice"],
  kernel: KERNEL,
  installHint:
    "PrusaSlicer not provisioned on this host: install the unmodified PrusaSlicer 2.9.0 CLI and provision the driver env at /opt/concord-engines/prusaslicer (see docs/conkay/engines/prusaslicer.md). Until then slicing tiers are NOT_COMPUTED engine_unavailable:prusaslicer.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 4 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { timeS: "number", layers: "number" },
    },
    "slice": {
      request: { sizeMm: "number", layerHeightMm: "number", infillPct: "number" },
      result: { timeS: "number", layers: "number" },
    }
  },
});
