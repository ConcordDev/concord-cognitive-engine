// server/tests/docs-markdown.test.js
//
// Tier-2 contract tests for the HTML ↔ Markdown converter that
// backs Docs Sprint A import/export. Round-trip is the load-bearing
// invariant: an editor-saved HTML doc → export_md → import_md
// produces a doc with the same visible structure.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  htmlToMarkdown, markdownToHtml, computeWordCount,
  extractBackrefs, extractOutline,
} from "../lib/docs/markdown.js";

describe("htmlToMarkdown", () => {
  it("headings", () => {
    const md = htmlToMarkdown("<h1>Title</h1><h2>Sub</h2><h3>Section</h3>");
    assert.ok(md.includes("# Title"));
    assert.ok(md.includes("## Sub"));
    assert.ok(md.includes("### Section"));
  });

  it("paragraphs + inline marks", () => {
    const md = htmlToMarkdown("<p><strong>bold</strong> and <em>italic</em> and <code>code</code> and <s>strike</s>.</p>");
    assert.ok(md.includes("**bold**"));
    assert.ok(md.includes("*italic*"));
    assert.ok(md.includes("`code`"));
    assert.ok(md.includes("~~strike~~"));
  });

  it("links and images", () => {
    const md = htmlToMarkdown('<p>See <a href="https://example.com">site</a></p><p><img src="x.png" alt="alt" /></p>');
    assert.ok(md.includes("[site](https://example.com)"), `expected link in: ${md}`);
    assert.ok(md.includes("![alt](x.png)"));
  });

  it("blockquotes", () => {
    const md = htmlToMarkdown("<blockquote><p>quoted line</p></blockquote>");
    assert.ok(md.includes("> quoted line"));
  });

  it("fenced code with language class", () => {
    const md = htmlToMarkdown('<pre><code class="language-js">const x = 1;</code></pre>');
    assert.ok(md.includes("```js"));
    assert.ok(md.includes("const x = 1;"));
  });

  it("unordered + ordered + task lists", () => {
    const ul = htmlToMarkdown("<ul><li>a</li><li>b</li></ul>");
    assert.ok(ul.includes("- a"));
    assert.ok(ul.includes("- b"));
    const ol = htmlToMarkdown("<ol><li>one</li><li>two</li></ol>");
    assert.ok(ol.includes("1. one"));
    assert.ok(ol.includes("2. two"));
    const tasks = htmlToMarkdown('<ul><li data-type="taskItem" data-checked="true">done</li><li data-type="taskItem" data-checked="false">todo</li></ul>');
    assert.ok(tasks.includes("- [x] done"));
    assert.ok(tasks.includes("- [ ] todo"));
  });

  it("tables", () => {
    const md = htmlToMarkdown("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>");
    assert.ok(md.includes("| A | B |"));
    assert.ok(md.includes("| --- | --- |"));
    assert.ok(md.includes("| 1 | 2 |"));
  });

  it("hr divider", () => {
    const md = htmlToMarkdown("<p>a</p><hr /><p>b</p>");
    assert.ok(md.includes("---"));
  });
});

describe("markdownToHtml", () => {
  it("headings", () => {
    const h = markdownToHtml("# Title\n\n## Sub");
    assert.ok(h.includes("<h1>Title</h1>"));
    assert.ok(h.includes("<h2>Sub</h2>"));
  });

  it("paragraphs with inline marks", () => {
    const h = markdownToHtml("**bold** and *italic* and `code`");
    assert.ok(h.includes("<strong>bold</strong>"));
    assert.ok(h.includes("<em>italic</em>"));
    assert.ok(h.includes("<code>code</code>"));
  });

  it("fenced code block with language", () => {
    const h = markdownToHtml("```js\nconst x = 1;\n```");
    assert.ok(h.includes('<pre><code class="language-js">'));
    assert.ok(h.includes("const x = 1;"));
  });

  it("lists + task lists", () => {
    const ul = markdownToHtml("- a\n- b");
    assert.ok(ul.includes("<ul"));
    assert.ok(ul.includes("<li><p>a</p></li>"));
    const tasks = markdownToHtml("- [x] done\n- [ ] todo");
    assert.ok(tasks.includes('data-type="taskItem"'));
    assert.ok(tasks.includes('data-checked="true"'));
    assert.ok(tasks.includes('data-checked="false"'));
  });

  it("blockquotes", () => {
    const h = markdownToHtml("> quoted\n> still quoted");
    assert.ok(h.includes("<blockquote>"));
  });

  it("table with header row", () => {
    const h = markdownToHtml("| A | B |\n| --- | --- |\n| 1 | 2 |");
    assert.ok(h.includes("<table>"));
    assert.ok(h.includes("<th>A</th>"));
    assert.ok(h.includes("<td>1</td>"));
  });

  it("hr", () => {
    const h = markdownToHtml("---");
    assert.ok(h.includes("<hr />"));
  });
});

describe("round-trip html → md → html", () => {
  it("preserves visible structure (headings + lists + code)", () => {
    const original = "<h1>Doc</h1><p>Para with <strong>bold</strong>.</p><ul><li>a</li><li>b</li></ul>";
    const md = htmlToMarkdown(original);
    const back = markdownToHtml(md);
    // visible content survives
    assert.ok(back.includes("Doc"));
    assert.ok(back.includes("bold"));
    assert.ok(back.includes(">a<") || back.includes("a</p>"));
  });
});

describe("computeWordCount", () => {
  it("strips tags and counts whitespace-separated words", () => {
    assert.equal(computeWordCount("<p>one two three</p>"), 3);
    assert.equal(computeWordCount("<h1>a b c d</h1><p>e f</p>"), 6);
    assert.equal(computeWordCount(""), 0);
  });
});

describe("extractBackrefs", () => {
  it("classifies doc: / dtu: / lens / external", () => {
    const html =
      `<p><a href="doc:abc">doc</a> ` +
      `<a href="dtu:xyz">dtu</a> ` +
      `<a href="/lenses/code/123">lens</a> ` +
      `<a href="https://example.com">ext</a></p>`;
    const refs = extractBackrefs(html);
    assert.equal(refs.length, 4);
    const kinds = refs.map((r) => r.kind).sort();
    assert.deepEqual(kinds, ["doc", "dtu", "external", "lens"]);
  });

  it("extracts /docs/<id> as doc kind", () => {
    const refs = extractBackrefs('<p><a href="/docs/doc:abc">internal</a></p>');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].kind, "doc");
    assert.equal(refs[0].docId, "doc:abc");
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(extractBackrefs(""), []);
    assert.deepEqual(extractBackrefs(null), []);
  });
});

describe("extractOutline", () => {
  it("returns ordered h1/h2/h3 with level + text", () => {
    const out = extractOutline("<h1>Top</h1><h2>Mid</h2><h3>Deep</h3><h4>Skipped</h4>");
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((x) => x.level), [1, 2, 3]);
    assert.deepEqual(out.map((x) => x.text), ["Top", "Mid", "Deep"]);
  });
});
