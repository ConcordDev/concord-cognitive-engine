// FIX-experience-008 — the heading-order leg. The haiku lane's PARTIAL
// (116824f33) closed the naming/contrast legs; the remaining code-level
// defect was CareerPortfolio: its three section headings (Skills ·
// Experience · Education) were <h3> directly under the frame's <h1>
// with no <h2> anywhere in the view — a skipped level on every
// Portfolio render. They are the view's top-level headings (the sibling
// sections open with their own <h2>), so they now render as <h2> with
// identical classes. The Lighthouse score itself re-runs at the desk
// post-deploy; this pin holds the markup the re-run will measure.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

describe("experience heading order (FIX-experience-008)", () => {
  it("CareerPortfolio has no h3 — its section headings are h2 under the frame h1", () => {
    const src = read("components/experience/CareerPortfolio.tsx");
    assert.equal((src.match(/<h3/g) || []).length, 0, "no h3 remains in CareerPortfolio");
    for (const label of ["Skills", "Experience", "Education"]) {
      assert.ok(new RegExp(`<h2[^>]*>[\\s\\S]{0,120}${label}`).test(src), `${label} renders as an h2`);
    }
  });

  it("the sibling sections keep their sequential shape (h2 section title, h3 subsections)", () => {
    const tools = read("components/experience/AnalysisTools.tsx");
    assert.ok(tools.includes("<h2"), "AnalysisTools opens with an h2");
    const suite = read("components/experience/UXResearchSuite.tsx");
    assert.ok(/<h2[^>]*>UX Research Suite<\/h2>/.test(suite), "the suite's own title is an h2");
    assert.equal((suite.match(/<h3/g) || []).length, 1, "the suite's only h3 is its SectionHeader subsection component");
    assert.ok(suite.indexOf("function SectionHeader") < suite.indexOf("<h2"), "SectionHeader renders under the suite title");
  });
});
