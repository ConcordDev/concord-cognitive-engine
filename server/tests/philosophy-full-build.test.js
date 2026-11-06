// S1/S3/S5 pins for the philosophy full build (PR build(philosophy)):
// the Argument map's deterministic evaluator (the four-probe battery
// from Review 2's first pass, plus form edge cases), the channel
// duplicate-title refusal, image-URL validation, and Discover owner
// names. Harness mirrors philosophy-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPhilosophyActions from "../domains/philosophy.js";

function usersDb() {
  const rows = new Map([
    ["user_a", { username: "ada", displayName: "Ada" }],
    ["user_b", { username: "bea", displayName: "Bea" }],
  ]);
  return {
    prepare(sql) {
      if (String(sql).includes("PRAGMA")) {
        return { all() { return [{ name: "id" }, { name: "username" }, { name: "display_name" }]; } };
      }
      return { get(id) { return rows.get(id); } };
    },
  };
}

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`philosophy.${name}`);
  assert.ok(fn, `philosophy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
function argMap(premises, conclusion) {
  const fn = ACTIONS.get("philosophy.argumentMap");
  assert.ok(fn, "philosophy.argumentMap not registered");
  return fn(ctxA, { id: null, data: { premises, conclusion }, meta: {} }, {}).result;
}

before(() => { registerPhilosophyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), db: usersDb() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("philosophy.argumentMap — the four-probe battery (S1)", () => {
  it("probe 1: a valid syllogism evaluates VALID", () => {
    const r = argMap(["All humans are mortal.", "Socrates is a human."], "Socrates is mortal.");
    assert.equal(r.evaluated, true);
    assert.equal(r.validity, "valid");
    assert.equal(r.countermodel, null);
    assert.ok(r.provenance?.terms.includes("human") && r.provenance.terms.includes("mortal"));
    // 'sound' is never claimed — the word is retired as a machine verdict.
    assert.equal(r.soundness, undefined);
    assert.match(r.note, /soundness/);
  });

  it("probe 2: a conclusion the premises do not support evaluates INVALID, with a countermodel", () => {
    const r = argMap(["All humans are mortal.", "Socrates is a human."], "Socrates is immortal.");
    assert.equal(r.evaluated, true);
    assert.equal(r.validity, "invalid");
    assert.match(r.countermodel, /Socrates/);
  });

  it("probe 3: nonsense is NOT evaluated — no verdict is stamped", () => {
    const r = argMap(["zzqq blorp.", "snizzle wump."], "fribble snarp.");
    assert.equal(r.evaluated, false);
    assert.equal(r.reason, "not-in-checkable-form");
    assert.deepEqual(r.unparsed, ["P1", "P2", "the conclusion"]);
    assert.equal(r.validity, undefined);
  });

  it("probe 4: a single premise is NOT evaluated", () => {
    const r = argMap(["All humans are mortal."], "Socrates is mortal.");
    assert.equal(r.evaluated, false);
    assert.equal(r.reason, "needs-two-premises");
    assert.equal(r.validity, undefined);
  });

  it("pure Barbara evaluates VALID; affirming the consequent does not", () => {
    const barbara = argMap(
      ["All mammals are animals.", "All dogs are mammals."],
      "All dogs are animals.",
    );
    assert.equal(barbara.validity, "valid");
    assert.equal(barbara.form, "syllogism");
    const fallacy = argMap(
      ["All humans are mortal.", "Socrates is mortal."],
      "Socrates is a human.",
    );
    assert.equal(fallacy.validity, "invalid");
  });

  it("a term that changes mid-argument breaks the form (four terms)", () => {
    const r = argMap(
      ["All cats are mammals.", "All dogs are mammals."],
      "All cats are dogs.",
    );
    assert.equal(r.validity, "invalid");
  });

  it("an unparseable conclusion is named, and the structure echo still returns", () => {
    const r = argMap(["All humans are mortal.", "Socrates is a human."], "therefore vibes.");
    assert.equal(r.evaluated, false);
    assert.deepEqual(r.unparsed, ["the conclusion"]);
    assert.equal(r.premiseCount, 2);
    assert.equal(r.premises[0].text, "All humans are mortal.");
  });

  it("existential conclusions need an existential premise (no free existence)", () => {
    const r = argMap(
      ["All unicorns are white.", "All white things are visible."],
      "Some unicorns are visible.",
    );
    assert.equal(r.validity, "invalid");
    const withExistence = argMap(
      ["Some unicorns are white.", "All white things are visible."],
      "Some unicorns are visible.",
    );
    assert.equal(withExistence.validity, "valid");
  });

  it("empty input keeps the standing guard message", () => {
    const r = argMap([], "");
    assert.match(r.message, /Add premises/);
  });
});

describe("philosophy channels — S3/S5 server legs", () => {
  it("a duplicate channel title is refused, naming the existing channel", () => {
    assert.equal(call("channel-create", ctxA, { title: "Free will" }).ok, true);
    const dupe = call("channel-create", ctxA, { title: "free will" });
    assert.equal(dupe.ok, false);
    assert.match(dupe.error, /Free will/);
    // Another user's same title is their own channel, unaffected.
    assert.equal(call("channel-create", ctxB, { title: "Free will" }).ok, true);
  });

  it("block-add refuses a non-URL image URL and accepts a real one", () => {
    const c = call("channel-create", ctxA, { title: "Images" }).result.channel;
    const bad = call("block-add", ctxA, { channelId: c.id, kind: "image", content: "tile", imageUrl: "not-a-url" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /http\(s\) URL/);
    const good = call("block-add", ctxA, { channelId: c.id, kind: "image", content: "tile", imageUrl: "https://example.org/x.png" });
    assert.equal(good.ok, true);
  });

  it("public channels carry the owner's display name, not only the raw id", () => {
    const c = call("channel-create", ctxA, { title: "Public salon" }).result.channel;
    call("channel-publish", ctxA, { id: c.id, public: true });
    const list = call("public-channels", ctxB, {});
    assert.equal(list.result.channels.length, 1);
    assert.equal(list.result.channels[0].ownerName, "Ada");
    const detail = call("public-channel-detail", ctxB, { id: c.id });
    assert.equal(detail.result.ownerName, "Ada");
  });
});
