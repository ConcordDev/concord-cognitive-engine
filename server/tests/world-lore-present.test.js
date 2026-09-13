import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listLoreLandmarks,
  listAuthoredQuests,
  refusalForWorld,
  authoredNpcPublic,
  folderForWorld,
} from "../lib/world-lore-present.js";

describe("world-lore-present — authored files, never invented", () => {
  it("maps hub aliases onto concordia-hub", () => {
    assert.equal(folderForWorld("hub"), "concordia-hub");
    assert.equal(folderForWorld("concordia-hub"), "concordia-hub");
  });

  it("lists hub history beats from lore.json", () => {
    const beats = listLoreLandmarks("concordia-hub");
    assert.ok(beats.length >= 8);
    const ids = beats.map((b) => b.id);
    assert.ok(ids.includes("hub_the_heart_claimed"));
    assert.ok(ids.includes("hub_the_ring_of_doors"));
    assert.ok(ids.includes("hub_the_ninth_refusal"));
    const heart = beats.find((b) => b.id === "hub_the_heart_claimed");
    assert.equal(heart.title, "The Ground She Made Hers");
    assert.match(heart.text, /Concordia/i);
  });

  it("maps each Refusal world, and the ninth onto the hub", () => {
    const death = refusalForWorld("sovereign-ruins");
    assert.equal(death.id, "refuse_death");
    assert.match(death.theNo, /ending/i);
    const ninth = refusalForWorld("concordia-hub");
    assert.equal(ninth.id, "the_ninth");
    assert.match(ninth.theNo, /own refusal/i);
  });

  it("returns public NPC fields and omits secrets", () => {
    const asbir = authoredNpcPublic("lord_curator_asbir_thelane", "concordia-hub");
    assert.ok(asbir);
    assert.equal(asbir.name, "Asbir Thelane");
    assert.match(asbir.line, /notebook/i);
    const blob = JSON.stringify(asbir);
    assert.doesNotMatch(blob, /Iyatte's record/i);
    assert.doesNotMatch(blob, /sealed wall-cavity/i);
    assert.equal(asbir.secret, undefined);
  });

  it("gives Maren her Founding Day plaza line and never the Vault Seventeen secret", () => {
    const maren = authoredNpcPublic("archivist_maren", "concordia-hub");
    assert.ok(maren);
    assert.equal(maren.name, "Maren Ashveil");
    assert.match(maren.line, /Write what you see/i);
    const blob = JSON.stringify(maren);
    assert.doesNotMatch(blob, /Warden Commander Voss/i);
    assert.doesNotMatch(blob, /Vault Seventeen/i);
    assert.equal(maren.secret, undefined);
    assert.equal(maren.narrative_context, undefined);
  });

  it("lists the authored Founding Day quests for the hub", () => {
    const quests = listAuthoredQuests("concordia-hub");
    assert.ok(quests.some((q) => q.id === "founding_day_01_gather"));
    assert.ok(quests.some((q) => q.id === "founding_day_03_sign"));
    assert.ok(quests.every((q) => q.origin === "authored"));
  });
});
