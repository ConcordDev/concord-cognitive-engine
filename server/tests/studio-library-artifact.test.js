// server/tests/studio-library-artifact.test.js
//
// A mix saved from Studio's Export dialog is an uploaded artifact DTU
// (POST /api/artifact/upload). The Studio Sounds browser must list it as
// audio with a URL it can fetch and drop on the timeline.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerStudioActions from "../domains/studio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const call = (name, ctx, params = {}) => ACTIONS.get(`studio.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);

before(() => { registerStudioActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "u_artist" }, userId: "u_artist" };

describe("studio.library-browse lists uploaded mixes with a fetchable url", () => {
  it("classifies an audio artifact by its stored type and points at the download route", () => {
    const S = globalThis._concordSTATE;
    S.dtus.set("artifact_mix1", {
      id: "artifact_mix1", title: "My Song", ownerId: "u_artist", domain: "music",
      machine: { kind: "audio" }, artifact: { type: "audio/wav", filename: "My Song.wav", hash: "abc", sizeBytes: 1000 },
      createdAt: "2026-10-22T10:00:00Z",
    });
    S.dtus.set("artifact_img", {
      id: "artifact_img", title: "Cover", ownerId: "u_artist", domain: "art",
      artifact: { type: "image/png", filename: "cover.png", hash: "def" },
    });
    S.dtus.set("artifact_other", {
      id: "artifact_other", title: "Their mix", ownerId: "u_other", domain: "music",
      artifact: { type: "audio/wav", filename: "theirs.wav", hash: "ghi" },
    });
    const items = call("library-browse", ctxA, {}).result.items;
    assert.deepEqual(items.map((i) => i.id), ["artifact_mix1"]);
    assert.equal(items[0].kind, "audio");
    assert.equal(items[0].url, "/api/artifact/artifact_mix1/download");
  });

  it("keeps an explicit url when the item has one", () => {
    globalThis._concordSTATE.dtus.set("d1", { id: "d1", title: "Kick.wav", author: "u_artist", data: { audioUrl: "/media/kick.wav" } });
    const items = call("library-browse", ctxA, {}).result.items;
    assert.equal(items[0].url, "/media/kick.wav");
  });
});
