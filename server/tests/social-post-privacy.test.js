// FIX-social-006 — the composer's audience choice must be real:
// (1) createPost stores the validated choice instead of hardcoding
//     "public" (the read side, canViewPost, already enforces
//     private/followers/public);
// (2) the composer resets the selector to Public after a successful
//     post, so a one-off Private choice never silently sticks;
// (3) the Social home card badges non-public posts with their audience.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domain = readFileSync(join(root, "server", "domains", "social.js"), "utf8");
const composer = readFileSync(join(root, "concord-frontend", "components", "social", "QuickPostComposer.tsx"), "utf8");
const socPage = readFileSync(join(root, "concord-frontend", "app", "lenses", "social", "page.tsx"), "utf8");

test("createPost validates and stores the composer's privacy choice", () => {
  const i = domain.indexOf('registerLensAction("social", "createPost"');
  assert.ok(i >= 0, "createPost handler present");
  const block = domain.slice(i, i + 5200);
  assert.match(block, /\["public", "followers", "private"\]\.includes\(params\.privacy\)/, "privacy validated against the read-side vocabulary");
  assert.match(block, /privacy,\n\s+sensitive:/, "the stored post carries the validated privacy");
  assert.doesNotMatch(block, /privacy: "public",\n\s+sensitive:/, "privacy is no longer hardcoded public");
});

test("composer resets the audience to Public after a successful post", () => {
  const i = composer.indexOf("onSuccess: (data) => {");
  assert.ok(i >= 0, "composer onSuccess present");
  const block = composer.slice(i, i + 700);
  assert.match(block, /choosePrivacy\('public'\)/, "selector resets to Public on success");
});

test("social home card shows an audience badge on non-public posts", () => {
  assert.match(socPage, /item\.privacy === 'private'/, "private posts are badged");
  assert.match(socPage, /item\.privacy === 'followers'/, "followers posts are badged");
  assert.match(socPage, /privacy\?: string;/, "the feed item type carries privacy");
});
