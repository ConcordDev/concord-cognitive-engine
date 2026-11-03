import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dictionaryFailureCopy } from "./dictionary-copy.ts";

describe("dictionary failure copy", () => {
  it("does not show the debug token", () => {
    const text = dictionaryFailureCopy("dictionary_unreachable");
    assert.equal(text.includes("dictionary_unreachable"), false);
    assert.equal(text, "The dictionary did not respond. Check the word, or try again in a moment.");
  });

  it("names a word that is missing or too long", () => {
    assert.equal(dictionaryFailureCopy("missing_word"), "Type a word to look it up.");
    assert.equal(dictionaryFailureCopy("word_too_long"), "Use 60 characters or fewer.");
  });
});
