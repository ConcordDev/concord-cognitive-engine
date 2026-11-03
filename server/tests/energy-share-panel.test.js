import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABSENT_ENERGY_SHARE_ACTIONS,
  recordedMonthlyKwh,
  estimatedBillUsd,
} from "../../concord-frontend/components/energy/share-actions.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = fs.readFileSync(
  path.join(here, "../../concord-frontend/components/energy/EnergyActionStack.tsx"),
  "utf8",
);

test("DM, publish, and optimize stay unavailable energy share actions", () => {
  assert.deepEqual(
    ABSENT_ENERGY_SHARE_ACTIONS.map((a) => a.id),
    ["dm", "publish", "optimize"],
  );
  for (const action of ABSENT_ENERGY_SHARE_ACTIONS) {
    assert.match(action.reason, /Not an energy action/);
    assert.doesNotMatch(action.reason, /coming soon/i);
  }
});

test("a blank month is not a zero bill; 800 kWh at 29.75¢ is $238", () => {
  assert.equal(recordedMonthlyKwh(""), null);
  assert.equal(recordedMonthlyKwh("   "), null);
  assert.equal(recordedMonthlyKwh("800kwh"), null);
  assert.equal(recordedMonthlyKwh("0"), 0);
  assert.equal(recordedMonthlyKwh("800"), 800);
  assert.equal(estimatedBillUsd(29.75, null), null);
  assert.equal(estimatedBillUsd(29.75, 800), 238);
  assert.equal(estimatedBillUsd(29.75, 0), 0);
  assert.equal(estimatedBillUsd(null, 800), null);
});

test("the share panel loads EIA rates and does not call message, publish, or agent endpoints", () => {
  assert.match(panel, /ABSENT_ENERGY_SHARE_ACTIONS/);
  assert.match(panel, /eia-electricity-rates/);
  assert.match(panel, /domain: 'dtu'/);
  assert.match(panel, /name: 'create'/);
  assert.doesNotMatch(panel, /chat_agent/);
  assert.doesNotMatch(panel, /\/api\/social\/dm/);
  assert.doesNotMatch(panel, /\/api\/dtus\//);
  assert.doesNotMatch(panel, /actDm|actPublish|actAgent/);
});
