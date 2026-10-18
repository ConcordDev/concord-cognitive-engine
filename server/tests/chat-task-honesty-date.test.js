// Task asks never get invented errors; "today" is the user's local day; the guard keeps song/receipt lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localDay, todayLine, timeReply, resolveDueDate } from "../lib/chat/today.js";
import { isTaskAddAsk, parseTaskAsk, writeStatusReply, stripInventedToolErrors, historyItemTitles, answerViaAgent } from "../lib/chat/agent-route.js";
import { guardDtuCitations, collectRetrievedDtus } from "../lib/chat/dtu-citation-guard.js";

// 2026-10-18T01:30Z is 9:30 PM ET on Saturday Oct 17 — the UTC date is already the 18th.
const EVENING = new Date("2026-10-18T01:30:00Z");

test("today is the New York day after 8 PM ET, not the UTC date", () => {
  assert.equal(localDay(EVENING).iso, "2026-10-17");
  assert.match(todayLine(EVENING), /Saturday, October 17, 2026/);
  assert.match(timeReply(EVENING), /^It's Saturday, October 17, 2026, 9:30 PM \(America\/New_York\)\.$/);
  assert.equal(localDay(new Date("2026-10-18T05:00:00Z")).iso, "2026-10-18");
});

test("due dates resolve in the user's zone", () => {
  assert.equal(resolveDueDate("call mom sunday", EVENING), "2026-10-18");
  assert.equal(resolveDueDate("pay rent tomorrow", EVENING), "2026-10-18");
  assert.equal(resolveDueDate("file taxes today", EVENING), "2026-10-17");
  assert.equal(resolveDueDate("dentist oct 20", EVENING), "2026-10-20");
  assert.equal(resolveDueDate("next saturday", EVENING), "2026-10-24");
  assert.equal(resolveDueDate("buy milk", EVENING), null);
});

test("task asks parse to the user's words plus a due date", () => {
  assert.ok(isTaskAddAsk("add a task to my tasks: call mom sunday"));
  assert.ok(!isTaskAddAsk("did the mom task get added"));
  assert.deepEqual(parseTaskAsk("add a task to my tasks: call mom sunday", EVENING), { content: "call mom sunday", dueDate: "2026-10-18" });
  assert.deepEqual(parseTaskAsk("add a task to buy dog food", EVENING), { content: "buy dog food" });
});

test("'did the task get added' is answered from this chat's receipts", () => {
  const saved = [{ role: "user", content: "add a task: x" }, { role: "assistant", content: 'Saved in productivity: "call mom sunday" (id tsk_1, due 2026-10-18).' }];
  assert.match(writeStatusReply("did the mom task get added", saved), /^Yes\. "call mom sunday" was saved in productivity \(id tsk_1, due 2026-10-18\)\.$/);
  const failed = [{ role: "user", content: "add a task to my tasks: call mom sunday" }, { role: "assistant", content: "I couldn't complete that, so nothing was created or saved. No write tool ran." }];
  const r = writeStatusReply("did the mom task actually get added?", failed);
  assert.match(r, /^No\./);
  assert.ok(!/dueDate|error:/i.test(r));
  assert.equal(writeStatusReply("what's the weather", saved), null);
});

test("invented tool errors are stripped when no tool failed", () => {
  const a = 'No — the task "call mom sunday" was not added. The system returned an error: missing required field "dueDate". You can try again.';
  const out = stripInventedToolErrors(a, []);
  assert.ok(!/dueDate|returned an error/.test(out), out);
  assert.equal(stripInventedToolErrors(a, [{ tool: "run_lens_action", ok: false, error: "x" }]), a);
});

test("guard keeps the song line and receipt lines", () => {
  const hist = [{ role: "assistant", content: '"Late Night Drives" is ready to play below — a short lofi track.' }];
  const ret = collectRetrievedDtus(historyItemTitles(hist));
  const reply = 'Note: "Late Night Drives" — lofi in F major, 88 BPM. It\u2019s ready to play below.\nYou can save it.';
  assert.equal(guardDtuCitations(reply, ret, { prompt: "what song did you make me" }).text, reply);
  const r2 = 'DTU: Some Song I Made — it\u2019s ready to play below.';
  assert.equal(guardDtuCitations(r2, collectRetrievedDtus([]), {}).text, r2);
  // still drops a made-up DTU bullet
  assert.match(guardDtuCitations("- DTU: Heat Pump Efficiency Metrics — stuff", collectRetrievedDtus([]), {}).text, /_Removed 1 DTU/);
});

test("action route: no write from the model → the server adds the task itself", async () => {
  let calls = 0;
  const runMacro = async (domain, name) => { calls++; return { ok: true, answer: "Task added! (ID: tsk_fake)", toolCalls: [] }; };
  const added = [];
  const lensActions = new Map([["productivity.task-add", async (ctx, _a, input) => { added.push(input); return { ok: true, result: { task: { id: "tsk_real", content: input.content, dueDate: input.dueDate || null } } }; }]]);
  const out = await answerViaAgent({ runMacro, ctx: { db: {}, actor: { userId: "u1" } }, history: [], prompt: "add a task to my tasks: buy dog food", route: "action", lensActions });
  assert.ok(out, "reply");
  assert.ok(!/tsk_fake/.test(out.reply), out.reply);
  assert.equal(added.length, 1);
  assert.match(out.reply, /Saved in productivity: "buy dog food" \(id tsk_real/);

});

test("status ask matches the named task, not just the newest receipt", () => {
  const hist = [
    { role: "user", content: "add a task to my tasks: call mom sunday" },
    { role: "assistant", content: 'Saved in productivity: "call mom sunday" (id tsk_mom, due 2026-10-18).' },
    { role: "user", content: "add a task to buy dog food" },
    { role: "assistant", content: 'Saved in productivity: "buy dog food" (id tsk_dog, no due date).' },
  ];
  assert.match(writeStatusReply("did the mom task actually get added", hist), /tsk_mom/);
  assert.match(writeStatusReply("did the dog food task get added", hist), /tsk_dog/);
  assert.match(writeStatusReply("did that task get added", hist), /tsk_dog/);
  assert.equal(writeStatusReply("did the dentist task get added", hist), null);
});

test("'Note:' prose survives unless the user asked about their notes", () => {
  const r = "So far:\n- Note: you saved a film reminder\n- Made a song";
  assert.equal(guardDtuCitations(r, collectRetrievedDtus([]), { prompt: "what did we do so far" }).text, r);
  assert.match(guardDtuCitations("- Note: Heat Pump Metrics — x", collectRetrievedDtus([]), { prompt: "what's in my notes about heat pumps" }).text, /didn't find any DTUs|_Removed 1/);
});

test("the same lens write twice in one turn runs once", async () => {
  const { runAgentLoop, lensWriteKey } = await import("../lib/chat-agent.js");
  const Database = (await import("better-sqlite3")).default;
  assert.equal(lensWriteKey({ tool: "run_lens_action", params: { domain: "productivity", action: "task-list", params: {} } }), null);
  const db = new Database(":memory:");
  const call = '[TOOL_CALL: {"tool":"run_lens_action","params":{"domain":"productivity","action":"task-add","params":{"content":"call mom sunday"}}}]';
  const texts = [call, call, call, "Saved."];
  const brain = async () => ({ ok: true, text: texts.shift() ?? "done", provider: "test", model: "test" });
  let n = 0;
  const lensActions = new Map([["productivity.task-add", async (ctx, _a, input) => { n++; return { ok: true, result: { task: { id: "tsk_" + n, content: input.content } } }; }]]);
  const out = await runAgentLoop({ db, userId: "u1", message: "add a task: call mom sunday", runMacro: async () => ({ ok: true }), lensActions, opts: { brainChat: brain, shadowContext: false, actionMemory: false } });
  assert.equal(n, 1);
  assert.equal(out.toolCalls.filter((t) => t.tool === "run_lens_action").length, 1);
  db.close();
});

test("song recall names the song instead of 'no audio was produced'", async () => {
  const { songRecallFix } = await import("../lib/chat/agent-route.js");
  const hist = [{ role: "assistant", content: '"Late Night Drives" is ready to play below \u2014 a short lofi track.' }];
  const out = songRecallFix("It's ready to play below.\n\nNote: no audio was produced in this chat, so nothing is playing.", hist);
  assert.equal(out, 'The song I made you is "Late Night Drives". Its player is on the earlier message where I made it.');
  assert.match(songRecallFix("x\n\nNote: no audio was produced in this chat, so nothing is playing.", [], '- song "Rain Loop"'), /"Rain Loop"/);
  const none = "Sure.\n\nNote: no audio was produced in this chat, so nothing is playing.";
  assert.equal(songRecallFix(none, []), none);
});

test("playback guard keeps 'I made you a song' when this chat made one; still drops 'is playing'", async () => {
  const { guardPlaybackClaim, historyHasSong } = await import("../lib/chat/playback-honesty.js");
  const hist = [{ role: "assistant", content: '"Late Night Drives" is ready to play below.' }];
  assert.ok(historyHasSong(hist));
  assert.ok(historyHasSong([{ role: "system", content: 'Saved or made in this chat:\n- song "Rain Loop"' }]));
  const recap = "We added two tasks. I made you a song called Late Night Drives.";
  assert.equal(guardPlaybackClaim(recap, [], { priorSong: true }), recap);
  assert.match(guardPlaybackClaim(recap, []), /no audio was produced/);
  assert.equal(guardPlaybackClaim("Late Night Drives is playing now. Enjoy!", [], { priorSong: true }), "Enjoy!");
});

test("recap draws on receipts, the date check and the memory note", async () => {
  const { recapReply } = await import("../lib/chat/agent-route.js");
  const hist = [
    { role: "user", content: "yo" }, { role: "assistant", content: "hey" },
    { role: "user", content: "whats todays date" }, { role: "assistant", content: "It's Sunday, October 18, 2026, 12:41 AM (America/New_York)." },
    { role: "user", content: "add a task to my tasks: call mom sunday" }, { role: "assistant", content: 'Saved in productivity: "call mom sunday" (id tsk_1, due 2026-10-18).' },
    { role: "user", content: "make me a short song about late night drives" }, { role: "assistant", content: '"Late Night Drives" is ready to play below \u2014 lofi.' },
  ];
  const r = recapReply("what did we do so far", hist, 'Saved or made in this chat (confirmed by tools):\n- note (DTU) "Pick up film from lab" id dtu_x\n\nOther things the user asked for:\n- turn 4: what trump doing lately');
  assert.match(r, /Saved 1 task: "call mom sunday" \(due 2026-10-18\)/);
  assert.match(r, /Made a song: "Late Night Drives"/);
  assert.match(r, /Checked the date: Sunday, October 18, 2026/);
  assert.match(r, /Saved note: "Pick up film from lab"/);
  assert.match(r, /You asked: what trump doing lately/);
  assert.ok(!/You asked: yo\b/.test(r));
  assert.equal(recapReply("whats the weather", hist), null);
});
