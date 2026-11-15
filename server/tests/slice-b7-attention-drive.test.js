import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAttentionActions from "../domains/attention.js";

const actions = new Map();
registerAttentionActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`attention:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "attention", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("FIX-attention-003 / strategic-adds-006: distraction entries update + delete", () => {
  const e = call("distractionLog", { source: "Slack", kind: "notification", durationMinutes: 10 }).result.entry;
  const upd = call("distractionUpdate", { id: e.id, source: "Slack (phone)", durationMinutes: 25, note: "standup thread" });
  assert.equal(upd.ok, true);
  assert.equal(upd.result.entry.source, "Slack (phone)");
  assert.equal(upd.result.entry.durationMinutes, 25);
  assert.equal(upd.result.entry.kind, "notification"); // untouched fields keep
  assert.equal(call("distractionUpdate", { id: e.id, source: " " }).ok, false);
  assert.equal(call("distractionDelete", { id: e.id }).ok, true);
  assert.equal(call("distractionSummary", {}).result.total, 0);
});

test("FIX-strategic-adds-006: focus blocks update with conflict detection", () => {
  const today = new Date().toISOString().slice(0, 10);
  const a = call("calendarReserve", { date: today, startMinute: 540, durationMinutes: 60, title: "Deep work" }).result.block;
  call("calendarReserve", { date: today, startMinute: 660, durationMinutes: 60, title: "Second" });
  const upd = call("calendarUpdate", { blockId: a.id, title: "Deep work (moved)", startMinute: 570 });
  assert.equal(upd.ok, true);
  assert.equal(upd.result.block.title, "Deep work (moved)");
  assert.equal(upd.result.block.endMinute, 630);
  // Moving onto the second block conflicts and changes nothing.
  const clash = call("calendarUpdate", { blockId: a.id, startMinute: 660 });
  assert.equal(clash.ok, false);
  assert.equal(clash.error, "time_conflict");
  const blocks = call("calendarBlocks", { date: today }).result.blocks;
  assert.equal(blocks.find((b) => b.id === a.id).startMinute, 570);
});
