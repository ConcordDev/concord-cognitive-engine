// FIX-understanding-004 — notes had no visibility at all, and the
// lens's Share & Publish dialog opened on Public. Notes now record
// a visibility (private by default — they are personal records the
// lens reads only for their owner; public is an explicit choice),
// the workbench labels it and offers the choice beside the review
// toggle, and the shared publisher starts at its non-public option
// for lenses declaring sharePrivateByDefault in the manifest — the
// same declaration shape Platform Chrome II set for minorData —
// while every other lens keeps the generic public default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domain = readFileSync(join(root, "server", "domains", "understanding.js"), "utf8");
const bench = readFileSync(join(root, "concord-frontend", "components", "understanding", "NotesWorkbench.tsx"), "utf8");
const publisher = readFileSync(join(root, "concord-frontend", "components", "lens", "ContentPublisher.tsx"), "utf8");
const manifest = readFileSync(join(root, "concord-frontend", "lib", "lenses", "manifest.ts"), "utf8");

test("notes record a visibility, private by default", () => {
  assert.match(domain, /visibility: \["public", "private"\]\.includes\(params\.visibility\) \? params\.visibility : "private"/);
  assert.match(domain, /visibility: n\.visibility === "public" \? "public" : "private"/);
});

test("the workbench labels the note and offers the choice", () => {
  assert.match(bench, /<option value="private">Private — only you<\/option>/);
  assert.match(bench, /note\.visibility === 'public' \? 'Public' : 'Private — only you'/);
});

test("the share dialog starts non-public for declared lenses only", () => {
  assert.match(manifest, /sharePrivateByDefault\?: boolean/);
  assert.match(manifest, /sharePrivateByDefault: true,/);
  assert.match(publisher, /privateByDefault \? 'followers' : 'public'/);
});
