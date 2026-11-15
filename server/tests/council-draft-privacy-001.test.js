// FIX-council-001 — a council draft is its author's alone until the
// author moves it on. Before: proposals live in one shared store and
// proposal-list returned every proposal (drafts included) to any
// signed-in member, and the create entry in the shared audit trail
// carried the draft's title. Behaviour is probe-verified on the real
// module (author sees own draft; others don't; draft not votable by
// others; audit title-free; publish restores shared visibility).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "domains", "council.js"), "utf8");

test("drafts are scoped to their author on the read paths", () => {
  assert.match(src, /function cCanSeeProposal\(p, userId\) \{\s*return !!p && \(p\.status !== "draft" \|\| p\.authorId === userId\);/, "one visibility rule for drafts");
  const i = src.indexOf('registerLensAction("council", "proposal-list"');
  assert.match(src.slice(i, i + 700), /\.filter\(\(p\) => cCanSeeProposal\(p, viewerId\)\)/, "proposal-list filters drafts for non-authors");
  const v = src.indexOf('registerLensAction("council", "proposal-vote"');
  assert.match(src.slice(v, v + 800), /if \(!p \|\| !cCanSeeProposal\(p, userId\)\) return \{ ok: false, error: "proposal not found" \}/, "a draft is not findable — or votable — by non-authors");
});

test("the shared audit trail never carries a draft's title at creation", () => {
  const i = src.indexOf('registerLensAction("council", "proposal-create"');
  const block = src.slice(i, i + 2600);
  assert.match(block, /details: "Draft proposal"/);
  assert.doesNotMatch(block, /details: proposal\.title/);
});
