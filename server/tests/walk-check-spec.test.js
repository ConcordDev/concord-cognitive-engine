// The check-spec format and its runner (scripts/walk/check-spec.mjs, run-check.mjs).
// Every expectation kind is proved both ways against a small local site: it passes when
// the page is right and fails, with the reason, when the page is wrong.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { validateSpec } from "../../scripts/walk/check-spec.mjs";
import { runSpec, credentialsFor, launchBrowser } from "../../scripts/walk/run-check.mjs";

const PAGES = {
  "/good": `<!doctype html><html><body style="margin:0;background:#fff">
    <h1>Calendar</h1>
    <p id="body" style="color:#222">Readable text</p>
    <label>Title <input id="t"></label>
    <button onclick="document.getElementById('saved').hidden=false">Save</button>
    <p id="saved" hidden>Saved</p>
    <a download="week.ics" href="data:text/calendar,BEGIN%3AVCALENDAR%0ADTSTART%3A20421112T190000Z%0AEND%3AVCALENDAR">Export</a>
    <button onclick="const d=document.getElementById('dlg');d.showModal();document.getElementById('in').focus()">Open dialog</button>
    <dialog id="dlg" aria-label="Edit event"><input id="in" aria-label="Event name"><button>Done</button></dialog>
    <ul><li>a</li><li>b</li><li>c</li></ul>
  </body></html>`,
  "/bad": `<!doctype html><html><body style="margin:0;background:#fff">
    <p id="faint" style="color:#ddd">Faint text</p>
    <div data-testid="wide" style="width:600px;height:10px;background:#eee"></div>
    <button onclick="document.getElementById('dlg').showModal()">Open dialog</button>
    <dialog id="dlg" aria-label="Edit event"><button>Done</button></dialog>
    <a href="data:text/plain,nothing" download="notes.txt">Export</a>
    <script>console.error("boom: failed to load events")</script>
  </body></html>`,
};
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") { res.writeHead(204); return res.end(); } // the real site has one; a 404 here is a real console error
    const p = PAGES[req.url.split("?")[0]];
    if (!p) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(p);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); server?.close(); });

const spec = (over) => ({ id: "CS-calendar-test", lens: "calendar", why: "a check written the fixed way", path: "/good", account: "anon", viewport: "desktop", steps: [], expect: [{ noConsoleErrors: {} }], ...over });
const run = (s) => runSpec(s, { browser, base });

test("the format refuses what it cannot run, and says why", () => {
  const cases = [
    [{ ...spec(), extra: 1 }, /spec.extra: not allowed/],
    [spec({ id: "calendar-x" }), /CS-<lens>-<slug>/],
    [spec({ id: "CS-mail-x" }), /must start with CS-<lens>-/],
    [spec({ account: "root" }), /spec.account/],
    [spec({ viewport: "tablet" }), /spec.viewport/],
    [spec({ path: "lenses/calendar" }), /starting with \//],
    [spec({ why: "ok" }), /say what you expected/],
    [spec({ expect: [] }), /at least one expectation/],
    [spec({ steps: [{ do: "hover", target: { text: "x" } }] }), /steps\[0\].do/],
    [spec({ steps: [{ do: "click", target: { css: ".btn" } }] }), /css: not a target key/],
    [spec({ steps: [{ do: "click", target: { role: "button", text: "Save" } }] }), /exactly one of role, label, text, testId/],
    [spec({ expect: [{ visible: { target: { text: "x" } }, url: { matches: "x" } }] }), /exactly one of/],
    [spec({ expect: [{ text: { target: { text: "x" } } }] }), /exactly one of equals, contains, matches/],
    [spec({ expect: [{ url: { matches: "(" } }] }), /not a valid regex/],
    [spec({ expect: [{ count: { target: { text: "x" } } }] }), /eq, min or max/],
  ];
  for (const [s, re] of cases) { const v = validateSpec(s); assert.equal(v.ok, false, JSON.stringify(s)); assert.match(v.errors.join(" | "), re); }
  assert.equal(validateSpec(spec()).ok, true);
});

test("accounts come only from the environment; a missing one is an ERROR, never a pass", async () => {
  assert.equal(credentialsFor("anon", {}), null);
  assert.match(credentialsFor("member", {}).missing, /CONCORD_WALK_MEMBER_USER/);
  assert.deepEqual(credentialsFor("admin", { CONCORD_WALK_ADMIN_USER: "a", CONCORD_WALK_ADMIN_PASS: "b" }), { user: "a", pass: "b" });
  const r = await runSpec(spec({ account: "member" }), { browser, base, env: {} });
  assert.equal(r.verdict, "ERROR");
  assert.match(r.error, /no credentials for account "member"/);
});

test("a correct page passes every kind of expectation", async () => {
  const r = await run(spec({
    steps: [{ do: "fill", target: { label: "Title" }, value: "Standup" }, { do: "click", target: { role: "button", name: "Save" } }, { do: "click", target: { role: "link", name: "Export" } }],
    expect: [
      { visible: { target: { text: "Saved" } } },
      { text: { target: { role: "heading", name: "Calendar" }, equals: "Calendar" } },
      { count: { target: { role: "listitem" }, eq: 3 } },
      { url: { matches: "/good$" } },
      { download: { ext: ".ics", contains: "DTSTART:20421112T190000Z" } },
      { noHorizontalScroll: {} },
      { contrast: { target: { text: "Readable text" }, min: 4.5 } },
      { noConsoleErrors: {} },
      { status: { path: "/does-not-exist", eq: 404 } },
    ],
  }));
  assert.equal(r.verdict, "PASS", JSON.stringify(r.expect.filter((e) => !e.ok)));
  // WCAG by hand: L(#222) = ((34/255 + 0.055) / 1.055)^2.4 = 0.01600; (1 + 0.05) / (0.01600 + 0.05) = 15.91
  assert.match(r.expect.find((e) => e.kind === "contrast").detail, /^15\.91:1/);
});

test("a dialog that takes focus passes focusInside; one that does not, fails", async () => {
  const good = await run(spec({ steps: [{ do: "click", target: { role: "button", name: "Open dialog" } }], expect: [{ focusInside: { target: { role: "dialog", name: "Edit event" } } }] }));
  assert.equal(good.verdict, "PASS", JSON.stringify(good.expect));
  const bad = await run(spec({ path: "/bad", steps: [{ do: "click", target: { role: "button", name: "Open dialog" } }, { do: "press", key: "Tab" }, { do: "press", key: "Tab" }, { do: "press", key: "Escape" }], expect: [{ focusInside: { target: { role: "dialog", name: "Edit event" } } }] }));
  assert.equal(bad.verdict, "FAIL");
});

test("a wrong page fails each expectation with its reason", async () => {
  const r = await runSpec(spec({
    path: "/bad", viewport: "mobile",
    steps: [{ do: "click", target: { role: "link", name: "Export" } }],
    expect: [
      { noHorizontalScroll: {} },
      { contrast: { target: { text: "Faint text" }, min: 4.5 } },
      { noConsoleErrors: {} },
      { download: { ext: ".ics" } },
      { visible: { target: { text: "Saved" } } },
      { status: { path: "/bad", eq: 404 } },
    ],
  }), { browser, base });
  assert.equal(r.verdict, "FAIL");
  const d = Object.fromEntries(r.expect.map((e) => [e.kind, e]));
  assert.ok(!d.noHorizontalScroll.ok); assert.match(d.noHorizontalScroll.detail, /page 600px in a 390px viewport; wider: div\[data-testid=wide\]/);
  assert.ok(!d.contrast.ok); assert.match(d.contrast.detail, /^1\.\d+:1/, "#ddd on white is about 1.4:1");
  assert.ok(!d.noConsoleErrors.ok); assert.match(d.noConsoleErrors.detail, /boom: failed to load events/);
  assert.ok(!d.download.ok); assert.equal(d.download.detail, "notes.txt");
  assert.ok(!d.visible.ok); assert.match(d.visible.detail, /text "Saved" not visible/);
  assert.ok(!d.status.ok); assert.equal(d.status.detail, "HTTP 200");
});

test("a step that cannot be done is a FAIL with the step named, and nothing after it is claimed", async () => {
  const r = await run(spec({ steps: [{ do: "click", target: { role: "button", name: "Delete forever" } }], expect: [{ noConsoleErrors: {} }] }));
  assert.equal(r.verdict, "FAIL");
  assert.match(r.error, /step 0 \(click\) could not be done/);
  assert.equal(r.expect[0].ok, false);
  assert.match(r.expect[0].detail, /not checked: a step failed/);
});

test("the result is a walker record (type check_result) the ingest reads", async () => {
  const r = await run(spec());
  for (const k of ["type", "id", "lens", "verdict", "why", "base", "path", "account", "viewport", "steps", "expect", "consoleErrors", "startedAt", "durationMs"]) assert.ok(k in r, k);
  assert.equal(r.type, "check_result");
});
