// server/tests/verify-event-consumers-idioms.test.js
//
// Pins the consumer-detection regexes in scripts/verify-event-consumers.mjs
// BOTH ways (2026-07-28).
//
// The gate was failing at 73.6% against a 77% floor -- on `origin/main` as
// well as on the branch, i.e. it had been red for everyone. It was not
// measuring what it claimed: two live subscription idioms were invisible to
// it, so 18 events with real consumers were counted as SILENT.
//
//   1. TypeScript type arguments.
//        subscribe<{ price: number }>('marketplace:sale', ...)
//      The old regex required `subscribe(` with no `<...>` between, so
//      hooks/useWalletBalance.ts matched nothing. This exact bug class is
//      already recorded in CLAUDE.md for verify-lens-backends.mjs ("no
//      TS-generic match") -- the fix there never propagated here.
//
//   2. Array-of-events hooks.
//        useRealtimeRefresh(['quest:new', 'quest:completed'], reload, ...)
//      The old regex only ever read a FIRST-argument string literal, so a hook
//      taking a LIST registered none of its events. Same failure as the
//      `_tickRssDomain` lesson in CLAUDE.md section 1: an abstraction defeats a
//      literal scan, and the names are live regardless.
//
// Why bidirectional: raising a gate's own number by editing the gate is
// indistinguishable from goalpost-moving unless you also prove it still
// FAILS for the right reasons. The negative controls below are the real
// content of this file -- an unconsumed event must stay silent, and an
// unrelated array of strings must not inflate the consumable set.
//
// Run: node --test server/tests/verify-event-consumers-idioms.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "../../scripts/verify-event-consumers.mjs"), "utf8");

// Rebuild the live regexes from source so this test cannot drift into testing
// a stale copy of them.
function reFrom(name) {
  const m = SRC.match(new RegExp(`const ${name} = (/.*/)g;`));
  assert.ok(m, `${name} not found in verify-event-consumers.mjs`);
  return new RegExp(m[1].slice(1, m[1].lastIndexOf("/")), "g");
}
const subRe = () => reFrom("subRe");
const arrayHookRe = () => reFrom("arrayHookRe");

function namesFromSub(src) {
  return [...src.matchAll(subRe())].map((m) => m[1]);
}
function namesFromArrayHook(src) {
  const out = [];
  for (const m of src.matchAll(arrayHookRe())) {
    for (const lit of m[1].matchAll(/['"`]([a-zA-Z0-9:_-]+)['"`]/g)) out.push(lit[1]);
  }
  return out;
}

describe("subRe — TypeScript type arguments must not hide a subscription", () => {
  it("detects the plain form (regression guard on the original behaviour)", () => {
    assert.deepEqual(namesFromSub(`subscribe('marketplace:sale', cb)`), ["marketplace:sale"]);
  });

  it("detects a generic form — the real useWalletBalance.ts line", () => {
    const line = `const offSale = subscribe<{ earnings: number }>('marketplace:sale', () => refreshBalance());`;
    assert.deepEqual(namesFromSub(line), ["marketplace:sale"]);
  });

  it("detects a generic on socket.on and useSocketEvent too", () => {
    assert.deepEqual(namesFromSub(`socket.on<Payload>("quest:new", cb)`), ["quest:new"]);
    assert.deepEqual(namesFromSub(`useSocketEvent<T>('training:end', cb)`), ["training:end"]);
  });

  it("does NOT treat a call with no string literal as a subscription", () => {
    assert.deepEqual(namesFromSub(`subscribe<Foo>(eventNameVariable, cb)`), []);
  });
});

describe("arrayHookRe — list-taking hooks register every name in the list", () => {
  it("reads all names from the real QuestTracker.tsx call", () => {
    const line = `useRealtimeRefresh(['quest:new', 'quest:completed', 'quest:lineage-quest'], reload, { backstopMs: 30000 });`;
    assert.deepEqual(namesFromArrayHook(line), ["quest:new", "quest:completed", "quest:lineage-quest"]);
  });

  it("handles a single-element list", () => {
    assert.deepEqual(namesFromArrayHook(`useRealtimeRefresh(['brawl-invited'], fn, {})`), ["brawl-invited"]);
  });

  it("IGNORES an unrelated array of strings — the over-match guard", () => {
    // This is the assertion that keeps the fix from being a loosening: a
    // random string array anywhere in a file must not inflate the consumable
    // set, or the gate's percentage becomes meaningless.
    assert.deepEqual(namesFromArrayHook(`const TABS = ['overview', 'details', 'settings'];`), []);
    assert.deepEqual(namesFromArrayHook(`doSomethingElse(['quest:new'], cb)`), []);
  });
});

describe("negative control — the gate must still be able to report SILENT", () => {
  it("an event with no consumer anywhere is matched by neither pattern", () => {
    // `focus:changed`, `space:opened` and `presence:transitioned` are emitted
    // by the server and have ZERO frontend references; they were silent before
    // this fix and are verified still silent after it. If either regex ever
    // starts matching bare occurrences, this catches it.
    const bare = `// focus:changed is emitted but nothing listens\nconst x = 'focus:changed';`;
    assert.deepEqual(namesFromSub(bare), []);
    assert.deepEqual(namesFromArrayHook(bare), []);
  });
});
