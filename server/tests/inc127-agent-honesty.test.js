// server/tests/inc127-agent-honesty.test.js
//
// INC-127 backend fix: agent-mode music/playback honesty and wiring.
//
// - run_lens_action must not paper over a handler's { ok: false, error }.
// - music.play-track must accept id/trackId/title and report audioUrl/playable.
// - music.render must refuse rather than fake success.
// - The final answer guard must retract false "is playing" / "generated" claims
//   when no audio artifact was produced.
// - Unknown domain.action tool names are auto-dispatched as run_lens_action.
// - One retry is granted for retryable failures (unknown/missing).

import test from "node:test";
import assert from "node:assert/strict";
import {
  executeToolCall,
  formatToolResults,
  runAgentLoop,
  TOOL_SCHEMA_BLOCK,
} from "../lib/chat-agent.js";
import { guardPlaybackClaim } from "../lib/chat/playback-honesty.js";
import { shouldSkipToolFollowup } from "../lib/chat/tool-turn-reply.js";
import registerMusicActions from "../domains/music.js";

function freshMusicRegistry() {
  const handlers = {};
  const register = (domain, action, fn) => {
    handlers[`${domain}.${action}`] = fn;
  };
  globalThis._concordSTATE = {};
  registerMusicActions(register);
  return handlers;
}

test("run_lens_action returns ok:false when the handler returns {ok:false,error}", async () => {
  const lensActions = new Map();
  lensActions.set("music.play-track", async () => ({ ok: false, error: "track not found" }));
  const result = await executeToolCall(
    { actor: { userId: "u1" } },
    () => null,
    lensActions,
    {
      tool: "run_lens_action",
      params: { domain: "music", action: "play-track", params: { id: "trk_missing" } },
    },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error, "track not found");
  assert.equal(result.result.ok, false);
});

test("music.play-track accepts id, trackId, and title; result carries audioUrl and playable", () => {
  const handlers = freshMusicRegistry();
  const ctx = { actor: { userId: "u2" } };

  const added = handlers["music.track-add"](ctx, null, { title: "INC127 Test Tune", artist: "Bot" });
  assert.equal(added.ok, true);
  const trackId = added.result.track.id;

  const byTrackId = handlers["music.play-track"](ctx, null, { trackId });
  assert.equal(byTrackId.ok, true);
  assert.equal(byTrackId.result.audioUrl, null);
  assert.equal(byTrackId.result.playable, false);

  const byId = handlers["music.play-track"](ctx, null, { id: trackId });
  assert.equal(byId.ok, true);
  assert.equal(byId.result.playable, false);

  const byTitle = handlers["music.play-track"](ctx, null, { title: "INC127 Test Tune" });
  assert.equal(byTitle.ok, true);
  assert.equal(byTitle.result.playable, false);

  const unknown = handlers["music.play-track"](ctx, null, { id: "trk_does_not_exist" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, "track not found");
});

test("run_lens_action music.play-track without audio returns the no-audio error", async () => {
  const handlers = freshMusicRegistry();
  const ctx = { actor: { userId: "u3" } };
  const added = handlers["music.track-add"](ctx, null, { title: "Metadata Only" });
  const trackId = added.result.track.id;

  const lensActions = new Map();
  lensActions.set("music.play-track", handlers["music.play-track"]);
  const result = await executeToolCall(ctx, () => null, lensActions, {
    tool: "run_lens_action",
    params: { domain: "music", action: "play-track", params: { id: trackId } },
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.error, /no audio file/);
});

test("run_lens_action music.play-track on an iTunes track with previewUrl stays ok", async () => {
  const lensActions = new Map();
  lensActions.set("music.play-track", async () => ({
    ok: true,
    result: { track: { id: "trk_it", title: "Lofi", previewUrl: "https://audio-ssl.itunes.apple.com/x.m4a" }, playCount: 1, audioUrl: null },
  }));
  const result = await executeToolCall({ actor: { userId: "u4" } }, () => null, lensActions, {
    tool: "run_lens_action",
    params: { domain: "music", action: "play-track", params: { id: "trk_it" } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(guardPlaybackClaim("Now playing Lofi.", [result]), "Now playing Lofi.");
});

test("guardPlaybackClaim retracts false playing claim when no audio was produced", () => {
  const answer = 'Track "INC127 Test Tune" has been added to your library and is now playing.';
  const corrected = guardPlaybackClaim(answer, []);
  assert.doesNotMatch(corrected, /now playing/i);
  assert.match(corrected, /no audio was produced/);
});

test("guardPlaybackClaim leaves answer unchanged when an audio artifact exists", () => {
  const answer = "Here is your song, playing now.";
  const results = [{ tool: "generate_music", ok: true, artifact: { kind: "audio", url: "/api/media/x/stream" } }];
  assert.equal(guardPlaybackClaim(answer, results), answer);
});

test("guardPlaybackClaim leaves unrelated answer unchanged", () => {
  const answer = "The weather is nice today.";
  assert.equal(guardPlaybackClaim(answer, []), answer);
});

test("guardPlaybackClaim retracts false generation claim when no audio was produced", () => {
  const answer = "I created a short synthwave song for you.";
  const corrected = guardPlaybackClaim(answer, []);
  assert.doesNotMatch(corrected, /created a short synthwave song/);
  assert.match(corrected, /no audio was produced/);
});

test("shouldSkipToolFollowup grants one retry for retryable failures with allowRetry", () => {
  const failure = { ok: false, error: "unknown tool: x.y", retryHint: "try this" };
  assert.equal(shouldSkipToolFollowup([failure], { allowRetry: true }), false);
  assert.equal(shouldSkipToolFollowup([failure]), true);
});

test("shouldSkipToolFollowup does not grant retry when failure has no hint", () => {
  const failure = { ok: false, error: "something exploded" };
  assert.equal(shouldSkipToolFollowup([failure], { allowRetry: true }), true);
});

test("shouldSkipToolFollowup grants retry for validActions or required/missing errors", () => {
  assert.equal(
    shouldSkipToolFollowup([{ ok: false, error: "not registered", validActions: ["a", "b"] }], { allowRetry: true }),
    false,
  );
  assert.equal(
    shouldSkipToolFollowup([{ ok: false, error: "missing required param: id" }], { allowRetry: true }),
    false,
  );
});

test("formatToolResults includes retryHint and validActions for failed results", () => {
  const rendered = formatToolResults([
    { tool: "x", ok: false, error: "missing", retryHint: "[TOOL_CALL: ...]", validActions: ["a", "b"] },
  ]);
  assert.match(rendered, /Hint: \[TOOL_CALL: \.\.\.\]/);
  assert.match(rendered, /Valid actions: a, b/);
});

test("unknown tool music.track-list is auto-dispatched as run_lens_action", async () => {
  const handlers = freshMusicRegistry();
  const ctx = { actor: { userId: "u4" } };
  handlers["music.track-add"](ctx, null, { title: "Listed" });

  const lensActions = new Map();
  lensActions.set("music.track-list", handlers["music.track-list"]);
  const result = await executeToolCall(ctx, () => null, lensActions, {
    tool: "music.track-list",
    params: {},
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.key, "music.track-list");
  assert.equal(result.result.result.count, 1);
});

test("TOOL_SCHEMA_BLOCK does not advertise music.render and states the cannot-generate limit", () => {
  assert.doesNotMatch(TOOL_SCHEMA_BLOCK, /music\.render/);
  assert.match(TOOL_SCHEMA_BLOCK, /cannot generate recorded audio/);
});

test("runAgentLoop grants one retry then answers from tool results on second failure", async () => {
  const prevMacros = globalThis._concordMACROS;
  globalThis._concordMACROS = new Map();
  let brainCalls = 0;
  const brain = async () => {
    brainCalls += 1;
    if (brainCalls === 1) {
      return {
        ok: true,
        text: '[TOOL_CALL: {"tool":"music.does_not_exist","params":{}}]',
        provider: "test", model: "test",
      };
    }
    if (brainCalls === 2 || brainCalls === 3) {
      // Recovery turns are capped (CONCORD_AGENT_TOOL_RETRIES, default 2):
      // the third all-failed turn is answered from the results.
      return {
        ok: true,
        text: '[TOOL_CALL: {"tool":"music.also_missing","params":{}}]',
        provider: "test", model: "test",
      };
    }
    return { ok: true, text: "Final.", provider: "test", model: "test" };
  };
  try {
    const result = await runAgentLoop({
      db: null,
      userId: "u5",
      message: "call missing music actions",
      runMacro: null,
      lensActions: new Map(),
      history: [],
      opts: { maxTurns: 5, brainChat: brain, shadowContext: false, actionMemory: false },
    });
    assert.equal(result.ok, true);
    assert.ok(brainCalls >= 2, "must retry at least once");
    assert.match(result.answer, /couldn't complete/);
  } finally {
    if (prevMacros === undefined) delete globalThis._concordMACROS;
    else globalThis._concordMACROS = prevMacros;
  }
});
