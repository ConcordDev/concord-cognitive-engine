import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAdmission } from "../lib/dtu-content-classes.js";

// FIX-srs-003 — the council gate rejected every shared-deck publish as
// low_value because the deck's content sat only in machine.bundle, which
// the admission score never reads. These pins hold both sides of the
// contract at the scorer: the bundle-only shape stays rejected (the gate
// is doing its job), and the published shape — cards in core.examples —
// clears the public bar.

const bundle = {
  format: "concord-srs/v1",
  deck: { name: "QA Deck" },
  cards: [1, 2, 3, 4].map((i) => ({ front: `Question ${i}`, back: `Answer ${i}` })),
  cardCount: 4,
};
const base = {
  title: "QA Deck (shared deck)",
  tags: ["srs", "shared-deck"],
  human: { summary: 'Shared SRS deck "QA Deck" — 4 cards, published from the SRS lens.' },
  machine: { kind: "srs_deck_bundle", version: 1, bundle },
  meta: { visibility: "public" },
};

describe("srs shared-deck admission (FIX-srs-003)", () => {
  it("the old bundle-only payload is rejected low_value", () => {
    const a = scoreAdmission(base, { userInitiated: true });
    assert.equal(a.ok, false);
    assert.equal(a.reason, "low_value");
  });

  it("the published shape — cards in core.examples — clears the public bar", () => {
    const dtu = {
      ...base,
      core: {
        examples: bundle.cards.map((c) => `${c.front} → ${c.back}`),
        nextActions: ["Add this deck to your decks from the SRS lens to study it."],
      },
    };
    const a = scoreAdmission(dtu, { userInitiated: true });
    assert.equal(a.ok, true, `score ${a.score} vs min ${a.minScore}`);
    assert.ok(a.score >= a.minScore);
  });

  it("even a one-card deck clears it (example + next action)", () => {
    const dtu = {
      ...base,
      title: "Tiny (shared deck)",
      core: { examples: ["Q → A"], nextActions: ["Add this deck to your decks from the SRS lens to study it."] },
    };
    const a = scoreAdmission(dtu, { userInitiated: true });
    assert.equal(a.ok, true, `score ${a.score} vs min ${a.minScore}`);
  });
});
