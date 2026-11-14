// GB-1538 / FIX-grounding-003 (server leg) — record_reading stored any
// value as given ('abc', NaN, objects). recordSensorReading in the
// monolith now mirrors the sensor lens's rule (domains/sensor.js
// reading-record): coerce with Number, require finite, refuse with
// 'numeric value required'; a supplied timestamp must parse.
// The function is monolith-bound, so this test slices its exact shipped
// source out of server.js and runs it against stubbed deps — the
// assertions exercise the real code text, not a copy.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const serverSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");
const lines = serverSrc.split("\n");
const startLine = lines.findIndex((l) => l.startsWith("function recordSensorReading("));
assert.ok(startLine >= 0, "recordSensorReading not found in server.js");
let endLine = startLine + 1;
while (endLine < lines.length && lines[endLine] !== "}") endLine++;
assert.ok(endLine < lines.length, "recordSensorReading closing brace not found");
const fnSrc = lines.slice(startLine, endLine + 1).join("\n");

function makeHarness() {
  const STATE = {
    grounding: {
      sensors: new Map([["s1", { id: "s1", name: "Thermo", type: "TEMPERATURE", unit: "C" }]]),
      readings: [],
      stats: { readingsRecorded: 0 },
      config: { maxReadings: 1000 },
    },
  };
  let n = 0;
  const factory = new Function(
    "ensureGroundingEngine", "STATE", "uid", "nowISO", "saveStateDebounced",
    `return (${fnSrc});`,
  );
  const fn = factory(
    () => {},
    STATE,
    (p) => `${p}_${++n}`,
    () => "2026-11-14T00:00:00.000Z",
    () => {},
  );
  return { fn, STATE };
}

describe("grounding recordSensorReading validation (FIX-grounding-003)", () => {
  it("a non-numeric value is refused by name and nothing is stored", () => {
    const { fn, STATE } = makeHarness();
    const r = fn("s1", "abc");
    assert.equal(r.ok, false);
    assert.equal(r.error, "numeric value required");
    assert.equal(STATE.grounding.readings.length, 0);
  });

  it("NaN and object values are refused the same way", () => {
    const { fn } = makeHarness();
    assert.equal(fn("s1", NaN).error, "numeric value required");
    assert.equal(fn("s1", { v: 1 }).error, "numeric value required");
    assert.equal(fn("s1", undefined).error, "numeric value required");
  });

  it("a numeric value is stored as a number (numeric strings coerce, per the sensor lens)", () => {
    const { fn, STATE } = makeHarness();
    const r = fn("s1", "21.5");
    assert.equal(r.ok, true);
    assert.equal(r.reading.value, 21.5);
    assert.equal(typeof STATE.grounding.readings[0].value, "number");
  });

  it("an unparseable timestamp is refused; a parseable one is kept", () => {
    const { fn } = makeHarness();
    assert.equal(fn("s1", 10, "not-a-date").error, "invalid timestamp");
    const ok = fn("s1", 10, "2026-11-14T10:00:00.000Z");
    assert.equal(ok.ok, true);
    assert.equal(ok.reading.timestamp, "2026-11-14T10:00:00.000Z");
  });

  it("an unknown sensor still reads 'Sensor not found' (no behaviour drift)", () => {
    const { fn } = makeHarness();
    assert.equal(fn("nope", 10).error, "Sensor not found");
  });
});
