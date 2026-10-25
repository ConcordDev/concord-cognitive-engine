// The Unity client reads hub layout and zones from Resources/Concordia/Canon
// (Aura REQ-2). Those copies must stay byte-identical to the repo content they
// mirror, or the game places things from a stale map.
//
//   cd server && node --test tests/unity-canon-hub-layout.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "content/world/concordia-hub");
const CANON = path.join(ROOT, "apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub");

for (const file of ["city-layout.json", "zones.json"]) {
  test(`Canon/concordia-hub/${file} mirrors content/world/concordia-hub/${file}`, (t) => {
    const canonPath = path.join(CANON, file);
    if (!fs.existsSync(canonPath)) {
      t.skip("unity-client Canon not checked out here (sparse worktree)");
      return;
    }
    assert.equal(fs.readFileSync(canonPath, "utf8"), fs.readFileSync(path.join(SRC, file), "utf8"));
    assert.ok(fs.existsSync(`${canonPath}.meta`), "a committed .meta keeps the asset GUID stable");
  });
}
