// server/tests/concordia-shared-world.test.js
//
// World lens step 2: players see each other in the shared world.
// Found 2026-09-27: (1) the Unity client ignored the server's city:positions
// feed, so everyone played alone; (2) the idle gate only counted HTTP traffic,
// so with players only on /unity-ws the server decided nobody was online and
// paused the city:positions broadcast. Verified live with two accounts: after
// the fix B receives A's moving positions.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const repo = new URL("../../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, repo), "utf8");
const scripts = "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/";

test("authenticated gateway gameplay traffic counts as activity (presence broadcast stays on)", () => {
  const server = read("server/server.js");
  const fn = server.slice(server.indexOf("function _onGodotClientMessage(client, evt, data) {"));
  assert.match(fn.slice(0, 900), /if \(userId\) \{ try \{ _markActivity\(\{ authed: true \}\); \}/);
});

test("the Unity client renders other players from city:positions, dressed as their account character", () => {
  const rp = read(scripts + "RemotePlayers.cs");
  assert.match(rp, /EndsWith\("city:positions"/);
  assert.match(rp, /u\.userId == self\) continue/, "never draws yourself");
  assert.match(rp, /LensRunAwait\("appearance", "game_characters_for"/);
  assert.match(rp, /StaleSeconds/, "players who leave disappear");
  assert.match(read(scripts + "ConcordiaGame.cs"), /RemotePlayers\.Install\(kernel\)/);
  assert.match(read(scripts + "ConcordClient.cs"), /public string UserId => _userId;/);
});

test("account character: creator opens for a first-time player and saves to the account", () => {
  const game = read(scripts + "ConcordiaGame.cs");
  assert.match(game, /kernel\.LoadAccountCharacter\(/);
  assert.match(game, /CharacterCreator\.Open\(_player\.person, _player, chase,/);
  assert.match(read(scripts + "CharacterCreator.cs"), /ConcordClient\.Live\?\.SaveAccountCharacter\(_look\)/);
});
