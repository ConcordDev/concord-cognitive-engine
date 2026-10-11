// Writers must not store String(object).toLowerCase() as a DTU tag.
// An object contributes its own string name, or it is dropped.
// The coercion artifact is refused in both "[object Object]" and
// "[object object]" (any letter case).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTagList,
  sanitizeDtuTags,
  scrubStoredTags,
  objectTagName,
} from "../lib/dtu-tags.js";
import { feedDtuTags } from "../lib/feed-manager.js";

describe("DTU tag writers", () => {
  it("feed DTU tags keep an object's name and never store [object object]", () => {
    const tags = feedDtuTags(
      {
        tags: ["News", { name: "Markets" }, { unexpected: true }, "[object Object]"],
        domain: "news",
      },
      { categories: [{ label: "Earnings" }, { nope: 1 }, "[object object]"] },
    );
    assert.ok(tags.includes("news"));
    assert.ok(tags.includes("markets"));
    assert.ok(tags.includes("earnings"));
    assert.ok(tags.includes("feed"));
    assert.ok(tags.includes("live"));
    assert.ok(tags.includes("lens:news"));
    assert.equal(tags.some((t) => /object object/i.test(t)), false);
  });

  it("create-style normalization does not String() an object, and drops both casings", () => {
    const tags = normalizeTagList(
      ["Concord", { tag: "Physics" }, { nope: true }, "[object Object]", "[object object]", "  [OBJECT OBJECT]  ", 7, null],
      (t) => String(t).replace(/\s+/g, " ").trim(),
    );
    assert.deepEqual(tags, ["Concord", "Physics", "7", "null"]);
    assert.equal(objectTagName({ name: "kept" }), "kept");
    assert.equal(objectTagName({ label: "[object Object]" }), null);
    assert.equal(objectTagName({}), null);
  });

  it("upsert sanitizer lowercases real tags and drops the coercion artifact", () => {
    const tags = sanitizeDtuTags([
      "Concord",
      { name: "Markets" },
      { unexpected: true },
      "[object Object]",
      "[object object]",
      7,
    ]);
    assert.deepEqual(tags, ["concord", "markets"]);
  });

  it("scrubStoredTags removes only the artifact and keeps every other tag as-is", () => {
    const original = ["Concord", "[object object]", { name: "Markets" }, "[object Object]", "feed"];
    const scrubbed = scrubStoredTags(original);
    assert.deepEqual(scrubbed, ["Concord", "Markets", "feed"]);
    const clean = ["Concord", "feed"];
    assert.equal(scrubStoredTags(clean), clean);
  });
});
