// Realtime health feed reads WHO's official Disease Outbreak News JSON API (the old DON RSS
// URL 404s). Only headline + item link + date leave the parser (WHO terms: no article body).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WHO_DON_URL, WHO_DON_ITEM_BASE, sharedUpstreamUrls } from "../lib/shared-http.js";
import { parseWhoDonJson } from "../emergent/realtime-feeds.js";

const SAMPLE = JSON.stringify({ "@odata.context": "x", value: [
  { PublicationDate: "2026-10-23T15:48:48Z", ItemDefaultUrl: "/2026-DON622", Title: "Ebola disease caused by Bundibugyo virus, DRC", DonId: "2026-DON622", Overview: "LONG BODY ".repeat(200) },
  { PublicationDate: "2026-10-15T16:22:00Z", ItemDefaultUrl: "/mers-ksa", Title: "MERS-CoV - Saudi Arabia" },
  { PublicationDate: "not a date", ItemDefaultUrl: "", Title: "no link, dropped" },
  { Title: "" },
] });

describe("WHO DON JSON (realtime health)", () => {
  it("points at WHO's official DON API, newest first, and is a shared upstream", () => {
    const u = new URL(WHO_DON_URL);
    assert.equal(u.origin, "https://www.who.int");
    assert.equal(u.pathname, "/api/news/diseaseoutbreaknews");
    assert.match(u.searchParams.get("$orderby"), /PublicationDate desc/);
    assert.ok(sharedUpstreamUrls().includes(WHO_DON_URL));
  });
  it("maps rows to {title, link, pubDate} with who.int item links and no body text", () => {
    const a = parseWhoDonJson(SAMPLE);
    assert.equal(a.length, 2);
    assert.deepEqual(Object.keys(a[0]).sort(), ["link", "pubDate", "title"]);
    assert.equal(a[0].link, `${WHO_DON_ITEM_BASE}/2026-DON622`);
    assert.equal(a[0].pubDate, "Fri, 23 Oct 2026 15:48:48 GMT");
    assert.ok(!JSON.stringify(a).includes("LONG BODY"));
  });
  it("bad JSON throws (honest failure, nothing cached)", () => {
    assert.throws(() => parseWhoDonJson("<html>404</html>"), /who_don_bad_json/);
  });
});
