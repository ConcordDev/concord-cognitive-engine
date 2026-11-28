// scripts/new-lens.mjs — the lens starter template.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, write } from "../../scripts/new-lens.mjs";

test("plans the app, tokens, test, two check specs and a capability-map stub; a page only when asked", () => {
  const p = plan({ lens: "pets", identity: "The Kennel Book", list: "list_pets" });
  assert.equal(p.slug, "kennel-book");
  assert.deepEqual(Object.keys(p.files).sort(), [
    "concord-frontend/components/pets/kennel-book/KennelBookApp.tsx",
    "concord-frontend/components/pets/kennel-book/kennel-book.css",
    "concord-frontend/tests/pets-kennel-book.test.tsx",
    "docs/lens-specs/pets-capability-map.md",
    "specs/pets/CS-pets-fits-390.json",
    "specs/pets/CS-pets-loads-clean.json",
  ]);
  const app = p.files["concord-frontend/components/pets/kennel-book/KennelBookApp.tsx"];
  assert.match(app, /const LIST_ACTION: string \| null = 'list_pets';/);
  assert.match(app, /from '@\/components\/lens-kit'/, "a template lens is on the kit (so the number rule covers it)");
  assert.doesNotMatch(app, /toFixed|toLocaleString|Math\.random/);
  const spec = JSON.parse(p.files["specs/pets/CS-pets-fits-390.json"]);
  assert.deepEqual([spec.viewport, spec.expect], ["mobile", [{ noHorizontalScroll: {} }]]);
  assert.ok(plan({ lens: "pets", identity: "The Kennel Book", page: true }).files["concord-frontend/app/lenses/pets/page.tsx"]);
});

test("with no backend action named, the room says it is not wired — nothing invented", () => {
  const app = plan({ lens: "pets", identity: "Kennel" }).files["concord-frontend/components/pets/kennel/KennelApp.tsx"];
  assert.match(app, /const LIST_ACTION: string \| null = null;/);
  assert.match(app, /title: 'Not wired yet'/);
});

test("refuses what it cannot scaffold honestly", () => {
  assert.throws(() => plan({ lens: "Pets!", identity: "X Y Z" }), /lens:/);
  assert.throws(() => plan({ lens: "pets" }), /--identity/);
  assert.throws(() => plan({ lens: "pets", identity: "Kennel", list: "rm -rf /" }), /--list/);
});

test("never overwrites a page without --force, and never overwrites a capability map", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "new-lens-"));
  try {
    const p = plan({ lens: "pets", identity: "Kennel", page: true });
    const map = path.join(root, "docs/lens-specs/pets-capability-map.md");
    const page = path.join(root, "concord-frontend/app/lenses/pets/page.tsx");
    fs.mkdirSync(path.dirname(map), { recursive: true }); fs.writeFileSync(map, "the real map");
    fs.mkdirSync(path.dirname(page), { recursive: true }); fs.writeFileSync(page, "the live page");
    const r1 = write({ root, files: p.files, force: false });
    assert.ok(r1.kept.includes("docs/lens-specs/pets-capability-map.md") && r1.kept.includes("concord-frontend/app/lenses/pets/page.tsx"));
    assert.equal(fs.readFileSync(page, "utf8"), "the live page");
    const r2 = write({ root, files: p.files, force: true });
    assert.ok(r2.written.includes("concord-frontend/app/lenses/pets/page.tsx"), "--force replaces the page");
    assert.equal(fs.readFileSync(map, "utf8"), "the real map", "a capability map is never overwritten, even with --force");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
