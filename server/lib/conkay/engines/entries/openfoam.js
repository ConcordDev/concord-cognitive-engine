/**
 * Engine entry — openfoam (SXE-11, OpenFOAM CFD).
 *
 * Registered on import via engines/entries/index.js. The
 * framework resolves this lane's driver-env Python; the
 * kernel it runs drives blockMesh / icoFoam / postProcess
 * on PATH. GPL-3: OpenFOAM stays across the process
 * boundary — linkMode "process" is the manifest rule for
 * GPL engines.
 *
 * DISTRIBUTION PIN (F3): version "2406" is the ESI
 * (openfoam.com) line — the SOLVER-ENGINES-PLAN.md F3
 * safe default, recorded here expressly pending the
 * founder's express F3 ruling. The kernel is
 * distribution-agnostic, so a flip to the Foundation
 * line is a one-line pin + provisioning change.
 * Licence GPL-3.0-only re-read from the pinned release
 * at registration time, 2026-11-18.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openfoam.py");

const CAVITY_RESULT = {
  maxDeviation: "number", uY08516: "number", uY06172: "number",
  uY04531: "number", uY01719: "number", uLid: "number",
};

defineEngine({
  id: "openfoam",
  version: "2406",
  licence: "GPL-3.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENFOAM_BIN",
  defaultPath: "/opt/concord-engines/openfoam/bin/python",
  healthOp: "health",
  ops: ["health", "cavity"],
  kernel: KERNEL,
  installHint:
    "OpenFOAM not provisioned on this host: provision OpenFOAM v2406 (ESI line — F3 safe default, pending the founder's F3 ruling) plus the driver env at /opt/concord-engines/openfoam (see docs/conkay/engines/openfoam.md). Until then CFD tiers are NOT_COMPUTED engine_unavailable:openfoam.",
  footprint: { diskMb: 2048, memoryMb: 1024, threads: 4 },
  timeoutMs: 900_000,
  opSchemas: {
    health: { request: {}, result: CAVITY_RESULT },
    cavity: { request: { endTime: "number" }, result: CAVITY_RESULT },
  },
});
