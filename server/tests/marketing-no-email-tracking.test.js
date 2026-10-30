// server/tests/marketing-no-email-tracking.test.js
//
// Concord does not track email. The open pixel, click redirects, beacon
// routes and open/click counters were removed (brief K). This pins that.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import registerMarketingActions from "../domains/marketing.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const ACTIONS = new Map();
before(() => { registerMarketingActions((d, n, fn) => ACTIONS.set(`${d}.${n}`, fn)); });
const call = (name, ctx, params = {}) => ACTIONS.get(`marketing.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);

describe("email tracking is removed", () => {
  it("the beacon route and tracking lib files are gone", () => {
    assert.equal(existsSync(join(root, "routes/marketing-track.js")), false);
    assert.equal(existsSync(join(root, "lib/marketing-tracking.js")), false);
  });

  it("server.js neither mounts nor bypasses auth for the beacon paths", () => {
    const src = read("server.js");
    assert.ok(!src.includes("marketing-track"));
    assert.ok(!src.includes("/api/marketing/track"));
    assert.ok(!src.includes("createMarketingTrackRouter"));
  });

  it("the send path builds no tracking HTML and sends no html body", () => {
    const src = read("domains/marketing.js");
    assert.ok(!/track\/(open|click)/.test(src));
    assert.ok(!src.includes("buildTrackedEmailHtml"));
    assert.ok(!src.includes("CONCORD_BASE_URL"));
    assert.ok(/sendEmail\(\{ to, subject: e\.subject, text \}\)/.test(src), "sendEmail gets text only");
  });

  it("email-list reports sent count only, with no open/click fields", () => {
    const emails = new Map(); const emailSends = new Map();
    emails.set("u1", [{ id: "e1", blocks: [{ type: "text", content: "see https://example.com/x" }] }]);
    emailSends.set("e1", [{ id: "snd_1", to: "a@b.c", sentAt: "t" }]);
    globalThis._concordSTATE = { marketingLens: { emails, emailSends } };
    const r = call("email-list", { actor: { userId: "u1" }, userId: "u1" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.emails[0].stats, { sent: 1 });
  });
});
