// tests/depth/board-cork-wall-behavior.test.js — Board as real shared boards.
// Sharing by username is real: a viewer can open the board and comment, an
// editor can change cards, an admin can manage people and automations, only
// the owner deletes it — and anyone not on the board can't find it. Every
// change is recorded with who made it and pushed live to everyone on the
// board. Moves run the board's automations; My tasks gathers your cards
// from every board; the old personal task list can be brought in once.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";

let STATE;
const run = (a, p, ctx) => lensRun("board", a, { params: p }, ctx);
const ok = (r) => { assert.equal(r.ok, true, r.error || JSON.stringify(r)); return r.result; };
function user(id, username) {
  STATE.db.prepare("INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', datetime('now'))").run(id, username, `${username}@example.com`);
}
const emitted = [];

before(async () => {
  ({ STATE } = await load());
  for (const [id, n] of [["bw-ada", "ada_bw"], ["bw-ben", "ben_bw"], ["bw-cy", "cy_bw"], ["bw-dee", "dee_bw"], ["bw-eve", "eve_bw"]]) user(id, n);
  // The server re-installs its realtimeEmit on globalThis every time it runs;
  // keep reading through a tap and let those re-installs update what's under it.
  let real = globalThis._concordRealtimeEmit;
  const tap = (event, payload, opts) => { emitted.push({ event, payload, to: opts?.userId }); try { real?.(event, payload, opts); } catch { /* no sockets in tests */ } };
  Object.defineProperty(globalThis, "_concordRealtimeEmit", { configurable: true, get: () => tap, set: (v) => { if (v !== tap) real = v; } });
  globalThis.__realEmit = () => real;
});

describe("sharing is real", () => {
  let ada, ben, cy, dee, eve, board, todo, doing, done;
  before(async () => {
    ada = await depthCtx("bw-ada"); ben = await depthCtx("bw-ben"); cy = await depthCtx("bw-cy"); dee = await depthCtx("bw-dee"); eve = await depthCtx("bw-eve");
    board = ok(await run("board-create", { name: "Launch" }, ada)).board;
    [todo, doing, done] = board.columns;
  });

  it("someone not on the board can't see it, open it or touch it", async () => {
    assert.equal(ok(await run("board-list", {}, eve)).boards.some((b) => b.id === board.id), false);
    assert.match((await run("board-detail", { id: board.id }, eve)).error, /board not found/);
    assert.match((await run("card-create", { boardId: board.id, title: "sneaky" }, eve)).error, /board not found/);
    assert.match((await run("collaborator-add", { boardId: board.id, username: "eve_bw", role: "admin" }, eve)).error, /board not found/);
  });

  it("is shared by username, with a role; unknown names and the owner are refused", async () => {
    assert.match((await run("collaborator-add", { boardId: board.id, username: "nobody_here", role: "editor" }, ada)).error, /no one is called nobody_here/);
    assert.match((await run("collaborator-add", { boardId: board.id, username: "ada_bw" }, ada)).error, /board's owner/);
    emitted.length = 0;
    const r = ok(await run("collaborator-add", { boardId: board.id, username: "@ben_bw", role: "editor" }, ada));
    assert.deepEqual([r.collaborator.userId, r.collaborator.role, r.collaborator.name], ["bw-ben", "editor", "ben_bw"]);
    assert.ok(emitted.some((e) => e.event === "board:shared" && e.to === "bw-ben"), "the invitee hears about it live");
    ok(await run("collaborator-add", { boardId: board.id, username: "cy_bw", role: "viewer" }, ada));
    ok(await run("collaborator-add", { boardId: board.id, username: "dee_bw", role: "admin" }, ada));
    const mine = ok(await run("board-list", {}, ben)).boards.find((b) => b.id === board.id);
    assert.deepEqual([mine.role, mine.owner.name, mine.shared], ["editor", "ada_bw", true]);
    const det = ok(await run("board-detail", { id: board.id }, cy));
    assert.equal(det.role, "viewer");
    assert.deepEqual(det.members.map((m) => [m.name, m.role]), [["ada_bw", "owner"], ["ben_bw", "editor"], ["cy_bw", "viewer"], ["dee_bw", "admin"]]);
  });

  it("an editor changes cards; every member hears it live, with who did it", async () => {
    emitted.length = 0;
    const card = ok(await run("card-create", { boardId: board.id, columnId: todo.id, title: "Write the brief", assignee: "ada_bw", dueDate: "2026-12-01" }, ben)).card;
    assert.deepEqual([card.assignee, card.createdBy], ["bw-ada", "bw-ben"]);
    const told = emitted.filter((e) => e.event === "board:changed").map((e) => e.to).sort();
    assert.deepEqual(told, ["bw-ada", "bw-ben", "bw-cy", "bw-dee"]);
    assert.deepEqual([emitted[0].payload.by.name, emitted[0].payload.words, emitted[0].payload.cardTitle], ["ben_bw", "added", "Write the brief"]);
    ok(await run("card-move", { boardId: board.id, cardId: card.id, toColumnId: doing.id }, ben));
    const act = ok(await run("board-activity", { boardId: board.id }, cy)).activity;
    assert.deepEqual(act.slice(0, 2).map((a) => [a.byName, a.words, a.cardTitle, a.toColumn]), [["ben_bw", "moved", "Write the brief", doing.name], ["ben_bw", "added", "Write the brief", null]]);
    const det = ok(await run("card-detail", { boardId: board.id, cardId: card.id }, cy)).card;
    assert.equal(det.activity[0].byName, "ben_bw");
    assert.equal(det.transitions.length, 2);
  });

  it("a viewer can look and comment, not change", async () => {
    const card = ok(await run("board-detail", { id: board.id }, cy)).board.cards[0];
    assert.match((await run("card-update", { boardId: board.id, cardId: card.id, title: "mine" }, cy)).error, /look at this board, but not change it/);
    assert.match((await run("card-move", { boardId: board.id, cardId: card.id, toColumnId: done.id }, cy)).error, /not change it/);
    assert.match((await run("column-add", { boardId: board.id, name: "x" }, cy)).error, /not change it/);
    const c = ok(await run("card-comment-add", { boardId: board.id, cardId: card.id, text: "Looks good to me" }, cy)).comment;
    assert.equal(c.authorName, "cy_bw");
  });

  it("only the owner or an admin manages people and automations; only the owner hands out admin or deletes", async () => {
    assert.match((await run("collaborator-add", { boardId: board.id, username: "eve_bw", role: "viewer" }, ben)).error, /owner or an admin/);
    assert.match((await run("automation-add", { boardId: board.id, trigger: "card-moved-to-column", columnId: done.id, action: "clear-due" }, ben)).error, /owner or an admin/);
    ok(await run("collaborator-add", { boardId: board.id, username: "eve_bw", role: "viewer" }, dee));
    assert.match((await run("collaborator-add", { boardId: board.id, username: "eve_bw", role: "admin" }, dee)).error, /only the board's owner can make someone an admin/);
    assert.match((await run("board-delete", { id: board.id }, dee)).error, /only the board's owner/);
    assert.match((await run("collaborator-remove", { boardId: board.id, userId: "bw-dee" }, ben)).error, /owner or an admin/);
  });

  it("anyone may leave; when someone goes their cards are unassigned, not lost", async () => {
    const card = ok(await run("card-create", { boardId: board.id, title: "Ben's job", assignee: "ben_bw" }, ada)).card;
    const r = ok(await run("collaborator-remove", { boardId: board.id, userId: "bw-ben" }, ben));
    assert.equal(r.left, true);
    assert.match((await run("board-detail", { id: board.id }, ben)).error, /board not found/);
    const after = ok(await run("card-detail", { boardId: board.id, cardId: card.id }, ada)).card;
    assert.equal(after.assignee, null);
    assert.match((await run("card-update", { boardId: board.id, cardId: card.id, assignee: "ben_bw" }, ada)).error, /isn't on this board/);
  });

  it("presence lists who has the board open", async () => {
    ok(await run("board-presence", { boardId: board.id }, ada));
    const here = ok(await run("board-presence", { boardId: board.id }, cy)).here;
    assert.deepEqual(here.map((h) => h.name).sort(), ["ada_bw", "cy_bw"]);
    assert.match((await run("board-presence", { boardId: board.id }, ben)).error, /board not found/);
  });
});

describe("automations run on every move", () => {
  let ada, board, todo, doing, done;
  before(async () => {
    ada = await depthCtx("bw-ada");
    board = ok(await run("board-create", { name: "Rules" }, ada)).board;
    [todo, doing, done] = board.columns;
  });
  it("moving into Done ticks the checklist and clears the due date; finishing a checklist moves the card", async () => {
    ok(await run("automation-add", { boardId: board.id, trigger: "card-moved-to-column", columnId: done.id, action: "check-all-checklist" }, ada));
    ok(await run("automation-add", { boardId: board.id, trigger: "card-moved-to-column", columnId: done.id, action: "clear-due" }, ada));
    ok(await run("automation-add", { boardId: board.id, trigger: "checklist-completed", columnId: doing.id, action: "move-to-column", value: done.id }, ada));
    ok(await run("automation-add", { boardId: board.id, trigger: "card-created-in-column", columnId: todo.id, action: "set-due-in-days", value: "7" }, ada));
    const card = ok(await run("card-create", { boardId: board.id, columnId: todo.id, title: "Ship it" }, ada));
    const expect = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    assert.equal(card.card.dueDate, expect);
    assert.equal(card.automations[0].action, "set-due-in-days");
    ok(await run("card-update", { boardId: board.id, cardId: card.card.id, addChecklistItem: "Tests" }, ada));
    ok(await run("card-update", { boardId: board.id, cardId: card.card.id, addChecklistItem: "Notes" }, ada));
    const moved = ok(await run("card-move", { boardId: board.id, cardId: card.card.id, toColumnId: done.id }, ada));
    assert.deepEqual(moved.automations.map((a) => a.action), ["check-all-checklist", "clear-due"]);
    const d = ok(await run("card-detail", { boardId: board.id, cardId: card.card.id }, ada)).card;
    assert.deepEqual([d.checklist.every((i) => i.done), d.dueDate], [true, null]);
    const c2 = ok(await run("card-create", { boardId: board.id, columnId: doing.id, title: "Second" }, ada)).card;
    ok(await run("card-update", { boardId: board.id, cardId: c2.id, addChecklistItem: "Only step" }, ada));
    const item = ok(await run("card-detail", { boardId: board.id, cardId: c2.id }, ada)).card.checklist[0];
    const t = ok(await run("card-checklist-toggle", { boardId: board.id, cardId: c2.id, itemId: item.id }, ada));
    assert.deepEqual([t.checklistComplete, t.columnId, t.automations[0].action], [true, done.id, "move-to-column"]);
  });
  it("a switched-off rule doesn't run; bad rules are refused", async () => {
    const rules = ok(await run("automation-list", { boardId: board.id }, ada)).rules;
    for (const r of rules) ok(await run("automation-toggle", { boardId: board.id, ruleId: r.id, enabled: false }, ada));
    const card = ok(await run("card-create", { boardId: board.id, columnId: todo.id, title: "Quiet" }, ada));
    assert.equal(card.card.dueDate, null);
    assert.match((await run("automation-add", { boardId: board.id, trigger: "card-moved-to-column", columnId: done.id, action: "move-to-column", value: done.id }, ada)).error, /same column/);
    assert.match((await run("automation-add", { boardId: board.id, trigger: "card-moved-to-column", columnId: done.id, action: "set-due-in-days", value: "999" }, ada)).error, /0 to 365/);
    assert.match((await run("automation-add", { boardId: board.id, trigger: "card-moved-to-column", columnId: done.id, action: "set-assignee", value: "eve_bw" }, ada)).error, /isn't on this board/);
    assert.match((await run("card-update", { boardId: board.id, cardId: card.card.id, dueDate: "next tuesday" }, ada)).error, /date like/);
  });
  it("positions stay a clean 0..n after moves in and out", async () => {
    const b = ok(await run("board-create", { name: "Order" }, ada)).board;
    const [a1, b1] = b.columns;
    const ids = [];
    for (const t of ["one", "two", "three"]) ids.push(ok(await run("card-create", { boardId: b.id, columnId: a1.id, title: t }, ada)).card.id);
    ok(await run("card-move", { boardId: b.id, cardId: ids[0], toColumnId: b1.id }, ada));
    ok(await run("card-move", { boardId: b.id, cardId: ids[2], toColumnId: a1.id, position: 0 }, ada));
    const cards = ok(await run("board-detail", { id: b.id }, ada)).board.cards;
    const col = (cid) => cards.filter((c) => c.columnId === cid).sort((x, y) => x.position - y.position).map((c) => [c.title, c.position]);
    assert.deepEqual(col(a1.id), [["three", 0], ["two", 1]]);
    assert.deepEqual(col(b1.id), [["one", 0]]);
  });
});

describe("my tasks and the old task list", () => {
  it("gathers your cards across boards, by when they're due; done ones only when asked", async () => {
    const me = await depthCtx("bw-cy"), other = await depthCtx("bw-dee");
    const mine = ok(await run("board-create", { name: "Cy's" }, me)).board;
    const theirs = ok(await run("board-create", { name: "Dee's" }, other)).board;
    ok(await run("collaborator-add", { boardId: theirs.id, username: "cy_bw", role: "editor" }, other));
    const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    ok(await run("card-create", { boardId: mine.id, title: "Overdue thing", dueDate: iso(-3) }, me));
    ok(await run("card-create", { boardId: theirs.id, title: "For Cy", assignee: "cy_bw", dueDate: iso(3) }, other));
    ok(await run("card-create", { boardId: theirs.id, title: "Not Cy's", assignee: "dee_bw" }, other));
    const fin = ok(await run("card-create", { boardId: mine.id, title: "Finished", columnId: mine.columns[2].id }, me)).card;
    void fin;
    const r = ok(await run("my-tasks", {}, me));
    const titles = r.tasks.map((t) => [t.title, t.bucket, t.boardName]);
    assert.deepEqual(titles.filter((t) => ["Overdue thing", "For Cy", "Not Cy's", "Finished"].includes(t[0])), [["Overdue thing", "overdue", "Cy's"], ["For Cy", "week", "Dee's"]]);
    const all = ok(await run("my-tasks", { includeDone: true }, me));
    assert.ok(all.tasks.some((t) => t.title === "Finished" && t.bucket === "done"));
  });
  it("brings the old personal tasks onto a real board once, keeping status, due, subtasks and comments", async () => {
    const me = await depthCtx("bw-eve");
    const mk = (id, data) => STATE.lensArtifacts.set(id, { id, domain: "board", type: "task", ownerId: "bw-eve", title: data.title, data, createdAt: new Date().toISOString() });
    mk("old-1", { title: "Old draft", status: "in_progress", priority: "high", dueDate: "2026-12-05", subtasks: [{ title: "outline", done: true }, { title: "write", done: false }], comments: [{ text: "remember the intro" }] });
    mk("old-2", { title: "Old idea", status: "backlog" });
    STATE.lensArtifacts.set("old-x", { id: "old-x", domain: "board", type: "task", ownerId: "bw-ada", title: "Ada's", data: { title: "Ada's" } });
    assert.equal(ok(await run("my-tasks", {}, me)).legacyTasks, 2);
    const r = ok(await run("import-tasks", {}, me));
    assert.equal(r.imported, 2);
    assert.deepEqual(r.columns, ["Backlog", "To do", "In progress", "Done"]);
    const b = ok(await run("board-detail", { id: r.boardId }, me)).board;
    const draft = b.cards.find((c) => c.title === "Old draft");
    assert.equal(b.columns.find((c) => c.id === draft.columnId).name, "In progress");
    assert.deepEqual([draft.dueDate, draft.labels, draft.checklist.map((i) => [i.text, i.done]), draft.comments[0].text], ["2026-12-05", ["high priority"], [["outline", true], ["write", false]], "remember the intro"]);
    assert.match((await run("import-tasks", {}, me)).error, /no older tasks/);
    assert.equal(STATE.lensArtifacts.get("old-x").data.importedTo, undefined, "someone else's tasks are untouched");
  });
});

describe("private board events stay private", () => {
  it("never land on the shared timeline anyone can read", async () => {
    const ada = await depthCtx("bw-ada");
    const b = ok(await run("board-create", { name: "Secret plans" }, ada)).board;
    ok(await run("card-create", { boardId: b.id, title: "Surprise party for Ben" }, ada));
    const real = globalThis.__realEmit();
    assert.equal(typeof real, "function", "the server's realtimeEmit is installed");
    real("board:changed", { boardId: b.id, cardTitle: "Surprise party for Ben (direct)" }, { userId: "bw-ada" });
    const rows = STATE.db.prepare("SELECT payload_json FROM event_timeline_log WHERE payload_json LIKE '%Surprise party%'").all();
    assert.deepEqual(rows, []);
  });
});
