// USB Blend D, every aspect: every NOT_COMPUTED reason maps to a named missing input, and the committed
// status document is the rendered one. Values in it are model results, not measurements.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderStatus, GAPS, gapsFor } from "../lib/conkay/demos/blend-d-status.js";

const r = renderStatus();

describe("USB Blend D status", () => {
  it("every NOT_COMPUTED reason, in every case, maps to a missing input with a way to obtain it", () => {
    assert.deepEqual(r.unmapped, []);
    for (const x of GAPS) assert.ok(x.input && x.obtain, x.id);
  });
  it("a reason naming two inputs counts for both", () => {
    const ids = gapsFor("no cited thermal conductivity for: hdpe-hc-co-polymer, basalt-fiber (any unknown phase …)").map((x) => x.id);
    assert.deepEqual(ids.sort(), ["basalt-k", "copolymer"]);
    assert.ok(r.blocked.get("copolymer").has("material.k-multiphase"));
  });
  it("the filler shapes unblock the most checks", () => {
    const n = (id) => r.blocked.get(id).size;
    for (const x of GAPS) assert.ok(n("shapes") >= n(x.id), x.id);
  });
  it("the committed document is the rendered one", () => {
    const file = readFileSync(fileURLToPath(new URL("../lib/conkay/knowledge/USB-BLEND-D-STATUS.md", import.meta.url)), "utf8");
    assert.equal(file, r.markdown);
    assert.match(file, /one ash test decides/);
  });
});
