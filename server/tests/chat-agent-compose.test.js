// server/tests/chat-agent-compose.test.js
//
// INC-127 part 2: chat-agent artifact wiring for studio.compose and audio URLs.

import test from "node:test";
import assert from "node:assert/strict";
import {
  executeToolCall,
  formatToolResults,
  TOOL_SCHEMA_BLOCK,
} from "../lib/chat-agent.js";
import { guardPlaybackClaim } from "../lib/chat/playback-honesty.js";
import registerStudioActions from "../domains/studio.js";

function freshStudioRegistry() {
  const handlers = {};
  const register = (domain, action, fn) => {
    handlers[`${domain}.${action}`] = fn;
  };
  globalThis._concordSTATE = {};
  registerStudioActions(register);
  return handlers;
}

const ctx = { actor: { userId: "u_compose_chat" }, userId: "u_compose_chat" };

test("run_lens_action studio.compose yields a song artifact with projectId", async () => {
  const handlers = freshStudioRegistry();
  const lensActions = new Map();
  lensActions.set("studio.compose", handlers["studio.compose"]);

  const result = await executeToolCall(ctx, () => null, lensActions, {
    tool: "run_lens_action",
    params: { domain: "studio", action: "compose", params: { title: "Chat Song", genre: "lofi", bars: 4, seed: 7 } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.artifacts, "artifacts array present");
  const songArtifact = result.artifacts.find(a => a.kind === "song");
  assert.ok(songArtifact, "song artifact attached");
  const projectId = result?.result?.result?.project?.id;
  assert.ok(projectId, "project id returned");
  assert.equal(songArtifact.projectId, projectId);
  assert.equal(songArtifact.title, "Chat Song");
  assert.equal(songArtifact.bpm, 85);
  assert.equal(songArtifact.key, "C");
});

test("formatToolResults for compose omits raw note arrays", async () => {
  const handlers = freshStudioRegistry();
  const lensActions = new Map();
  lensActions.set("studio.compose", handlers["studio.compose"]);

  const result = await executeToolCall(ctx, () => null, lensActions, {
    tool: "run_lens_action",
    params: { domain: "studio", action: "compose", params: { title: "Chat Song", genre: "lofi", bars: 4, seed: 7 } },
  });
  const rendered = formatToolResults([result]);
  assert.match(rendered, /Composed "Chat Song"/);
  assert.doesNotMatch(rendered, /"notes":\s*\[/);
  assert.doesNotMatch(rendered, /"midiNotes":/);
});

test("run_lens_action result with track.previewUrl yields kind:audio artifact", async () => {
  const lensActions = new Map();
  lensActions.set("music.ingest-itunes", async () => ({
    ok: true,
    result: {
      tracks: [
        { id: "trk_1", title: "Lofi Dreams", artist: "Test Artist", previewUrl: "https://audio-ssl.itunes.apple.com/x.m4a" },
      ],
    },
  }));

  const result = await executeToolCall(ctx, () => null, lensActions, {
    tool: "run_lens_action",
    params: { domain: "music", action: "ingest-itunes", params: { term: "lofi" } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const audioArtifact = result.artifacts?.find(a => a.kind === "audio");
  assert.ok(audioArtifact, "audio artifact attached");
  assert.equal(audioArtifact.url, "https://audio-ssl.itunes.apple.com/x.m4a");
  assert.equal(audioArtifact.title, "Lofi Dreams");
  assert.equal(audioArtifact.artist, "Test Artist");
});

test("guardPlaybackClaim allows playing claim with a song artifact", () => {
  const answer = "Now playing your song.";
  const results = [{ tool: "run_lens_action", ok: true, artifacts: [{ kind: "song", projectId: "p1" }] }];
  assert.equal(guardPlaybackClaim(answer, results), answer);
});

test("guardPlaybackClaim allows playing claim with an audio artifact", () => {
  const answer = "Now playing your track.";
  const results = [{ tool: "run_lens_action", ok: true, artifacts: [{ kind: "audio", url: "/api/media/x/stream" }] }];
  assert.equal(guardPlaybackClaim(answer, results), answer);
});

test("TOOL_SCHEMA_BLOCK advertises studio compose and ingest-itunes, and does not claim audio is impossible", () => {
  assert.match(TOOL_SCHEMA_BLOCK, /studio.*compose/s);
  assert.match(TOOL_SCHEMA_BLOCK, /ingest-itunes/);
  assert.doesNotMatch(TOOL_SCHEMA_BLOCK, /cannot generate song audio yet/i);
});

test("ingest-itunes style results lift at most 3 audio artifacts", async () => {
  const tracks = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: "A", previewUrl: `https://audio-ssl.itunes.apple.com/x/mzaf_${i}.plus.aac.p.m4a` }));
  const lensActions = new Map([["music.ingest-itunes", async () => ({ ok: true, result: { tracks, count: 10 } })]]);
  const r = await executeToolCall(ctx, null, lensActions, { tool: "run_lens_action", params: { domain: "music", action: "ingest-itunes", params: { term: "lofi" } } });
  assert.equal(r.ok, true);
  const audio = (r.artifacts || []).filter((a) => a.kind === "audio");
  assert.equal(audio.length, 3);
  assert.equal(audio[0].title, "Song 0");
  assert.equal(audio[0].mimeType, "audio/x-m4a");
});

test("tool failure replies don't end in a double period", async () => {
  const { composeToolTurnReply } = await import("../lib/chat/tool-turn-reply.js");
  const reply = composeToolTurnReply([{ tool: "run_lens_action", ok: false, error: "nothing can be played." }]);
  assert.ok(!reply.includes(".."), reply);
});

test("prompt routes real/existing music to ingest-itunes and new songs to compose, without claiming auto-play", () => {
  assert.match(TOOL_SCHEMA_BLOCK, /REAL \/ EXISTING music[\s\S]*"action": "ingest-itunes"[\s\S]*Never compose for these/);
  assert.match(TOOL_SCHEMA_BLOCK, /A NEW song[\s\S]*"action": "compose"/);
  assert.match(TOOL_SCHEMA_BLOCK, /never say it is already playing/);
});
