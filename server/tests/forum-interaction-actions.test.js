// Forum interaction actions — feature tests (prerequisite for SEC Fix 7).
//
// BoardPanel persisted votes, comment votes, comments, saves and awards
// by rewriting the WHOLE post artifact through the generic lens.update.
// Fix 7 closes lens.update to non-owners on social domains, so those
// interactions needed a proper server path first: the forum.post-vote /
// post-comment / post-save / post-award artifact actions in server.js,
// each applying ONLY the caller's own change via lib/forum-interactions.js.
//
// Three layers:
//   1. Unit tests for the pure reducers in lib/forum-interactions.js.
//   2. Source assertions on the server.js handlers (auth gate first,
//      removed-post refusal, reducer applied to the artifact only).
//   3. Source assertions on BoardPanel.tsx: the five interaction sites
//      call the new actions, and updateForumPost survives ONLY in the
//      moderator lock path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  applyBallot,
  findCommentInTree,
  countCommentTree,
  appendCommentTree,
  applyAward,
  toggleSavedBy,
} from "../lib/forum-interactions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const BOARD_PANEL = readFileSync(
  path.join(__dirname, "..", "..", "concord-frontend", "components", "forum", "BoardPanel.tsx"),
  "utf8",
);

describe("forum-interactions — applyBallot", () => {
  it("records one ballot per user and moves the score by the delta", () => {
    const item = { score: 5 };
    assert.deepEqual(applyBallot(item, "u1", 1), { score: 6, userVote: 1 });
    assert.deepEqual(applyBallot(item, "u2", 1), { score: 7, userVote: 1 });
    assert.deepEqual(applyBallot(item, "u2", -1), { score: 5, userVote: -1 });
    assert.equal(item.voters.u1, 1);
    assert.equal(item.voters.u2, -1);
  });

  it("clicking the same direction again retracts the ballot", () => {
    const item = { score: 3, voters: { u1: 1 } };
    assert.deepEqual(applyBallot(item, "u1", 1), { score: 2, userVote: 0 });
    assert.deepEqual(item.voters, {});
  });

  it("direction 0 clears the ballot", () => {
    const item = { score: 3, voters: { u1: -1 } };
    assert.deepEqual(applyBallot(item, "u1", 0), { score: 4, userVote: 0 });
  });

  it("a legacy item without a voters map starts its ledger from the net score", () => {
    const item = { score: 42 };
    const out = applyBallot(item, "u9", 1);
    assert.equal(out.score, 43);
    assert.deepEqual(item.voters, { u9: 1 });
  });
});

describe("forum-interactions — comment tree helpers", () => {
  const tree = () => ([
    { id: "c1", replies: [{ id: "c2", replies: [] }] },
    { id: "c3", replies: [] },
  ]);

  it("finds comments at any depth and misses cleanly", () => {
    assert.equal(findCommentInTree(tree(), "c2")?.id, "c2");
    assert.equal(findCommentInTree(tree(), "nope"), null);
    assert.equal(findCommentInTree(null, "c1"), null);
  });

  it("counts the whole tree", () => {
    assert.equal(countCommentTree(tree()), 3);
    assert.equal(countCommentTree([]), 0);
    assert.equal(countCommentTree(undefined), 0);
  });

  it("appends top-level and nested comments; unknown parent refuses", () => {
    const comments = tree();
    assert.equal(appendCommentTree(comments, null, { id: "c4", replies: [] }), true);
    assert.equal(appendCommentTree(comments, "c2", { id: "c5", replies: [] }), true);
    assert.equal(countCommentTree(comments), 5);
    assert.equal(appendCommentTree(comments, "ghost", { id: "c6", replies: [] }), false);
    assert.equal(countCommentTree(comments), 5);
  });
});

describe("forum-interactions — applyAward + toggleSavedBy", () => {
  it("an award appends and applies the +10 score bump", () => {
    const item = { score: 1, awards: [] };
    const out = applyAward(item, "🔥");
    assert.deepEqual(out.awards, ["🔥"]);
    assert.equal(out.score, 11);
  });

  it("save toggles only the caller's own entry", () => {
    const item = {};
    assert.deepEqual(toggleSavedBy(item, "u1"), { saved: true });
    assert.deepEqual(toggleSavedBy(item, "u2"), { saved: true });
    assert.deepEqual(item.savedBy, ["u1", "u2"]);
    assert.deepEqual(toggleSavedBy(item, "u1"), { saved: false });
    assert.deepEqual(item.savedBy, ["u2"]);
  });
});

describe("forum interaction actions — server.js handler wiring (source order)", () => {
  function block(startMarker, endMarker) {
    const start = SERVER_JS.indexOf(startMarker);
    assert.ok(start > 0, `found: ${startMarker}`);
    const end = SERVER_JS.indexOf(endMarker, start + 1);
    assert.ok(end > start, `found end: ${endMarker}`);
    return SERVER_JS.slice(start, end);
  }

  it("server.js imports the reducers from lib/forum-interactions.js", () => {
    assert.ok(SERVER_JS.includes('from "./lib/forum-interactions.js"'), "import present");
  });

  for (const [action, reducer] of [
    ["post-vote", "applyBallot"],
    ["post-comment", "appendCommentTree"],
    ["post-save", "toggleSavedBy"],
    ["post-award", "applyAward"],
  ]) {
    it(`forum.${action}: auth gate + post check precede the ${reducer} mutation`, () => {
      const startMarker = `registerLensAction("forum", "${action}"`;
      const start = SERVER_JS.indexOf(startMarker);
      assert.ok(start > 0, `found: ${action}`);
      const body = SERVER_JS.slice(start, start + 2600);
      const gateAt = body.indexOf("_forumInteractionDenial(ctx)");
      const postAt = body.indexOf("_forumPostArtifact(artifact)");
      const mutateAt = body.indexOf(reducer);
      assert.ok(gateAt > 0, `${action}: auth gate called`);
      assert.ok(postAt > gateAt, `${action}: post check after auth gate`);
      assert.ok(mutateAt > postAt, `${action}: reducer applied after both checks`);
    });
  }

  it("the shared gate refuses anon with the 401 shape and removed posts read as not found", () => {
    assert.ok(SERVER_JS.includes('code: "AUTH_REQUIRED", error: "sign in required"'), "401 shape present");
    assert.ok(SERVER_JS.includes("if (artifact.data?.removed) return null;"), "removed posts refused");
  });

  it("post-comment refuses locked posts and stamps the author from ctx, not params", () => {
    const start = SERVER_JS.indexOf('registerLensAction("forum", "post-comment"');
    const body = SERVER_JS.slice(start, start + 2600);
    assert.ok(body.includes("post is locked"), "locked refusal present");
    assert.ok(body.includes("authorId: userId"), "author stamped from ctx");
    assert.ok(!body.includes("params.author"), "author never taken from params");
  });
});

describe("forum interaction actions — BoardPanel wiring (source assertions)", () => {
  it("all five interaction sites call the server actions via persistInteraction", () => {
    for (const action of ["post-vote", "post-comment", "post-save", "post-award"]) {
      assert.ok(BOARD_PANEL.includes(`'${action}'`), `BoardPanel calls ${action}`);
    }
    assert.ok(BOARD_PANEL.includes("persistInteraction"), "shared persistence helper present");
  });

  it("updateForumPost survives only in the destructure and the moderator lock path", () => {
    const uses = BOARD_PANEL.split("\n").filter((l) => l.includes("updateForumPost"));
    // destructure + lock call + lock dependency array = 3 lines, no more.
    assert.equal(uses.length, 3, `expected 3 updateForumPost lines, got: ${uses.join(" | ")}`);
    const lockBlock = BOARD_PANEL.slice(BOARD_PANEL.indexOf("handleModAction"));
    assert.ok(lockBlock.includes("updateForumPost(postId,"), "the surviving call is the lock path");
  });

  it("the sync effect derives the viewer's vote/save from the server ledgers", () => {
    assert.ok(BOARD_PANEL.includes("d.voters[viewerId]"), "post userVote derived from voters");
    assert.ok(BOARD_PANEL.includes("d.savedBy.includes(viewerId)"), "saved derived from savedBy");
    assert.ok(BOARD_PANEL.includes("deriveCommentVotes"), "comment votes derived too");
  });
});
