/**
 * Prototype-key tokens must not abort synonym expansion.
 *
 * chat.respond and retrieveDTUs look each query/DTU token up in SYN_MAP
 * and iterate the result. SYN_MAP used to be a plain object, so the token
 * "constructor" (and stemLite("constructors")) resolved to
 * Object.prototype.constructor. `for (const s of syns)` then threw
 * "syns is not iterable", and runMacro returned
 * macro_uncaught_throw before the LLM. The same lookup throws for
 * "toString", "__proto__", "valueOf", and "hasOwnProperty".
 *
 * Run: node --test tests/synonym-map-prototype.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expandTokenList, forEachSynonym, synonymsFor, SYN_MAP } from "../lib/synonym-map.js";
import { ownArray, ownValue } from "../lib/own-lookup.js";
import { compileDesignIR } from "../lib/conkay/compiler/design-ir.js";
import DTUProtocol from "../lib/dtu-protocol.js";

const PROTO_KEYS = ["constructor", "toString", "toLocaleString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "__proto__", "prototype"];

// Same suffix rules as server.js stemLite. Kept local so this file does
// not boot the monolith; the chat smoke test exercises the live stem.
function stemLite(t = "") {
  let s = String(t || "").toLowerCase();
  const rules = [[/ies$/, "y"], [/ing$/, ""], [/ed$/, ""], [/s$/, ""]];
  for (const [re, rep] of rules) {
    if (s.length >= 5 && re.test(s)) { s = s.replace(re, rep); break; }
  }
  return s;
}

describe("synonym lookup rejects inherited prototype keys", () => {
  it("reproduces syns is not iterable on a plain object", () => {
    const plain = Object.freeze({ bug: ["issue", "error", "problem"] });
    for (const token of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
      const syns = plain[token] || plain[stemLite(token)] || null;
      assert.ok(syns, `${token} must hit an inherited property in this reproduction`);
      assert.throws(() => { for (const s of syns) { void s; } }, /syns is not iterable/);
    }
    const stemmed = plain[stemLite("constructors")] || null;
    assert.equal(typeof stemmed, "function");
    assert.throws(() => { for (const s of stemmed) { void s; } }, /stemmed is not iterable/);
  });

  it("returns no synonyms for prototype-key tokens and does not throw", () => {
    for (const token of PROTO_KEYS) {
      assert.equal(synonymsFor(token), null, token);
      assert.equal(Object.hasOwn(SYN_MAP, token), false, token);
      const expanded = expandTokenList([token, "constructors"], stemLite);
      assert.ok(expanded.every((t) => typeof t === "string"), token);
      assert.ok(!expanded.includes("issue") || token === "bug");
    }
    const fromStem = expandTokenList(["constructors"], stemLite);
    assert.deepEqual(fromStem, ["constructor"]);
  });

  it("still expands real synonyms", () => {
    const out = expandTokenList(["bug", "chat"], stemLite);
    for (const s of ["bug", "issue", "error", "problem", "chat", "talk", "conversation", "dialogue"]) {
      assert.ok(out.includes(s), `missing ${s} in ${out.join(",")}`);
    }
  });

  it("a bad token or a non-array list does not drop the rest of the expansion", () => {
    let calls = 0;
    const stem = (t) => {
      calls += 1;
      if (t === "boom") throw new Error("bad stem");
      return stemLite(t);
    };
    const out = expandTokenList(["keep", "boom", "bug", "constructor"], stem);
    assert.ok(out.includes("keep"));
    assert.ok(out.includes("issue"));
    assert.ok(out.includes("constructor"));
    assert.ok(!out.includes("boom"));
    assert.ok(calls > 0);

    const plain = { bug: ["issue"] };
    const mixed = expandTokenList(["constructor", "toString", "__proto__", "bug"], (t) => String(t), plain);
    assert.ok(mixed.includes("bug"));
    assert.ok(mixed.includes("issue"));
    assert.ok(mixed.every((t) => typeof t === "string"));

    let seen = 0;
    assert.doesNotThrow(() => forEachSynonym(Object.prototype.toString, () => { seen += 1; }));
    assert.doesNotThrow(() => forEachSynonym(Object.prototype.constructor, () => { seen += 1; }));
    assert.equal(seen, 0);
    forEachSynonym(["aid"], () => { seen += 1; });
    assert.equal(seen, 1);
  });

  it("ownArray never returns an inherited function", () => {
    const plain = { bug: ["issue"] };
    for (const token of PROTO_KEYS) assert.equal(ownArray(plain, token), null, token);
    assert.deepEqual(ownArray(plain, "bug"), ["issue"]);
    assert.equal(ownValue(plain, "toString"), undefined);
    assert.equal(ownArray(null, "bug"), null);
    assert.equal(ownArray(plain, { toString: () => "bug" }), null);
  });

  it("design-ir shape constructor is an unknown shape, not a throw", () => {
    const compiled = compileDesignIR({
      nodes: [{ id: "n1", kind: "Part", geometry: { shape: "constructor" } }],
    });
    assert.ok(Array.isArray(compiled.errors));
    assert.ok(compiled.errors.some((e) => /unknown shape "constructor"/.test(e)), compiled.errors.join(" | "));
  });

  it("DTU type constructor does not throw while checking required fields", () => {
    const protocol = new DTUProtocol();
    const result = protocol.validate({
      $schema: "x",
      dtuVersion: "1.0",
      id: "id",
      type: "constructor",
      creator: { name: "n", id: "i" },
      content: { geometry: "g" },
      citations: [],
      metadata: {},
    });
    assert.equal(result.valid, false);
    assert.ok(Array.isArray(result.errors));
    assert.ok(!result.errors.some((e) => /not iterable/.test(e)));
  });
});
