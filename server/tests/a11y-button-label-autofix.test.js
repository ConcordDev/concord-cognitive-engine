/**
 * Tier-2 contract tests for the a11y-button-label autofix.
 *
 * Pinned:
 *   - matches finding id 'a11y_button_no_label'
 *   - rewrites <button><X /></button> → <button aria-label="Close"><X /></button>
 *   - rewrites <Heart /> → "Like" (canonical mapping)
 *   - falls back to CamelCase-to-words for unknown icons
 *   - refuses buttons that already have aria-label
 *   - refuses buttons whose children contain text (not single-icon)
 *   - refuses on multi-icon / JSX-expression children
 *   - registered under id 'a11y_button_label'
 *
 * Run: node --test tests/a11y-button-label-autofix.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { a11yButtonLabelFix } from "../lib/autofix/a11y-button-label.js";
import { listFixes, getFix } from "../lib/autofix/index.js";

describe("a11yButtonLabelFix — matching", () => {
  it("matches a11y_button_no_label finding id", () => {
    assert.equal(a11yButtonLabelFix.matchFinding({ id: "a11y_button_no_label" }), true);
    assert.equal(a11yButtonLabelFix.matchFinding({ id: "broken_link" }), false);
  });
});

describe("a11yButtonLabelFix — apply", () => {
  it("injects aria-label='Close' for <X />", () => {
    const src = `<button onClick={() => {}}><X className="w-4" /></button>\n`;
    const finding = { id: "a11y_button_no_label", location: "concord-frontend/components/foo.tsx:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.ok(out, "must rewrite");
    assert.match(out, /aria-label="Close"/);
    assert.match(out, /<X className="w-4" \/>/);
  });

  it("injects aria-label='Like' for <Heart />", () => {
    const src = `<button onClick={() => {}}><Heart /></button>\n`;
    const finding = { id: "a11y_button_no_label", location: "concord-frontend/components/foo.tsx:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.match(out, /aria-label="Like"/);
  });

  it("falls back to CamelCase-to-words for unknown icons", () => {
    const src = `<button><FooBarBaz /></button>\n`;
    const finding = { id: "a11y_button_no_label", location: "f:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.match(out, /aria-label="Foo bar baz"/);
  });

  it("refuses when aria-label already exists", () => {
    const src = `<button aria-label="Already labeled"><X /></button>\n`;
    const finding = { id: "a11y_button_no_label", location: "f:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.equal(out, null);
  });

  it("refuses when children contain text", () => {
    const src = `<button><X /> Save</button>\n`;
    const finding = { id: "a11y_button_no_label", location: "f:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.equal(out, null);
  });

  it("refuses when button has {...spread}", () => {
    const src = `<button {...props}><X /></button>\n`;
    const finding = { id: "a11y_button_no_label", location: "f:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.equal(out, null);
  });

  it("refuses when children contain a JSX expression", () => {
    const src = `<button>{showFoo ? <X /> : <Y />}</button>\n`;
    const finding = { id: "a11y_button_no_label", location: "f:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.equal(out, null);
  });

  it("returns null when the line doesn't contain a <button> open tag", () => {
    const src = `const x = 1;\nconst y = 2;\n`;
    const finding = { id: "a11y_button_no_label", location: "f:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.equal(out, null);
  });

  it("preserves existing attrs and spacing", () => {
    const src = `<button onClick={handle} className="px-2 py-1"><Settings /></button>\n`;
    const finding = { id: "a11y_button_no_label", location: "f:1" };
    const out = a11yButtonLabelFix.apply(src, finding);
    assert.match(out, /onClick=\{handle\}/);
    assert.match(out, /className="px-2 py-1"/);
    assert.match(out, /aria-label="Settings"/);
  });
});

describe("a11yButtonLabelFix — registry", () => {
  it("is registered with id 'a11y_button_label'", () => {
    const ids = listFixes().map(f => f.id);
    assert.ok(ids.includes("a11y_button_label"));
    assert.ok(getFix("a11y_button_label"));
  });
});
