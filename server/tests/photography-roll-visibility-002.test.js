// FIX-photography-002 — rolls carried no visibility at all: the
// record had no audience field and the page showed none, so a member
// could not tell (or state) whether a roll was private or public.
// Rolls now record a visibility — validated, private by default,
// changeable through shoot-update — list/hydrate shapes carry it
// (durable rows that predate the field read as private, which is
// their true state: nothing in the lens reads another member's
// rolls), and the roll header carries the labelled control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domain = readFileSync(join(root, "server", "domains", "photography.js"), "utf8");
const page = readFileSync(join(root, "concord-frontend", "app", "lenses", "photography", "page.tsx"), "utf8");

test("rolls record a validated visibility, private by default", () => {
  assert.match(domain, /visibility: \["public", "private"\]\.includes\(params\.visibility\) \? params\.visibility : "private"/);
  assert.match(domain, /if \(params\.visibility !== undefined\) shoot\.visibility = /);
});

test("durable rows that predate the field read as private", () => {
  assert.match(domain, /client: null, visibility: "private", createdAt: row\.created_at/);
});

test("the roll header carries the labelled control", () => {
  assert.match(page, /Visibility/);
  assert.match(page, /<option value="private">Private<\/option>/);
  assert.match(page, /<option value="public">Public<\/option>/);
  assert.match(page, /lensRun\('photography', 'shoot-update', \{ rollId, visibility \}\)/);
});
