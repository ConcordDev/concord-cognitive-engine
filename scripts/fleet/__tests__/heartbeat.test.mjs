// HV-04 acceptance pin (MEGA_PLAN.md §3, HV-G0): with an injected clock, a
// 31-minute-old heartbeat yields exactly one flag line; 29 minutes yields
// none. Fails pristine (no scripts/fleet/heartbeat.mjs), passes fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../heartbeat.mjs", import.meta.url));
const T0 = Date.parse("2026-11-14T12:00:00.000Z");
const MIN = 60 * 1000;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv04-"));
  const hbDir = path.join(dir, "heartbeats");
  const bridge = path.join(dir, "FLEET-BRIDGE.md");
  fs.writeFileSync(bridge, "");
  // Append-only stand-in for bridge-append: appends the stdin body verbatim.
  // The real bridge-append adds a GB heading around the same body line and
  // never edits past entries; the pin counts NOTE lines, which is the
  // behaviour HV-04 specifies.
  const stub = path.join(dir, "bridge-append");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs = require("fs");\nlet d="";process.stdin.on("data",c=>d+=c).on("end",()=>fs.appendFileSync(process.env.BRIDGE_FILE,d));\n`
  );
  fs.chmodSync(stub, 0o755);
  const env = {
    ...process.env,
    HEARTBEAT_DIR: hbDir,
    HEARTBEAT_BRIDGE_APPEND: stub,
    BRIDGE_FILE: bridge,
  };
  const run = (argv, now) =>
    spawnSync(process.execPath, [SCRIPT, ...argv], {
      env: { ...env, HEARTBEAT_NOW: String(now) },
      encoding: "utf8",
    });
  const notes = () =>
    fs
      .readFileSync(bridge, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("NOTE: "));
  return { run, notes };
}

test("HV-04 pin: 29m silent yields no flag; 31m yields exactly one; one per silence", () => {
  const { run, notes } = fixture();
  let r = run(["beat", "B10", "--claim", "CB-0629"], T0);
  assert.equal(r.status, 0, r.stderr);

  r = run(["watch"], T0 + 29 * MIN);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(notes().length, 0, "29 minutes of silence must not flag");

  r = run(["watch"], T0 + 31 * MIN);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(notes(), ["NOTE: B10 SILENT 30m on CB-0629"]);

  r = run(["watch"], T0 + 55 * MIN);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(notes().length, 1, "the same silence must not flag twice");

  // A fresh beat re-arms: a second, separate silence flags a second time.
  r = run(["beat", "B10", "--claim", "CB-0629"], T0 + 60 * MIN);
  assert.equal(r.status, 0, r.stderr);
  r = run(["watch"], T0 + 91 * MIN);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(notes().length, 2, "a new silence episode flags again");

  // A released claim is never flagged.
  r = run(["release", "B10"], T0 + 92 * MIN);
  assert.equal(r.status, 0, r.stderr);
  r = run(["watch"], T0 + 200 * MIN);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(notes().length, 2, "released claims stay silent");
});
