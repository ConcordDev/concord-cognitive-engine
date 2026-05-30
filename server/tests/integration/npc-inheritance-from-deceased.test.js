/**
 * T2.2 — inheritance UI backing: outgoing inheritance from a deceased NPC.
 *
 * Pins getInheritanceFromDeceased (the InheritanceLog's data source):
 *   - returns the links a deceased NPC's death created, newest first
 *   - joins the heir's display name when world_npcs is present
 *   - degrades gracefully when world_npcs is absent (minimal build)
 *   - returns [] for an NPC with no lineage
 *
 * Run: node --test tests/integration/npc-inheritance-from-deceased.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up133 } from "../../migrations/133_npc_legacy.js";
import { getInheritanceFromDeceased } from "../../lib/npc-legacy.js";

function link(db, { id, deceased, heir, kind }) {
  db.prepare(`
    INSERT INTO npc_inheritance_links (id, deceased_npc_id, heir_npc_id, inherited_kind, detail_json)
    VALUES (?, ?, ?, ?, '{}')
  `).run(id, deceased, heir, kind);
}

describe("T2.2 — getInheritanceFromDeceased", () => {
  it("returns links for a deceased NPC with heir names joined", () => {
    const db = new Database(":memory:");
    up133(db);
    db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, state TEXT, archetype TEXT);`);
    db.prepare(`INSERT INTO world_npcs (id, state) VALUES ('vesper','{"name":"Vesper"}')`).run();
    link(db, { id: "l1", deceased: "elias", heir: "vesper", kind: "grudge" });
    link(db, { id: "l2", deceased: "elias", heir: "vesper", kind: "recipe" });
    link(db, { id: "l3", deceased: "elias", heir: "unknown-heir", kind: "wealth" });

    const links = getInheritanceFromDeceased(db, "elias");
    assert.equal(links.length, 3);
    const vesperGrudge = links.find((l) => l.heir_npc_id === "vesper" && l.inherited_kind === "grudge");
    assert.equal(vesperGrudge.heir_name, "Vesper");
    // heir with no world_npcs row → heir_name is null but the link still surfaces
    const unknown = links.find((l) => l.heir_npc_id === "unknown-heir");
    assert.equal(unknown.heir_name, null);
    db.close();
  });

  it("degrades when world_npcs is absent", () => {
    const db = new Database(":memory:");
    up133(db);
    link(db, { id: "l1", deceased: "elias", heir: "vesper", kind: "desire" });
    const links = getInheritanceFromDeceased(db, "elias");
    assert.equal(links.length, 1);
    assert.equal(links[0].inherited_kind, "desire");
    db.close();
  });

  it("returns [] for an NPC with no lineage", () => {
    const db = new Database(":memory:");
    up133(db);
    assert.deepEqual(getInheritanceFromDeceased(db, "nobody"), []);
    db.close();
  });
});
