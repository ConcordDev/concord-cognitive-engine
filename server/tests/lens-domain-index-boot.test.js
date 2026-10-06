// tests/lens-domain-index-boot.test.js
//
// When the SQLite lens-artifact store is active, the state snapshot omits
// lensArtifacts, so the domain index built during snapshot load is empty.
// Boot must rebuild the index as soon as the store has hydrated; otherwise
// every GET /api/lens/:domain list is empty until the staggered
// index_reconciliation (~14 s after boot), and a page loaded right after a
// restart shows "No items yet" for real records (found in the HVAC
// kill -9 restart proof, 2026-10-05).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");

describe("lens domain index at boot", () => {
  it("is rebuilt right after the artifact store replaces STATE.lensArtifacts", () => {
    const attach = src.indexOf("STATE.lensArtifacts = artifactStore;");
    assert.ok(attach > 0, "artifact store attach not found");
    const rebuild = src.indexOf("_rebuildLensDomainIndex();", attach);
    assert.ok(rebuild > attach, "no index rebuild after the store attach");
    assert.ok(rebuild - attach < 800, "the rebuild should follow the attach directly");
  });

  it("the rebuild walks STATE.lensArtifacts into STATE.lensDomainIndex", () => {
    const fn = src.slice(src.indexOf("function _rebuildLensDomainIndex()"), src.indexOf("function _lensDomainIndexAdd("));
    assert.match(fn, /STATE\.lensDomainIndex\.clear\(\)/);
    assert.match(fn, /for \(const \[id, art\] of STATE\.lensArtifacts\)/);
  });
});
