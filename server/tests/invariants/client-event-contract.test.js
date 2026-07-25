// Bidirectional pinning test for scripts/verify-client-event-contracts.mjs —
// the "frontend SUBSCRIBES to a socket event the server never emits" quadrant
// (see that file's header comment for full context: it's the missing corner
// of the four-quadrant event/call contract-checking Concord already has for
// the other three).
//
// Per CLAUDE.md's anti-cheat rule ("Metrics you can't game"), a checker must
// be proven correct in BOTH directions, not just "it passes on the current
// tree" — otherwise a checker that never catches anything (always green) is
// indistinguishable from one that correctly finds nothing wrong. This file
// proves:
//   (a) the collector CATCHES a genuinely dead subscription — a name that's
//       demonstrably subscribed to on the FE side but never emitted anywhere
//       reachable on the server side.
//   (b) the collector does NOT flag a real one — specifically, that
//       `retail:update` (one of the 11 names only reachable through the
//       `_tickRssDomain(domain, feeds, eventName, ...)` indirection
//       documented in the verifier's TRAP 1 comment) is recognized as LIVE
//       against the real server/ tree. This is the regression guard for
//       Trap 1: a naive literal-string scan would call this "dead" and (in
//       this project's real history) would have deleted a live feature.
//   (c) comment-stripping is bidirectional — a comment that only MENTIONS an
//       event name in prose must not be mistaken for a live emitter, while a
//       REAL occurrence sitting right next to that same prose text (the
//       documented "grade-ux-polish.mjs"-style self-inflicted false positive
//       CLAUDE.md warns about) must still be caught.
//
// (a) and (c) use synthetic temp directories (via the collector functions'
// overridable root-directory parameters) so they never touch or depend on
// real repository files; (b) intentionally runs against the REAL server/
// tree, because the whole point is proving the resolver still sees through
// the real indirection in the real codebase, not a reproduction of it.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  stripComments,
  collectLiveServerEvents,
  collectDirectSubscriptions,
} from "../../../scripts/verify-client-event-contracts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return full;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── (a) The checker CATCHES a genuinely dead subscription ──────────────────

test("collectDirectSubscriptions + collectLiveServerEvents: a synthetic FE subscription with no server emitter is reported dead, not silently missed", () => {
  const feDir = makeTempDir("client-event-contract-fe-dead-");
  const serverDir = makeTempDir("client-event-contract-server-dead-");
  try {
    const fakeEventName = "totally:fake-dead-event-zzqq";

    writeFile(
      feDir,
      "components/FakeLens.tsx",
      [
        "'use client';",
        "import { getSocket } from '@/lib/realtime/socket';",
        "export function useFakeLens() {",
        "  const socket = getSocket();",
        `  socket.on('${fakeEventName}', (data) => console.log(data));`,
        "}",
      ].join("\n"),
    );

    // A server tree that emits OTHER real-looking events but never this one —
    // proves the collector isn't just returning "everything is dead" because
    // the fixture server dir is empty; it correctly distinguishes emitted
    // names from unemitted ones.
    writeFile(
      serverDir,
      "domains/fake.js",
      [
        "export function registerFake(realtimeEmit) {",
        "  realtimeEmit('some:other-real-event', { ok: true });",
        "}",
      ].join("\n"),
    );

    const subs = collectDirectSubscriptions(feDir);
    const live = collectLiveServerEvents(serverDir);

    assert.ok(
      subs.has(fakeEventName),
      "expected the synthetic socket.on(...) call to be collected as a frontend subscription",
    );
    assert.ok(
      live.has("some:other-real-event"),
      "sanity check: the synthetic server file's real emit should be resolved live",
    );
    assert.ok(
      !live.has(fakeEventName),
      `"${fakeEventName}" must NOT be resolved live — nothing in the synthetic server tree emits it`,
    );

    // This is exactly the condition scripts/verify-client-event-contracts.mjs's
    // main() uses to decide "dead": gated (subscribed) minus live (emitted).
    const isReportedDead = subs.has(fakeEventName) && !live.has(fakeEventName);
    assert.ok(isReportedDead, "the genuinely dead synthetic subscription must be reported, not missed");
  } finally {
    rmDir(feDir);
    rmDir(serverDir);
  }
});

// ── (b) The checker does NOT flag a live one (Trap 1 regression guard) ─────

test("collectLiveServerEvents recognizes a _tickRssDomain-indirect event ('retail:update') as LIVE against the real server/ tree", () => {
  const live = collectLiveServerEvents(path.join(REPO_ROOT, "server"));
  assert.ok(
    live.has("retail:update"),
    "'retail:update' is only reachable through server/emergent/realtime-feeds.js's " +
      "_tickRssDomain(domain, feeds, eventName, ...) helper (eventName passed as a literal " +
      "3rd argument, never appearing directly next to realtimeEmit/.emit). A naive " +
      "literal-string scan would misclassify this as dead — this assertion is the " +
      "regression guard for that exact false positive.",
  );
  // A second _tickRssDomain-indirect name from a different call site, so this
  // isn't pinned to a single coincidental match.
  assert.ok(
    live.has("legal:update"),
    "'legal:update' is the other _tickRssDomain-indirect name already used as the " +
      "canonical example in server/tests/invariants/realtime-lens-event-liveness.test.js",
  );
});

// ── (c) Comment-stripping is bidirectional ──────────────────────────────────

test("stripComments: a comment-only mention of an event name is removed, but a real occurrence beside identical prose survives", () => {
  const fakeName = "prose:only-mentioned-event";
  const realName = "both:present-event";

  const src = [
    `// this file used to call realtimeEmit("${fakeName}", payload) but no longer does`,
    "export function real() {",
    `  realtimeEmit("${realName}", {});`,
    "}",
  ].join("\n");

  const stripped = stripComments(src);

  assert.ok(
    !stripped.includes(fakeName),
    "a comment-only mention of an event name must be fully removed by stripComments",
  );
  assert.ok(
    stripped.includes(realName),
    "a real code occurrence must survive stripComments even when the file also contains " +
      "a comment mentioning a DIFFERENT (or the same) event-name-shaped string",
  );
});

test("collectLiveServerEvents end-to-end: the same 'documented in a comment, fixed in code' shape does not falsely resolve the comment-only name but does resolve the real one", () => {
  const serverDir = makeTempDir("client-event-contract-server-comment-");
  try {
    const fakeName = "prose:only-mentioned-event-e2e";
    const realName = "both:present-event-e2e";

    writeFile(
      serverDir,
      "lib/fixed-file.js",
      [
        "// DET-C fix: this file used to fire",
        `// \`realtimeEmit("${fakeName}", payload)\` with no frontend consumer,`,
        "// so it was retired. The real, still-live event is below.",
        "export function tick(realtimeEmit) {",
        `  realtimeEmit("${realName}", { ok: true });`,
        "}",
      ].join("\n"),
    );

    const live = collectLiveServerEvents(serverDir);

    assert.ok(
      !live.has(fakeName),
      "the retired event, mentioned only inside the explanatory comment, must not be " +
        "resolved as live — this is the exact 'scanner flags the file it just fixed' trap " +
        "CLAUDE.md documents",
    );
    assert.ok(
      live.has(realName),
      "the real, still-live realtimeEmit(...) call in the same file must still be resolved",
    );
  } finally {
    rmDir(serverDir);
  }
});
