/**
 * Tier-2 contract test — post view counting distinguishes distinct viewers.
 *
 * `viewStory` and `recordWatchTime` both accepted `userId` and referenced it
 * nowhere (found 2026-07-25 by the unused-destructured-param detector), so
 * `viewCount` was a raw increment one user could inflate without limit and
 * there was no way to ask how many distinct people had seen a post.
 * `votePoll` in the same module already uses `userId` to dedupe, so ignoring
 * it here was an oversight rather than a design choice.
 *
 * Pinned behavior (deliberately additive — `viewCount` keeps its existing
 * "total views" meaning so existing callers are unaffected):
 *   - repeat views by one user raise viewCount but NOT uniqueViewCount
 *   - distinct users raise both
 *   - an anonymous view counts toward the total and adds no unique viewer
 *
 * Run: node --test tests/social-unique-viewers.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createPost, viewStory, recordWatchTime } from "../emergent/social-layer.js";

let STATE;
let postId;

beforeEach(() => {
  STATE = {};
  const created = createPost(STATE, { userId: "author_1", content: "hello world" });
  assert.equal(created.ok, true, `createPost failed: ${JSON.stringify(created)}`);
  postId = created.postId || created.id || created.post?.id;
  assert.ok(postId, `could not determine post id from ${JSON.stringify(created)}`);
});

describe("viewStory — unique viewer tracking", () => {
  it("counts one unique viewer no matter how many times the same user views", () => {
    viewStory(STATE, { userId: "u1", storyId: postId });
    viewStory(STATE, { userId: "u1", storyId: postId });
    const third = viewStory(STATE, { userId: "u1", storyId: postId });

    assert.equal(third.ok, true);
    // Total views still counts every view — the pre-existing meaning.
    assert.equal(third.viewCount, 3, "viewCount must remain a total-view counter");
    // The regression this test exists for: userId was ignored entirely.
    assert.equal(third.uniqueViewCount, 1, "one user viewing 3x is ONE unique viewer");
  });

  it("counts distinct users separately", () => {
    viewStory(STATE, { userId: "u1", storyId: postId });
    viewStory(STATE, { userId: "u2", storyId: postId });
    const r = viewStory(STATE, { userId: "u3", storyId: postId });

    assert.equal(r.viewCount, 3);
    assert.equal(r.uniqueViewCount, 3);
  });

  it("an anonymous view counts toward the total but adds no unique viewer", () => {
    viewStory(STATE, { userId: "u1", storyId: postId });
    const anon = viewStory(STATE, { storyId: postId });

    assert.equal(anon.viewCount, 2, "an anonymous view is still a view");
    assert.equal(
      anon.uniqueViewCount,
      1,
      "with no userId we must not invent an identity to inflate the unique count",
    );
  });

  it("still refuses a missing story honestly", () => {
    const r = viewStory(STATE, { userId: "u1", storyId: "does_not_exist" });
    assert.equal(r.ok, false);
  });
});

describe("recordWatchTime — same tracking, and watch time still accumulates", () => {
  it("accumulates watch time while deduping the viewer", () => {
    recordWatchTime(STATE, { userId: "u1", postId, durationMs: 1000 });
    const second = recordWatchTime(STATE, { userId: "u1", postId, durationMs: 500 });

    assert.equal(second.ok, true);
    assert.equal(second.watchTimeMs, 1500, "watch time must still sum across views");
    assert.equal(second.viewCount, 2);
    assert.equal(second.uniqueViewCount, 1, "same user twice is ONE unique viewer");
  });

  it("shares the viewer set with viewStory (one post, one audience)", () => {
    viewStory(STATE, { userId: "u1", storyId: postId });
    const r = recordWatchTime(STATE, { userId: "u1", postId, durationMs: 250 });
    assert.equal(
      r.uniqueViewCount,
      1,
      "the same person reaching a post through either path is not two people",
    );
  });

  it("treats a missing durationMs as zero rather than NaN", () => {
    const r = recordWatchTime(STATE, { userId: "u1", postId });
    assert.equal(r.ok, true);
    assert.equal(r.watchTimeMs, 0);
  });
});
