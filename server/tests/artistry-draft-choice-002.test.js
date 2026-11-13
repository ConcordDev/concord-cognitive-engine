// FIX-artistry-002 — 'Publish Project' was the only submit: the form
// never sent the `published` field the server has always honoured
// (create stores it, update flips it, list/view/feed enforce it for
// non-owners), no card labelled a published project, and a successful
// save was silent. The form now offers the draft/private choice,
// sends it on create and update, restores it when editing, labels
// every card Published or Draft, names the submit for the choice,
// and confirms the save with a toast that states the audience.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const studio = readFileSync(join(root, "concord-frontend", "components", "artistry", "ProjectStudio.tsx"), "utf8");
const domain = readFileSync(join(root, "server", "domains", "artistry.js"), "utf8");

test("the form offers and sends the draft/private choice", () => {
  assert.match(studio, /<option value="draft">Draft — only you<\/option>/);
  assert.match(studio, /published: fPublished,/);
  assert.match(studio, /fPublished \? 'Publish Project' : 'Save as Draft'/);
});

test("every card shows its visibility and the save confirms it", () => {
  assert.match(studio, /<span className="text-emerald-500">Published<\/span>/);
  assert.match(studio, /Draft — only you/);
  assert.match(studio, /addToast\(\{\s*\n?\s*type: 'success',/);
});

test("the server contract the form now uses is really enforced", () => {
  assert.match(domain, /published: p\.published !== false/);
  assert.match(domain, /if \(ownerId !== viewerId\) list = list\.filter\(\(x\) => x\.published\)/);
});
