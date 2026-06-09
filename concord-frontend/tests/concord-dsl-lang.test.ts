/**
 * Concord DSL Monaco language — unit tests for the browser-free pieces: the
 * Monarch grammar shape, language config, completion logic, and idempotent
 * registration against a fake monaco. (The actual highlighting render is
 * browser-gated and verified visually.)
 */

import { describe, it, expect } from "vitest";
import {
  CONCORD_DSL_ID, DSL_KEYWORDS, MONARCH, LANG_CONFIG, dslCompletions, registerConcordDsl,
} from "@/lib/dsl/concord-dsl-lang";

describe("Monarch grammar", () => {
  it("carries the DSL keywords and a comment + string rule", () => {
    expect(MONARCH.keywords).toEqual(expect.arrayContaining(["let", "if", "else"]));
    const rules = MONARCH.tokenizer.root.map((r) => r[1]);
    expect(rules).toContain("comment");
    expect(rules).toContain("keyword");
    expect(rules).toContain("string");
    expect(rules).toContain("number");
  });
  it("uses # line comments in the language config", () => {
    expect(LANG_CONFIG.comments.lineComment).toBe("#");
    expect(LANG_CONFIG.autoClosingPairs.some((p) => p.open === "{")).toBe(true);
  });
});

describe("dslCompletions", () => {
  it("offers keywords + macro snippets, filtered by prefix", () => {
    const all = dslCompletions("", ["dtu.create", "discovery.search"]);
    expect(all.map((c) => c.label)).toEqual(expect.arrayContaining([...DSL_KEYWORDS, "dtu.create", "discovery.search"]));
    const macro = all.find((c) => c.label === "dtu.create");
    expect(macro?.kind).toBe("function");
    expect(macro?.snippet).toBe(true);
    expect(macro?.insertText).toContain("dtu.create(");
  });
  it("filters by the typed prefix", () => {
    const r = dslCompletions("le", ["dtu.create"]);
    expect(r.map((c) => c.label)).toContain("let");
    expect(r.map((c) => c.label)).not.toContain("dtu.create");
  });
});

describe("registerConcordDsl", () => {
  function fakeMonaco() {
    const registered: string[] = [];
    const langs: Array<{ id: string }> = [];
    const calls = { tokens: 0, config: 0, completion: 0 };
    return {
      registered, calls,
      languages: {
        getLanguages: () => langs,
        register: (def: { id: string }) => { langs.push({ id: def.id }); registered.push(def.id); },
        setMonarchTokensProvider: () => { calls.tokens++; },
        setLanguageConfiguration: () => { calls.config++; },
        registerCompletionItemProvider: () => { calls.completion++; },
        CompletionItemKind: { Keyword: 17, Function: 1 },
        CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      },
    };
  }

  it("registers the language once (idempotent) with tokens + config + completion", () => {
    const m = fakeMonaco();
    expect(registerConcordDsl(m as never)).toBe(true);
    expect(m.registered).toContain(CONCORD_DSL_ID);
    expect(m.calls).toEqual({ tokens: 1, config: 1, completion: 1 });
    // second call is a no-op (already registered)
    expect(registerConcordDsl(m as never)).toBe(false);
    expect(m.calls.tokens).toBe(1);
  });
});
