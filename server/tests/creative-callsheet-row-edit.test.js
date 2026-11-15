// FIX-creative-007 — call sheet rows and calendar events can be edited.
// Pins:
//  1. callsheet-update-row changes a cast row's fields in place and the
//     general call recomputes from the earliest cast/crew call time.
//  2. Row edits are owner-scoped: another user's sheet/row ids do not
//     resolve, and an unknown row id is refused.
//  3. A required field cannot be blanked (cast name / scene).
//  4. calendar-update now also carries the project field (the FE edit
//     form sends it), alongside title/date.
import { test } from "node:test";
import assert from "node:assert/strict";
import registerCreativeActions from "../domains/creative.js";

const handlers = {};
registerCreativeActions((domain, name, fn) => { handlers[`${domain}.${name}`] = fn; });
const run = (name, ctx, params = {}) => handlers[`creative.${name}`](ctx, {}, params);
const ctx = (userId) => ({ actor: { userId } });

async function withState(fn) {
  const prev = globalThis._concordSTATE;
  globalThis._concordSTATE = {};
  try { return await fn(); } finally {
    if (prev === undefined) delete globalThis._concordSTATE;
    else globalThis._concordSTATE = prev;
  }
}

async function makeSheet(user) {
  const created = await run("callsheet-create", ctx(user), { project: "Night Shoot", shootDate: "2026-12-01", dayNumber: 1, generalCall: "08:00" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const sheet = created.result.sheet;
  const withRow = await run("callsheet-add-row", ctx(user), { id: sheet.id, section: "cast", name: "Ada", role: "Lead", callTime: "07:30" });
  assert.equal(withRow.ok, true, JSON.stringify(withRow));
  return withRow.result.sheet;
}

test("callsheet-update-row edits a cast row and recomputes the general call", async () => {
  await withState(async () => {
    const sheet = await makeSheet("u-1");
    const row = sheet.cast[0];
    const updated = await run("callsheet-update-row", ctx("u-1"), {
      id: sheet.id, section: "cast", rowId: row.id, role: "Director", callTime: "06:15",
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    const after = updated.result.sheet;
    assert.equal(after.cast[0].role, "Director");
    assert.equal(after.cast[0].name, "Ada");
    assert.equal(after.generalCall, "06:15");
  });
});

test("callsheet-update-row is owner-scoped and refuses unknown rows / blanked required fields", async () => {
  await withState(async () => {
    const sheet = await makeSheet("u-1");
    const row = sheet.cast[0];
    const other = await run("callsheet-update-row", ctx("u-2"), { id: sheet.id, section: "cast", rowId: row.id, role: "X" });
    assert.equal(other.ok, false);
    const missing = await run("callsheet-update-row", ctx("u-1"), { id: sheet.id, section: "cast", rowId: "row_nope", role: "X" });
    assert.equal(missing.ok, false);
    const blanked = await run("callsheet-update-row", ctx("u-1"), { id: sheet.id, section: "cast", rowId: row.id, name: "  " });
    assert.equal(blanked.ok, false);
    const after = await run("callsheet-get", ctx("u-1"), { id: sheet.id });
    assert.equal(after.result.sheet.cast[0].name, "Ada");
  });
});

test("calendar-update carries project alongside title and date", async () => {
  await withState(async () => {
    const added = await run("calendar-add", ctx("u-1"), { title: "Shoot day", date: "2026-12-01", kind: "shoot_day" });
    assert.equal(added.ok, true, JSON.stringify(added));
    const id = added.result.event.id;
    const updated = await run("calendar-update", ctx("u-1"), { id, title: "Shoot day 2", date: "2026-12-02", project: "Night Shoot" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.event.title, "Shoot day 2");
    assert.equal(updated.result.event.date, "2026-12-02");
    assert.equal(updated.result.event.project, "Night Shoot");
  });
});
