// FIX-poetry-002 — poems are per-user records and sharing is an
// explicit opt-in (workshop-share snapshots a poem into the shared
// workshop), but nothing ever labelled the state: list and detail
// showed only the writing status (draft/revising/finished), so a
// member could not tell a private poem from one already shared.
// poem-list and poem-detail now carry `sharedToWorkshop`, computed
// from the workshop store for the caller, and both poem lists plus
// the workspace render the audience in plain words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domain = readFileSync(join(root, "server", "domains", "poetry.js"), "utf8");
const collection = readFileSync(join(root, "concord-frontend", "components", "poetry", "CollectionPanel.tsx"), "utf8");
const workspace = readFileSync(join(root, "concord-frontend", "components", "poetry", "PoemWorkspace.tsx"), "utf8");

test("the server surfaces the workshop state on list and detail", () => {
  assert.match(domain, /function poSharedPoemIds\(s, userId\)/);
  assert.match(domain, /sharedToWorkshop: sharedIds\.has\(p\.id\)/);
  assert.match(domain, /sharedToWorkshop: poSharedPoemIds\(s, poActor\(ctx\)\)\.has\(poem\.id\)/);
});

test("the renders label the audience in plain words", () => {
  assert.match(collection, /poem\.sharedToWorkshop \? 'Shared to workshop' : 'Private'/);
  assert.match(workspace, /p\.sharedToWorkshop \? 'Shared to workshop' : 'Private'/);
  assert.match(workspace, /active\.sharedToWorkshop \? 'Shared to workshop' : 'Private — only you'/);
});
