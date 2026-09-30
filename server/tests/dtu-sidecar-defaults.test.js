import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, "../lib/sidecars/dtu-sidecar-client.js");

function evalFlags(env) {
  const code = `
    process.env.CONCORD_DTU_SIDECAR = ${JSON.stringify(env.CONCORD_DTU_SIDECAR ?? "")};
    process.env.CONCORD_WALLET_SIDECAR = ${JSON.stringify(env.CONCORD_WALLET_SIDECAR ?? "")};
    process.env.CONCORD_SESSION_SIDECAR = ${JSON.stringify(env.CONCORD_SESSION_SIDECAR ?? "")};
    const m = await import(${JSON.stringify(CLIENT)});
    console.log(JSON.stringify({ ENABLED: m.ENABLED, WALLET_ENABLED: m.WALLET_ENABLED, SESSION_ENABLED: m.SESSION_ENABLED }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}

describe("dtu-sidecar wallet/session defaults", () => {
  it("defaults wallet+session ON when DTU sidecar on and flags unset", () => {
    const f = evalFlags({ CONCORD_DTU_SIDECAR: "1" });
    assert.equal(f.ENABLED, true);
    assert.equal(f.WALLET_ENABLED, true);
    assert.equal(f.SESSION_ENABLED, true);
  });
  it("explicit 0 disables even when DTU on", () => {
    const f = evalFlags({ CONCORD_DTU_SIDECAR: "1", CONCORD_WALLET_SIDECAR: "0", CONCORD_SESSION_SIDECAR: "0" });
    assert.equal(f.WALLET_ENABLED, false);
    assert.equal(f.SESSION_ENABLED, false);
  });
  it("off when DTU off and flags unset", () => {
    const f = evalFlags({ CONCORD_DTU_SIDECAR: "0" });
    assert.equal(f.WALLET_ENABLED, false);
    assert.equal(f.SESSION_ENABLED, false);
  });
});
