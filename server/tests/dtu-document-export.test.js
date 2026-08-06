// server/tests/dtu-document-export.test.js
//
// lib/dtu-document-export.js — converts a real DTU into a real file buffer,
// reusing the existing pdfkit-based renderPDF() (lib/renderers/pdf-renderer.js
// — the same one 18 domains' auto-rendered documents already go through)
// and the newly-wired lib/renderers/zip-renderer.js. Every assertion here
// checks real bytes (PDF magic number, real zip entries readable back out),
// not just "a buffer was returned."

import test from "node:test";
import assert from "node:assert/strict";
import {
  renderDtuAsFile, dtuToMarkdown, dtuToJson, dtusToCsv, DOCUMENT_EXPORT_FORMATS,
} from "../lib/dtu-document-export.js";
import { listZipEntries, readZipEntryText } from "../lib/renderers/zip-renderer.js";

function sampleDtu(overrides = {}) {
  return {
    id: "dtu_sample1", title: "Sample Spec", domain: "code", tags: ["spec", "api"],
    createdAt: "2026-01-01T00:00:00.000Z",
    human: { summary: "A real spec for the widget API.", bullets: ["fast", "typed"] },
    core: { claims: ["Returns 200 on success"], definitions: ["Widget: a thing"], invariants: [], examples: [], nextActions: [] },
    machine: { kind: "spec", owner: "team-x" },
    ...overrides,
  };
}

test("renderDtuAsFile produces a real PDF (magic bytes, real content, non-trivial size)", async () => {
  const r = await renderDtuAsFile(sampleDtu(), "pdf");
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, "application/pdf");
  assert.equal(r.buffer.slice(0, 4).toString(), "%PDF");
  assert.ok(r.buffer.length > 500, "a real rendered PDF should be more than a trivial stub");
  assert.equal(r.filename, "sample-spec.pdf");
});

test("renderDtuAsFile produces real markdown with the DTU's actual content", async () => {
  const r = await renderDtuAsFile(sampleDtu(), "md");
  assert.equal(r.ok, true);
  const text = r.buffer.toString("utf-8");
  assert.match(text, /# Sample Spec/);
  assert.match(text, /A real spec for the widget API\./);
  assert.match(text, /Returns 200 on success/);
});

test("renderDtuAsFile produces valid, re-parseable JSON with the real DTU layers", async () => {
  const r = await renderDtuAsFile(sampleDtu(), "json");
  assert.equal(r.ok, true);
  const parsed = JSON.parse(r.buffer.toString("utf-8"));
  assert.equal(parsed.title, "Sample Spec");
  assert.deepEqual(parsed.core.claims, ["Returns 200 on success"]);
  assert.deepEqual(parsed.machine, { kind: "spec", owner: "team-x" });
});

test("renderDtuAsFile produces a real CSV row for the DTU", async () => {
  const r = await renderDtuAsFile(sampleDtu(), "csv");
  assert.equal(r.ok, true);
  const text = r.buffer.toString("utf-8");
  const lines = text.split("\n");
  assert.equal(lines.length, 2); // header + one row
  assert.match(lines[0], /^id,title,domain,createdAt,tags,summary$/);
  assert.match(lines[1], /Sample Spec/);
});

test("renderDtuAsFile produces a real ZIP with real, independently-readable entries", async () => {
  const r = await renderDtuAsFile(sampleDtu(), "zip");
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, "application/zip");
  const entries = listZipEntries(r.buffer);
  assert.equal(entries.length, 2);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ["sample-spec.json", "sample-spec.md"]);
  const mdText = readZipEntryText(r.buffer, "sample-spec.md");
  assert.match(mdText, /# Sample Spec/);
  const jsonText = readZipEntryText(r.buffer, "sample-spec.json");
  assert.equal(JSON.parse(jsonText).title, "Sample Spec");
});

test("renderDtuAsFile fails honestly for an unsupported format (docx), never fabricating one", async () => {
  const r = await renderDtuAsFile(sampleDtu(), "docx");
  assert.equal(r.ok, false);
  assert.equal(r.error, "unsupported_format");
  assert.deepEqual(r.supportedFormats, [...DOCUMENT_EXPORT_FORMATS]);
});

test("dtuToMarkdown handles a DTU with no core/human content gracefully (no crash, no fabricated sections)", () => {
  const md = dtuToMarkdown({ id: "dtu_empty", title: "Empty" });
  assert.match(md, /# Empty/);
  assert.ok(!md.includes("## Summary"), "no Summary heading should appear when there's no summary");
});

test("dtuToJson never includes fields outside the DTU's own real layers", () => {
  const json = dtuToJson(sampleDtu({ updatedAt: "2026-01-02T00:00:00.000Z" }));
  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed).sort(), ["core", "createdAt", "domain", "human", "id", "machine", "tags", "title", "updatedAt"]);
});

test("dtusToCsv renders multiple DTUs as multiple real rows", () => {
  const csv = dtusToCsv([sampleDtu({ id: "a", title: "One" }), sampleDtu({ id: "b", title: "Two" })]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 3); // header + 2 rows
  assert.match(lines[1], /One/);
  assert.match(lines[2], /Two/);
});
