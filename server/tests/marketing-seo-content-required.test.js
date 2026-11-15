// marketing-seo-content-required.test.js
//
// FIX-marketing-012: the SEO audit scores pasted page content — it
// never fetched the URL — but a URL-only run scored the empty form
// (score 14, 1/7 checks, 0 words) and saved it as an audit of the
// page. With no content at all the action now refuses in words and
// saves nothing; a content-bearing run still scores and saves.

import { test } from "node:test";
import assert from "node:assert/strict";

async function loadActions() {
  globalThis._concordSTATE = {};
  const actions = new Map();
  const { default: registerMarketingActions } = await import("../domains/marketing.js");
  registerMarketingActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
  return actions;
}
const CTX = { actor: { userId: "walker" }, userId: "walker" };
const ART = { id: null, data: {}, meta: {} };

test("a URL-only SEO audit refuses in words and saves nothing", async () => {
  const actions = await loadActions();
  const audit = actions.get("marketing.seo-audit");
  const list = actions.get("marketing.seo-audit-list");

  const r = audit(CTX, ART, { url: "https://example.com" });
  assert.equal(r.ok, false);
  assert.match(r.error, /does not fetch the URL/);
  assert.equal(list(CTX, ART, {}).result.audits.length, 0);
});

test("a content-bearing run still scores and saves", async () => {
  const actions = await loadActions();
  const audit = actions.get("marketing.seo-audit");
  const list = actions.get("marketing.seo-audit-list");

  const body = Array.from({ length: 320 }, (_, i) => (i % 40 === 0 ? "harvest" : "word")).join(" ");
  const r = audit(CTX, ART, {
    url: "https://example.com",
    title: "Harvest Guide — Everything You Need To Know",
    metaDescription: "A complete guide to planning your harvest, from soil preparation through storage, with checklists for every stage of the season and beyond.",
    bodyText: body,
    keyword: "harvest",
    headingCount: 4,
    imageCount: 2,
    imagesWithAlt: 2,
  });
  assert.equal(r.ok, true);
  assert.ok(r.result.audit.score > 14);
  assert.equal(r.result.audit.wordCount, 320);
  assert.equal(list(CTX, ART, {}).result.audits.length, 1);
});
