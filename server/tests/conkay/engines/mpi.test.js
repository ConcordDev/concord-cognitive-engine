/**
 * SXE-39 — MPI lane (OpenMPI) entry + kernel suite.
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's own logic driven
 * directly against a stub launcher (a one-rank mpirun stand-in
 * + a one-rank mpi4py stand-in): the np=1 reduction is exact,
 * a launcher that starts fewer ranks than requested is
 * refused, np above the manifest cap is refused, and a
 * missing mpirun is named. The multi-rank reduction against
 * real OpenMPI is the CI lane's leg (conkay-engine-mpi.yml,
 * manual dispatch per F8): it runs when CONKAY_ENGINE_MPI_BIN
 * is set, and the lane fails if this suite skips there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getEngine, validateManifestEntry, runEngine, engineListReport,
} from "../../../lib/conkay/engines/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-mpi.py");
const ABSENT = { CONKAY_ENGINE_MPI_BIN: "/nonexistent/mpi/bin/python" };

test("mpi entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("mpi");
  assert.ok(entry, "mpi entry registered");
  assert.equal(entry.version, "5.0.11");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "mpi");
  assert.ok(row, "report carries the mpi row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent lane answers NOT_COMPUTED engine_unavailable:mpi", async () => {
  const r = await runEngine("mpi", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:mpi");
  assert.equal(r.provenance.version, "5.0.11");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("mpi", "reduce-sum", { np: "two" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:mpi");
  const noOp = await runEngine("mpi", "launch-the-fleet", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:mpi:launch-the-fleet");
});

/** Stub one-rank launcher + mpi4py, in a temp dir. */
function stubEnv() {
  const root = mkdtempSync(join(tmpdir(), "conkay-mpi-stub-"));
  const bin = join(root, "bin");
  const site = join(root, "site");
  const scratch = join(root, "scratch");
  mkdirSync(bin); mkdirSync(join(site, "mpi4py"), { recursive: true }); mkdirSync(scratch);
  writeFileSync(join(bin, "mpirun"),
    "#!/bin/sh\n# one-rank stand-in: run the worker (last arg) as rank 0 of 1\n" +
    "for last; do :; done\n" +
    "OMPI_COMM_WORLD_RANK=0 OMPI_COMM_WORLD_SIZE=1 exec python3 \"$last\"\n");
  chmodSync(join(bin, "mpirun"), 0o755);
  writeFileSync(join(site, "mpi4py", "__init__.py"),
    "from . import MPI\n");
  writeFileSync(join(site, "mpi4py", "MPI.py"),
    "import os\n" +
    "class _Op:\n    pass\n" +
    "SUM = _Op()\n" +
    "class _Comm:\n" +
    "    def Get_rank(self):\n        return int(os.environ.get('OMPI_COMM_WORLD_RANK', '0'))\n" +
    "    def Get_size(self):\n        return int(os.environ.get('OMPI_COMM_WORLD_SIZE', '1'))\n" +
    "    def reduce(self, value, op=None, root=0):\n        return value\n" +
    "COMM_WORLD = _Comm()\n");
  return {
    PATH: `${bin}:/usr/bin:/bin`,
    PYTHONPATH: site,
    CONKAY_ENGINE_SCRATCH: scratch,
  };
}

function runKernel(payload, env) {
  return spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
}

test("kernel: np=1 reduction is exact through the stub launcher", () => {
  const r = runKernel({ op: "reduce-sum", request: { np: 1 } }, stubEnv());
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.np, 1);
  assert.equal(out.total, 1);
  assert.equal(out.expectedTotal, 1);
});

test("kernel: a launcher honouring fewer ranks than requested is refused", () => {
  const r = runKernel({ op: "reduce-sum", request: { np: 2 } }, stubEnv());
  assert.equal(r.status, 4);
  assert.match(r.stderr, /launcher honoured np=1 of the requested np=2/);
});

test("kernel: np above the manifest cap is refused before spawn", () => {
  const r = runKernel({ op: "reduce-sum", request: { np: 9 } }, stubEnv());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /np=9 exceeds the manifest cap of 8/);
});

test("kernel: missing mpirun is named, never fabricated around", () => {
  const env = stubEnv();
  env.PATH = "/nonexistent-bin";
  const r = runKernel({ op: "health", request: {} }, env);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /mpirun executable not found/);
});

test("real lane: health through runEngine (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_MPI_BIN) {
    t.skip("CONKAY_ENGINE_MPI_BIN unset — real OpenMPI leg runs in the CI lane");
    return;
  }
  const r = await runEngine("mpi", "health", {}, { fresh: true });
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.total, 3);
  assert.equal(r.outputs.np, 2);
});
