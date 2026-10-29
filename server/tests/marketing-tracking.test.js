// server/tests/marketing-tracking.test.js
// Q47/A#8 — email engagement (opened/clicked) was permanently null
// with "engagement tracking not implemented". These tests pin the
// real mechanism: tracked HTML built at send time (pixel + click
// redirects under CONCORD_BASE_URL), beacons recording first-open /
// first-click on the send records, and click redirects restricted
// to the send's own recorded links (no open redirector). The
// honest-delivery contract is unchanged: no base URL → no tracking
// body → engagement stays null.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  trackingBaseUrl,
  extractEmailLinks,
  buildTrackedEmailHtml,
  recordEmailOpen,
  recordEmailClick,
  engagementCounts,
  findSendRecord,
} from "../lib/marketing-tracking.js";

const BLOCKS = [
  { type: "heading", content: "Launch <Day> & News" },
  { type: "text", content: "Read https://example.com/post, then https://example.com/post again or https://docs.example.com/guide." },
  { type: "button", content: "https://example.com/buy" },
  { type: "image", content: "https://cdn.example.com/hero.png" },
  { type: "divider", content: "" },
];

describe("marketing tracking lib", () => {
  it("gates the base URL: only an explicit http(s) CONCORD_BASE_URL activates tracking", () => {
    assert.equal(trackingBaseUrl({}), "");
    assert.equal(trackingBaseUrl({ CONCORD_BASE_URL: "notaurl" }), "");
    assert.equal(trackingBaseUrl({ CONCORD_BASE_URL: "https://concord-os.org/" }), "https://concord-os.org");
  });

  it("extracts deduped links in order, trimming trailing punctuation", () => {
    assert.deepEqual(extractEmailLinks(BLOCKS), [
      "https://example.com/post",
      "https://docs.example.com/guide",
      "https://example.com/buy",
      "https://cdn.example.com/hero.png",
    ]);
  });

  it("builds HTML with the open pixel, tracked links, and escaped content", () => {
    const { html, links } = buildTrackedEmailHtml({ blocks: BLOCKS, sendId: "snd_1", baseUrl: "https://concord-os.org" });
    assert.ok(html.includes("/api/marketing/track/open/snd_1"), "pixel present");
    assert.ok(html.includes("/api/marketing/track/click/snd_1?u=https%3A%2F%2Fexample.com%2Fpost"), "text link tracked");
    assert.ok(html.includes("/api/marketing/track/click/snd_1?u=https%3A%2F%2Fexample.com%2Fbuy"), "button link tracked");
    assert.ok(html.includes("Launch &lt;Day&gt; &amp; News"), "heading escaped");
    assert.ok(!html.includes("<Day>"), "no raw injection");
    assert.equal(links.length, 4);
  });

  it("without a base URL the HTML carries no beacons", () => {
    const { html } = buildTrackedEmailHtml({ blocks: BLOCKS, sendId: "snd_1", baseUrl: "" });
    assert.ok(!html.includes("/api/marketing/track/"));
    assert.ok(html.includes('href="https://example.com/post"'), "links stay direct");
  });
});

describe("beacon recording", () => {
  let state;
  beforeEach(() => {
    state = {
      marketingLens: {
        emailSends: new Map([
          ["eml_1", [
            { id: "snd_1", to: "a@x.com", opened: null, clicked: null, links: ["https://example.com/post"] },
            { id: "snd_2", to: "b@x.com", opened: null, clicked: null, links: [] },
          ]],
        ]),
      },
    };
  });

  it("records first open only, and finds records across emails", () => {
    const rec = recordEmailOpen(state, "snd_1", "2026-10-28T10:00:00.000Z");
    assert.equal(rec.opened, "2026-10-28T10:00:00.000Z");
    recordEmailOpen(state, "snd_1", "2026-10-28T11:00:00.000Z");
    assert.equal(findSendRecord(state, "snd_1").opened, "2026-10-28T10:00:00.000Z", "first open wins");
    assert.equal(recordEmailOpen(state, "snd_unknown", "2026-10-28T10:00:00.000Z"), null);
  });

  it("click redirects only to the send's own recorded links", () => {
    const target = recordEmailClick(state, "snd_1", "https://example.com/post", "2026-10-28T10:05:00.000Z");
    assert.equal(target, "https://example.com/post");
    assert.equal(findSendRecord(state, "snd_1").clicked, "2026-10-28T10:05:00.000Z");
    // Arbitrary URL → refused (no open redirect), nothing recorded.
    assert.equal(recordEmailClick(state, "snd_2", "https://evil.example.com/phish", "2026-10-28T10:06:00.000Z"), null);
    assert.equal(findSendRecord(state, "snd_2").clicked, null);
    assert.equal(recordEmailClick(state, "snd_unknown", "https://example.com/post", "2026-10-28T10:06:00.000Z"), null);
  });

  it("engagementCounts aggregates truthy opened/clicked like email-list does", () => {
    recordEmailOpen(state, "snd_1", "2026-10-28T10:00:00.000Z");
    recordEmailClick(state, "snd_1", "https://example.com/post", "2026-10-28T10:05:00.000Z");
    assert.deepEqual(engagementCounts(state.marketingLens.emailSends.get("eml_1")), { sent: 2, opened: 1, clicked: 1 });
  });
});
