// FIX-fitness-003 — segments, clubs and challenges are shared
// platform-wide BY DESIGN (Strava parity); activities, goals, PRs and
// gear are per-user. Two things were wrong: the domain's parity
// comments claimed everything was per-user scoped, and the create
// flows never told the member the thing they were making is public.
// The comments now state the real split, and each create form carries
// the shared note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domain = readFileSync(join(root, "server", "domains", "fitness.js"), "utf8");
const segments = readFileSync(join(root, "concord-frontend", "components", "fitness", "StravaSegmentsPanel.tsx"), "utf8");
const clubs = readFileSync(join(root, "concord-frontend", "components", "fitness", "StravaClubsPanel.tsx"), "utf8");

test("the parity comments state the real scoping split", () => {
  assert.doesNotMatch(domain, /clubs, challenges\. All STATE-backed, per-user/, "the false all-per-user claim is gone");
  assert.match(domain, /segments, clubs\s*\n?\s*\/\/ and challenges are SHARED platform-wide/, "the split is stated where the set is introduced");
});

test("each shared create flow tells the member it is public", () => {
  assert.match(segments, /Shared with everyone on Concord — segments are public leaderboards/);
  assert.match(clubs, /Shared with everyone on Concord — clubs are public and anyone can join/);
  assert.match(clubs, /Shared with everyone on Concord — challenges are public and anyone can join/);
});
