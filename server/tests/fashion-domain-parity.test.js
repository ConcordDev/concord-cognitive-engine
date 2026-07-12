// Contract tests for the fashion Stylebook 2026-parity digital-closet
// macros (wardrobe, outfits, wear calendar, packing, lookbooks,
// analytics). vision/compute macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFashionActions from "../domains/fashion.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`fashion.${name}`);
  assert.ok(fn, `fashion.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFashionActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newItem(ctx = ctxA, over = {}) {
  return call("item-add", ctx, { name: "White tee", category: "top", cost: 30, ...over }).result.item;
}

describe("fashion.item-* wardrobe", () => {
  it("add requires a name, scoped per user", () => {
    assert.equal(call("item-add", ctxA, {}).ok, false);
    newItem();
    assert.equal(call("item-list", ctxA, {}).result.count, 1);
    assert.equal(call("item-list", ctxB, {}).result.count, 0);
  });

  it("wearing accrues count and cost-per-wear", () => {
    const item = newItem(ctxA, { cost: 50 });
    call("item-wear", ctxA, { id: item.id });
    call("item-wear", ctxA, { id: item.id });
    const list = call("item-list", ctxA, {});
    assert.equal(list.result.items[0].timesWorn, 2);
    assert.equal(list.result.items[0].costPerWear, 25);
    assert.equal(list.result.items[0].valueRating, "moderate");
  });

  it("update and delete", () => {
    const item = newItem();
    assert.equal(call("item-update", ctxA, { id: item.id, cost: 10 }).result.item.cost, 10);
    assert.equal(call("item-delete", ctxA, { id: item.id }).ok, true);
    assert.equal(call("item-list", ctxA, {}).result.count, 0);
  });
});

// Stylebook capability-map #20 — laundry/availability status.
describe("fashion.item laundry status", () => {
  it("defaults to clean on a freshly-added item", () => {
    const item = newItem();
    assert.equal(item.laundryStatus, "clean");
    assert.equal(call("item-list", ctxA, {}).result.items[0].laundryStatus, "clean");
  });

  it("back-compat: an item persisted before this field existed reads as clean", () => {
    const item = newItem();
    // Simulate a pre-existing item from before laundryStatus was introduced
    // by deleting the field off the stored record directly.
    delete item.laundryStatus;
    const listed = call("item-list", ctxA, {}).result.items[0];
    assert.equal(listed.laundryStatus, "clean");
  });

  it("item-update sets a valid laundry status and it persists across reads", () => {
    const item = newItem();
    const r = call("item-update", ctxA, { id: item.id, laundryStatus: "dirty" });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.laundryStatus, "dirty");
    assert.equal(call("item-list", ctxA, {}).result.items[0].laundryStatus, "dirty");
  });

  it("item-update accepts each of the four documented statuses", () => {
    const item = newItem();
    for (const status of ["clean", "dirty", "at_cleaner", "lent_out"]) {
      const r = call("item-update", ctxA, { id: item.id, laundryStatus: status });
      assert.equal(r.ok, true, `expected ${status} to be accepted`);
      assert.equal(r.result.item.laundryStatus, status);
    }
  });

  it("item-update is case-insensitive on laundryStatus", () => {
    const item = newItem();
    const r = call("item-update", ctxA, { id: item.id, laundryStatus: "DIRTY" });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.laundryStatus, "dirty");
  });

  it("rejects an invalid laundry status and applies no partial update", () => {
    const item = newItem(ctxA, { cost: 30 });
    const r = call("item-update", ctxA, { id: item.id, laundryStatus: "incinerated", cost: 999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid laundryStatus/);
    // The cost passed alongside the bad status must NOT have been applied.
    const stillThere = call("item-list", ctxA, {}).result.items[0];
    assert.equal(stillThere.cost, 30);
    assert.equal(stillThere.laundryStatus, "clean");
  });

  it("item-list filters by laundryStatus", () => {
    const a = newItem(ctxA, { name: "Clean shirt" });
    const b = newItem(ctxA, { name: "Dirty jeans" });
    call("item-update", ctxA, { id: b.id, laundryStatus: "dirty" });
    const cleanOnly = call("item-list", ctxA, { laundryStatus: "clean" }).result.items;
    assert.equal(cleanOnly.length, 1);
    assert.equal(cleanOnly[0].id, a.id);
    const dirtyOnly = call("item-list", ctxA, { laundryStatus: "dirty" }).result.items;
    assert.equal(dirtyOnly.length, 1);
    assert.equal(dirtyOnly[0].id, b.id);
  });
});

describe("fashion.outfit-*", () => {
  it("create outfit from items, wearing cascades to items", () => {
    const top = newItem(ctxA, { name: "Shirt" });
    const bottom = newItem(ctxA, { name: "Jeans", category: "bottom" });
    const outfit = call("outfit-create", ctxA, { name: "Weekend", itemIds: [top.id, bottom.id] }).result.outfit;
    assert.equal(outfit.itemIds.length, 2);
    call("outfit-wear", ctxA, { id: outfit.id });
    const detail = call("outfit-detail", ctxA, { id: outfit.id });
    assert.equal(detail.result.outfit.timesWorn, 1);
    assert.equal(detail.result.items[0].timesWorn, 1);
  });

  it("outfit list + delete", () => {
    const o = call("outfit-create", ctxA, { name: "Office" }).result.outfit;
    assert.equal(call("outfit-list", ctxA, {}).result.count, 1);
    assert.equal(call("outfit-delete", ctxA, { id: o.id }).ok, true);
  });
});

describe("fashion.calendar", () => {
  it("logs wears and groups by month", () => {
    const item = newItem();
    call("calendar-log", ctxA, { itemId: item.id, date: "2026-05-10" });
    call("calendar-log", ctxA, { itemId: item.id, date: "2026-05-12" });
    const view = call("calendar-view", ctxA, { month: "2026-05" });
    assert.equal(view.result.entries.length, 2);
    assert.equal(view.result.daysLogged, 2);
  });

  it("rejects calendar log without item or outfit", () => {
    assert.equal(call("calendar-log", ctxA, { date: "2026-05-10" }).ok, false);
  });
});

describe("fashion.packing + lookbooks", () => {
  it("packing list collects items", () => {
    const item = newItem();
    const list = call("packing-create", ctxA, { name: "Beach trip", destination: "Maui" }).result.packingList;
    call("packing-add-item", ctxA, { packingId: list.id, itemId: item.id });
    assert.equal(call("packing-detail", ctxA, { id: list.id }).result.items.length, 1);
    assert.equal(call("packing-list", ctxA, {}).result.packingLists[0].itemCount, 1);
  });

  it("lookbook collects outfits", () => {
    const o = call("outfit-create", ctxA, { name: "Look 1" }).result.outfit;
    const lb = call("lookbook-create", ctxA, { name: "Spring 2026" }).result.lookbook;
    call("lookbook-add-outfit", ctxA, { lookbookId: lb.id, outfitId: o.id });
    assert.equal(call("lookbook-list", ctxA, {}).result.lookbooks[0].outfitCount, 1);
  });
});

describe("fashion.analytics", () => {
  it("closet-stats aggregates value and categories", () => {
    newItem(ctxA, { category: "top", cost: 40 });
    newItem(ctxA, { category: "bottom", cost: 60 });
    const stats = call("closet-stats", ctxA, {});
    assert.equal(stats.result.items, 2);
    assert.equal(stats.result.totalValue, 100);
    assert.equal(stats.result.neverWorn, 2);
  });

  it("wear-insights ranks most-worn and dead stock", () => {
    const a = newItem(ctxA, { name: "Worn lots" });
    newItem(ctxA, { name: "Never worn" });
    call("item-wear", ctxA, { id: a.id });
    call("item-wear", ctxA, { id: a.id });
    const ins = call("wear-insights", ctxA, {});
    assert.equal(ins.result.mostWorn[0].name, "Worn lots");
    assert.equal(ins.result.deadStock, 1);
  });

  it("fashion-dashboard aggregates", () => {
    newItem();
    call("outfit-create", ctxA, { name: "O" });
    const d = call("fashion-dashboard", ctxA, {});
    assert.equal(d.result.items, 1);
    assert.equal(d.result.outfits, 1);
    assert.equal(d.result.neverWorn, 1);
  });
});

// ─── 2026 parity backlog ───────────────────────────────────────────────

describe("fashion.item-remove-bg", () => {
  it("flags a CSS flat-lay mask when no remove.bg key is set", async () => {
    const prev = process.env.REMOVEBG_API_KEY;
    delete process.env.REMOVEBG_API_KEY;
    const item = newItem(ctxA, { photo: "https://example.com/tee.png" });
    const r = await call("item-remove-bg", ctxA, { id: item.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.processed, false);
    assert.equal(r.result.mode, "css-mask");
    assert.equal(r.result.item.bgRemovalMode, "css-mask");
    if (prev != null) process.env.REMOVEBG_API_KEY = prev;
  });

  it("rejects an item with no photo", async () => {
    const item = newItem(ctxA);
    const r = await call("item-remove-bg", ctxA, { id: item.id });
    assert.equal(r.ok, false);
  });
});

describe("fashion.ai-outfit-generate", () => {
  it("assembles head-to-toe looks from the real wardrobe by weather + occasion", () => {
    newItem(ctxA, { name: "Tee", category: "top", season: "summer" });
    newItem(ctxA, { name: "Shorts", category: "bottom", season: "summer" });
    newItem(ctxA, { name: "Sandals", category: "shoes", season: "summer" });
    const r = call("ai-outfit-generate", ctxA, { occasion: "casual", temp: 28, count: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.weatherBand, "warm");
    assert.ok(r.result.outfits.length >= 1);
    assert.ok(r.result.outfits[0].itemIds.length >= 2);
  });

  it("returns an empty set with a note for an empty wardrobe", () => {
    const r = call("ai-outfit-generate", ctxB, { occasion: "work" });
    assert.equal(r.ok, true);
    assert.equal(r.result.outfits.length, 0);
    assert.ok(r.result.note);
  });
});

describe("fashion.weather-forecast", () => {
  it("requires valid lat and lon", async () => {
    const r = await call("weather-forecast", ctxA, {});
    assert.equal(r.ok, false);
  });
});

describe("fashion.style-quiz", () => {
  it("returns quiz questions", () => {
    const r = call("style-quiz-questions", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.questions.length >= 5);
  });

  it("rejects an incomplete submission", () => {
    const r = call("style-quiz-submit", ctxA, { answers: { vibe: "minimal" } });
    assert.equal(r.ok, false);
  });

  it("saves a profile and surfaces closet-gap recommendations", () => {
    const r = call("style-quiz-submit", ctxA, {
      answers: { vibe: "classic", palette: "neutral", fit: "fitted", spend: "balanced", priority: "versatility" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.profile.style, "classic");
    assert.ok(r.result.profile.colors.length > 0);
    assert.ok(r.result.recommendations.length > 0);
    const got = call("style-profile-get", ctxA, {});
    assert.equal(got.result.profile.style, "classic");
  });
});

describe("fashion.resale / declutter", () => {
  it("flags never-worn items for declutter and lists for resale", () => {
    const item = newItem(ctxA, { name: "Dead stock", cost: 100 });
    const d = call("declutter-suggestions", ctxA, {});
    assert.equal(d.ok, true);
    assert.ok(d.result.flagged.some((f) => f.id === item.id));
    const listed = call("resale-list-item", ctxA, { id: item.id, askingPrice: 40, channel: "vinted" });
    assert.equal(listed.ok, true);
    assert.equal(listed.result.listing.channel, "vinted");
    const listings = call("resale-listings", ctxA, {});
    assert.equal(listings.result.count, 1);
    assert.equal(call("resale-unlist-item", ctxA, { id: item.id }).ok, true);
    assert.equal(call("resale-listings", ctxA, {}).result.count, 0);
  });
});

describe("fashion.social feed", () => {
  it("shares an outfit, likes and saves it", () => {
    const outfit = call("outfit-create", ctxA, { name: "City look" }).result.outfit;
    const post = call("social-share-outfit", ctxA, { outfitId: outfit.id, caption: "Friday fit" }).result.post;
    assert.ok(post.id);
    const liked = call("social-like", ctxB, { id: post.id });
    assert.equal(liked.result.post.likes, 1);
    const saved = call("social-save", ctxB, { id: post.id });
    assert.equal(saved.result.post.saves, 1);
    const feed = call("social-feed", ctxA, { sort: "popular" });
    assert.equal(feed.result.posts[0].id, post.id);
    assert.equal(call("social-delete", ctxA, { id: post.id }).ok, true);
  });
});

describe("fashion.wishlist", () => {
  it("rejects add without a name", () => {
    assert.equal(call("wishlist-add", ctxA, {}).ok, false);
  });

  it("rejects a negative price", () => {
    assert.equal(call("wishlist-add", ctxA, { name: "Coat", price: -5 }).ok, false);
  });

  it("add/list/remove round-trip, scoped per user", () => {
    const r = call("wishlist-add", ctxA, {
      name: "Wool coat", price: 220, link: "https://example.com/coat", note: "For winter",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.entry.id);
    assert.equal(r.result.entry.price, 220);
    assert.equal(r.result.entry.link, "https://example.com/coat");

    const listA = call("wishlist-list", ctxA, {});
    assert.equal(listA.result.count, 1);
    assert.equal(listA.result.totalValue, 220);

    const listB = call("wishlist-list", ctxB, {});
    assert.equal(listB.result.count, 0);

    const del = call("wishlist-remove", ctxA, { id: r.result.entry.id });
    assert.equal(del.ok, true);
    assert.equal(call("wishlist-list", ctxA, {}).result.count, 0);
  });

  it("removing an unknown id fails honestly", () => {
    assert.equal(call("wishlist-remove", ctxA, { id: "nope" }).ok, false);
  });

  it("accepts an entry with no price (price stays null, totalValue unaffected)", () => {
    const r = call("wishlist-add", ctxA, { name: "Free tote" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.price, null);
    assert.equal(call("wishlist-list", ctxA, {}).result.totalValue, 0);
  });

  it("converts a wishlist entry into a real closet item and removes the entry", () => {
    const w = call("wishlist-add", ctxA, {
      name: "Denim jacket", price: 85, category: "outerwear", link: "https://example.com/jacket",
    }).result.entry;
    const conv = call("wishlist-convert-to-item", ctxA, { id: w.id });
    assert.equal(conv.ok, true);
    assert.equal(conv.result.item.name, "Denim jacket");
    assert.equal(conv.result.item.category, "outerwear");
    assert.equal(conv.result.item.cost, 85);
    assert.equal(conv.result.removedWishlistId, w.id);

    // The wishlist entry is gone...
    assert.equal(call("wishlist-list", ctxA, {}).result.count, 0);
    // ...and a real closet item now exists in the same wardrobe substrate
    // item-add writes to (proves the shared creation path, not a parallel one).
    const items = call("item-list", ctxA, {}).result.items;
    assert.ok(items.some((i) => i.id === conv.result.item.id && i.name === "Denim jacket"));
  });

  it("convert accepts overrides (cost/category/brand) on top of the wishlist entry", () => {
    const w = call("wishlist-add", ctxA, { name: "Sneakers", price: 60 }).result.entry;
    const conv = call("wishlist-convert-to-item", ctxA, { id: w.id, cost: 45, category: "shoes", brand: "Acme" });
    assert.equal(conv.result.item.cost, 45);
    assert.equal(conv.result.item.category, "shoes");
    assert.equal(conv.result.item.brand, "Acme");
  });

  it("converting an unknown id fails honestly and creates nothing", () => {
    const before = call("item-list", ctxA, {}).result.count;
    const r = call("wishlist-convert-to-item", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
    assert.equal(call("item-list", ctxA, {}).result.count, before);
  });
});

describe("fashion.capsule + #30wears", () => {
  it("creates a capsule and toggles items in", () => {
    const item = newItem(ctxA, { name: "Capsule tee" });
    const cap = call("capsule-create", ctxA, { name: "Summer 33", targetSize: 33 }).result.capsule;
    const t = call("capsule-toggle-item", ctxA, { capsuleId: cap.id, itemId: item.id });
    assert.equal(t.result.filled, 1);
    const list = call("capsule-list", ctxA, {});
    assert.equal(list.result.capsules[0].filled, 1);
    assert.equal(call("capsule-delete", ctxA, { id: cap.id }).ok, true);
  });

  it("enrolls an item in the #30wears challenge and tracks progress", () => {
    const item = newItem(ctxA, { name: "Pledge tee" });
    const ch = call("challenge-enroll", ctxA, { itemId: item.id, target: 3 }).result.challenge;
    assert.ok(ch.id);
    call("item-wear", ctxA, { id: item.id });
    call("item-wear", ctxA, { id: item.id });
    const list = call("challenge-list", ctxA, {});
    assert.equal(list.result.challenges[0].progress, 2);
    assert.equal(list.result.challenges[0].complete, false);
    assert.equal(call("challenge-unenroll", ctxA, { id: ch.id }).ok, true);
  });
});
