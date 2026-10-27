import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { packDtuData } from "../lib/dtu-at-rest.js";
import { searchArchiveByVector, loadArchivedDtu, orderConsolidatedFirst, tierBoost } from "../lib/archive-retrieval.js";
import { conkayDtuBlock } from "../routes/chat-agent-stream.js";

function db() {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE dtu_store_archive (id TEXT PRIMARY KEY, data BLOB)");
  d.exec("CREATE TABLE archived_dtus (id TEXT PRIMARY KEY, data BLOB)");
  return d;
}
const v = (...xs) => new Float32Array(xs);

describe("archive retrieval", () => {
  it("finds a cold-archived mega and a consolidated member by vector, skipping hot ids", () => {
    const d = db();
    d.prepare("INSERT INTO dtu_store_archive VALUES (?, ?)").run("cold-mega",
      packDtuData(JSON.stringify({ id: "cold-mega", tier: "mega", title: "MEGA — Harbor tides", cretiHuman: "The harbor gate opens at 04:10." })));
    d.prepare("INSERT INTO archived_dtus VALUES (?, ?)").run("member-1",
      JSON.stringify({ id: "member-1", tier: "regular", title: "Tide note" }));
    const entries = new Map([
      ["cold-mega", v(1, 0, 0)],
      ["member-1", v(0.9, 0.1, 0)],
      ["hot-1", v(1, 0, 0)],
      ["far", v(0, 1, 0)],
    ]);
    const hits = searchArchiveByVector({
      queryVec: v(1, 0, 0), entries: entries.entries(), isHot: (id) => id === "hot-1",
      load: (id) => loadArchivedDtu(d, id), topK: 5,
    });
    assert.deepEqual(hits.map(h => h.dtu.id), ["cold-mega", "member-1"]);
    assert.equal(hits[0].dtu._archived, "cold");
    assert.equal(hits[1].dtu._archived, "consolidated");
    assert.ok(hits[0].score > hits[0].sim, "mega boost");
  });

  it("applies the visibility predicate and ignores shadows", () => {
    const d = db();
    d.prepare("INSERT INTO dtu_store_archive VALUES (?, ?)").run("priv", JSON.stringify({ id: "priv", tier: "regular", visibility: "private", ownerId: "u2" }));
    d.prepare("INSERT INTO dtu_store_archive VALUES (?, ?)").run("sh", JSON.stringify({ id: "sh", tier: "shadow" }));
    const hits = searchArchiveByVector({
      queryVec: v(1, 0), entries: [["priv", v(1, 0)], ["sh", v(1, 0)]], isHot: () => false,
      load: (id) => loadArchivedDtu(d, id), allow: (x) => x.visibility !== "private",
    });
    assert.equal(hits.length, 0);
  });

  it("orders megas/hypers first and builds the ConKay block", () => {
    const hits = orderConsolidatedFirst([
      { dtu: { tier: "regular" }, score: 0.9 },
      { dtu: { tier: "mega" }, score: 0.5 },
      { dtu: { tier: "hyper" }, score: 0.4 },
    ]);
    assert.deepEqual(hits.map(h => h.dtu.tier), ["hyper", "mega", "regular"]);
    assert.equal(tierBoost({ tier: "regular" }), 1);
    assert.equal(conkayDtuBlock(""), "");
    assert.match(conkayDtuBlock("[MEGA] x: y"), /^CONCORD KNOWLEDGE/);
  });
});
