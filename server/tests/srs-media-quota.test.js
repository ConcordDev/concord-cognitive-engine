// SRS media is held in lens state and serialized on every save, so inline (data:) uploads are bounded per
// member (review of #1802): oversized files are REJECTED (never truncated into a corrupt file), a per-account
// byte quota and library count cap apply to uploads, card attachments, new cards and imports, and other
// members are unaffected.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSrsActions from "../domains/srs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`srs.${name}`);
  assert.ok(fn, `srs.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSrsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const dataUrl = (chars, kind = "image/png") => "data:" + kind + ";base64," + "A".repeat(chars - ("data:" + kind + ";base64,").length);
const FILE = 2_700_000; // under the 2.8M per-file cap

describe("srs media quota", () => {
  it("media-add rejects an oversized file (no truncation) and stores nothing", () => {
    const r = call("media-add", ctxA, { dataUrl: dataUrl(2_800_001) });
    assert.equal(r.ok, false);
    assert.match(r.error, /too large/);
    assert.equal(call("media-list", ctxA, {}).result.count, 0);
  });

  it("media-add enforces the per-account byte quota, and another member is unaffected", () => {
    let ok = 0, err = null;
    for (let i = 0; i < 20; i++) {
      const r = call("media-add", ctxA, { dataUrl: dataUrl(FILE), name: "f" + i });
      if (r.ok) ok++; else { err = r.error; break; }
    }
    assert.equal(ok, 14, "40 MB / 2.7 MB = 14 uploads fit");
    assert.match(err, /media storage limit reached/);
    assert.equal(call("media-add", ctxB, { dataUrl: dataUrl(FILE) }).ok, true, "quota is per account");
    // Removing one frees room again.
    const first = call("media-list", ctxA, {}).result.media[0];
    assert.equal(call("media-remove", ctxA, { id: first.id }).ok, true);
    assert.equal(call("media-add", ctxA, { dataUrl: dataUrl(FILE) }).ok, true);
  });

  it("media-add caps the library item count even for plain URLs", () => {
    let last = null;
    for (let i = 0; i < 205; i++) { last = call("media-add", ctxA, { url: "https://example.com/i" + i + ".png" }); if (!last.ok) break; }
    assert.equal(last.ok, false);
    assert.match(last.error, /library limit reached/);
    assert.equal(call("media-list", ctxA, {}).result.count, 200);
  });

  it("card-set-media rejects an oversized data URL instead of truncating it, and keeps the old value", () => {
    const d = call("deck-create", ctxA, { name: "D" }).result.deck;
    const c = call("card-add", ctxA, { deckId: d.id, front: "f", back: "b" }).result.card;
    const small = dataUrl(1000);
    assert.equal(call("card-set-media", ctxA, { id: c.id, frontImage: small }).ok, true);
    const r = call("card-set-media", ctxA, { id: c.id, frontImage: dataUrl(2_900_000) });
    assert.equal(r.ok, false);
    assert.match(r.error, /too large/);
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.cards[0].media.frontImage, small);
  });

  it("card-set-media and card-add stop at the account quota; a refused card is not stored", () => {
    for (let i = 0; i < 14; i++) assert.equal(call("media-add", ctxA, { dataUrl: dataUrl(FILE) }).ok, true);
    const d = call("deck-create", ctxA, { name: "D" }).result.deck;
    const plain = call("card-add", ctxA, { deckId: d.id, front: "plain", back: "ok" });
    assert.equal(plain.ok, true, "cards without inline media are never blocked");
    const withBig = call("card-add", ctxA, { deckId: d.id, front: "big", back: "no", frontImage: dataUrl(FILE) });
    assert.equal(withBig.ok, false);
    assert.match(withBig.error, /media storage limit reached/);
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.count, 1, "the refused card was rolled back");
    const set = call("card-set-media", ctxA, { id: plain.result.card.id, backImage: dataUrl(FILE) });
    assert.equal(set.ok, false);
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.cards[0].media.backImage, null);
  });

  it("deck-import sanitizes media and drops inline files past the quota instead of storing them", () => {
    const cards = [];
    for (let i = 0; i < 20; i++) cards.push({ front: "q" + i, back: "a" + i, media: { frontImage: dataUrl(FILE), evil: { nested: "x".repeat(50) } } });
    const r = call("deck-import", ctxA, { bundle: { deck: { name: "Imp" }, cards } });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 20, "all cards keep their text");
    assert.ok(r.result.mediaDropped >= 5, "files past the budget were dropped: " + r.result.mediaDropped);
    const stored = call("card-list", ctxA, { deckId: r.result.deck.id }).result.cards;
    const inline = stored.reduce((n, c) => n + (c.media.frontImage ? c.media.frontImage.length : 0), 0);
    assert.ok(inline <= 40_000_000, "inline bytes stay within the quota: " + inline);
    assert.deepEqual(Object.keys(stored[0].media).sort(), ["backAudio", "backImage", "frontAudio", "frontImage", "tts"], "arbitrary media keys are not stored");
  });
});
