import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catalogMatchesQuery } from "./catalog-search";

const course = {
  title: "Linear Algebra",
  description: "Vectors",
  category: "math",
  instructor: "Ada",
  institution: "Concord",
};

describe("catalog search", () => {
  it("matches title, description, category, instructor, and institution while typing", () => {
    assert.equal(catalogMatchesQuery(course, "alg"), true);
    assert.equal(catalogMatchesQuery(course, "vec"), true);
    assert.equal(catalogMatchesQuery(course, "math"), true);
    assert.equal(catalogMatchesQuery(course, "ada"), true);
    assert.equal(catalogMatchesQuery(course, "concord"), true);
  });

  it("keeps the list when the query is blank and hides a miss", () => {
    assert.equal(catalogMatchesQuery(course, "   "), true);
    assert.equal(catalogMatchesQuery(course, "biology"), false);
  });
});
