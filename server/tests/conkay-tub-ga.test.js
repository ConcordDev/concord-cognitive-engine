// server/tests/conkay-tub-ga.test.js
//
// The tub sheets tag every dimension C / D / S and state the joint type.
// The live car's numbers are checked in conkay-car-tub.test.js, which already
// builds the car. This fixture checks the sheet contract without a frame solve.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTubGaSheets } from "../lib/conkay/drawings/tub-ga.js";

describe("tub GA sheets", () => {
  it("tags every listed dimension and records bonded+riveted joints with no welds", () => {
    const sheets = buildTubGaSheets({
      nodes: [{ id: "a", x: 0, y: 0.4, z: 0.3 }, { id: "b", x: 2, y: 0.4, z: 0.3 }, { id: "c", x: 2, y: -0.4, z: 0.3 }],
      members: [{ id: "sill-1", i: "a", j: "b" }, { id: "fw", i: "b", j: "c" }],
      dims: [
        { body: "Sill section 90 mm x 280 mm wall 4 mm", tag: "D" },
        { body: "Wheelbase 2450 mm", tag: "C" },
        { body: "Screening target 10800 N.m/deg", tag: "S" },
      ],
      joints: [
        { part: "TUB_SILL_L", type: "bonded+riveted", weld: false, count: 4, tag: "D" },
        { part: "TUB_FLOOR_L", type: "bonded+riveted", weld: false, count: 1, tag: "D" },
      ],
      sheet3: [
        { body: "With panels 12222 N.m/deg", tag: "C" },
        { body: "not an artifact of the equivalent-diagonal panels", tag: null },
      ],
    });
    assert.equal(sheets.length, 3);
    const tagged = sheets.flatMap((sh) => sh.items.filter((it) => it.tag));
    assert.ok(tagged.length >= 5);
    for (const it of tagged) assert.ok(/ [CDS]$/.test(it.s), it.s);
    const blob = sheets.flatMap((sh) => sh.items.filter((it) => it.t === "text").map((it) => it.s)).join("\n");
    assert.match(blob, /bonded\+riveted, weld no/);
    assert.doesNotMatch(blob, /weld yes/);
    assert.match(blob, /12222/);
    assert.equal(sheets[0].items.filter((it) => it.t === "line").length > 0, true);
  });
});
