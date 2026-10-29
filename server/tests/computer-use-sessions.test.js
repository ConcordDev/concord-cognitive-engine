// server/tests/computer-use-sessions.test.js
//
// Q41 (audit A#36): computer-use browser sessions are REUSED across
// actions. Previously executeComputerUse launched a fresh Chromium for
// every action and closed it at the end of the call, so no URL, cookie,
// or page state survived between calls — a click after a navigate acted
// on a brand-new about:blank page, and multi-step flows could not work.
// These tests drive the tool with a fake playwright (the module's test
// seam) and pin: one launch per session, state visible across calls,
// per-sandbox isolation, the idle TTL, the LRU cap, crash relaunch, and
// the disabled gate (child process, env unset).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.env.COMPUTER_USE_ENABLED = "true";
process.env.COMPUTER_USE_SESSION_IDLE_TTL_MS = "60000"; // per-test TTL cases shorten via re-import-free path below

let mod;
before(async () => {
  mod = await import("../lib/tools/computer-use-tool.js");
});

function makeFakePlaywright() {
  const state = { launches: 0, browsers: [] };
  function makePage(browser) {
    return {
      _url: "about:blank",
      _closed: false,
      async goto(u) { this._url = u; },
      url() { return this._url; },
      async title() { return "Fake Title"; },
      async screenshot() { return Buffer.from("fake-png"); },
      async click() { browser.clicks.push(this._url); },
      async fill() {},
      async evaluate() { return ""; },
      async $() { return null; },
      isClosed() { return this._closed; },
      context() { return { browser: () => browser }; },
    };
  }
  const pw = {
    chromium: {
      async launch() {
        state.launches++;
        const browser = {
          clicks: [],
          connected: true,
          closed: false,
          _handlers: {},
          on(ev, fn) { this._handlers[ev] = fn; },
          isConnected() { return this.connected; },
          async newContext() { return { newPage: async () => makePage(browser) }; },
          async close() { this.closed = true; this.connected = false; this._handlers.disconnected?.(); },
        };
        state.browsers.push(browser);
        return browser;
      },
    },
  };
  return { pw, state };
}

const call = (args) => ({ name: "computer_use", args });
const parse = (s) => JSON.parse(s);

after(async () => { await mod.closeAllComputerUseSessions(); });

describe("computer-use sessions (A#36)", () => {
  it("reuses one browser per sandbox across actions — page state survives between calls", async () => {
    const { pw, state } = makeFakePlaywright();
    mod._setComputerUsePlaywrightForTests(pw);
    await mod.closeAllComputerUseSessions();

    const nav = parse(await mod.executeComputerUse(call({ action: "navigate", url: "https://example.com/form", sandboxId: "sb-1" })));
    assert.equal(nav.ok, true);
    const click = parse(await mod.executeComputerUse(call({ action: "click", selector: "#go", sandboxId: "sb-1" })));
    assert.equal(click.ok, true);
    const shot = parse(await mod.executeComputerUse(call({ action: "screenshot", sandboxId: "sb-1" })));
    assert.equal(shot.currentUrl, "https://example.com/form", "the screenshot sees the URL the navigate set — same page, same session");
    assert.deepEqual(state.browsers[0].clicks, ["https://example.com/form"], "the click acted on the navigated page, not about:blank");
    assert.equal(state.launches, 1, "exactly one browser launch for three actions in one session");
    assert.equal(mod.computerUseSessionCount(), 1);
  });

  it("a different sandboxId gets its own browser and a fresh page", async () => {
    const { pw, state } = makeFakePlaywright();
    mod._setComputerUsePlaywrightForTests(pw);
    await mod.closeAllComputerUseSessions();

    await mod.executeComputerUse(call({ action: "navigate", url: "https://a.example", sandboxId: "sb-a" }));
    const shotB = parse(await mod.executeComputerUse(call({ action: "screenshot", sandboxId: "sb-b" })));
    assert.equal(shotB.currentUrl, "about:blank");
    assert.equal(state.launches, 2);
    assert.equal(mod.computerUseSessionCount(), 2);
  });

  it("falls back to the calling user, then to a shared default, as the session key", async () => {
    const { pw, state } = makeFakePlaywright();
    mod._setComputerUsePlaywrightForTests(pw);
    await mod.closeAllComputerUseSessions();

    await mod.executeComputerUse(call({ action: "navigate", url: "https://u.example" }), { userId: "u-1" });
    const shot = parse(await mod.executeComputerUse(call({ action: "screenshot" }), { userId: "u-1" }));
    assert.equal(shot.currentUrl, "https://u.example");
    await mod.executeComputerUse(call({ action: "screenshot" })); // default key
    assert.equal(state.launches, 2, "user session + default session, one launch each");
  });

  it("evicts the least-recently-used session beyond the cap", async () => {
    const { pw, state } = makeFakePlaywright();
    mod._setComputerUsePlaywrightForTests(pw);
    await mod.closeAllComputerUseSessions();

    const max = mod.COMPUTER_USE_MAX_SESSIONS;
    for (let i = 0; i < max; i++) {
      await mod.executeComputerUse(call({ action: "screenshot", sandboxId: `cap-${i}` }));
      await sleep(5); // order the LRU timestamps
    }
    assert.equal(mod.computerUseSessionCount(), max);
    await mod.executeComputerUse(call({ action: "screenshot", sandboxId: "cap-new" }));
    assert.equal(mod.computerUseSessionCount(), max, "the cap holds");
    assert.equal(state.browsers[0].closed, true, "the oldest session's browser was closed");
    assert.equal(state.launches, max + 1);
  });

  it("relaunches transparently after the session's browser dies", async () => {
    const { pw, state } = makeFakePlaywright();
    mod._setComputerUsePlaywrightForTests(pw);
    await mod.closeAllComputerUseSessions();

    await mod.executeComputerUse(call({ action: "navigate", url: "https://x.example", sandboxId: "sb-crash" }));
    assert.equal(state.launches, 1);
    await state.browsers[0].close(); // simulate a crash: disconnected fires
    const shot = parse(await mod.executeComputerUse(call({ action: "screenshot", sandboxId: "sb-crash" })));
    assert.equal(shot.ok, true);
    assert.equal(state.launches, 2, "a fresh browser launched for the same sandbox");
  });

  it("closeComputerUseSession closes just that session's browser", async () => {
    const { pw, state } = makeFakePlaywright();
    mod._setComputerUsePlaywrightForTests(pw);
    await mod.closeAllComputerUseSessions();

    await mod.executeComputerUse(call({ action: "screenshot", sandboxId: "sb-keep" }));
    await mod.executeComputerUse(call({ action: "screenshot", sandboxId: "sb-drop" }));
    await mod.closeComputerUseSession("sb-drop");
    assert.equal(mod.computerUseSessionCount(), 1);
    assert.equal(state.browsers[0].closed, false);
    assert.equal(state.browsers[1].closed, true);
  });

  it("an idle session past its TTL is evicted and relaunched (child process, 60 ms TTL)", async () => {
    const moduleUrl = new URL("../lib/tools/computer-use-tool.js", import.meta.url).href;
    const script = `
      const m = await import(${JSON.stringify(moduleUrl)});
      let launches = 0;
      const page = { _url: "about:blank", async goto(u) { this._url = u; }, url() { return this._url; },
        async title() { return "t"; }, async screenshot() { return Buffer.from("p"); },
        isClosed() { return false; }, context() { return { browser: () => browser }; } };
      const browser = { connected: true, on() {}, isConnected() { return this.connected; },
        async newContext() { return { newPage: async () => page }; }, async close() { this.connected = false; } };
      m._setComputerUsePlaywrightForTests({ chromium: { async launch() { launches++; return browser; } } });
      await m.executeComputerUse({ name: "computer_use", args: { action: "screenshot", sandboxId: "ttl" } });
      const afterFirst = launches;
      await new Promise((r) => setTimeout(r, 150));
      await m.executeComputerUse({ name: "computer_use", args: { action: "screenshot", sandboxId: "ttl" } });
      console.log(JSON.stringify({ afterFirst, afterIdle: launches, sessions: m.computerUseSessionCount() }));
    `;
    const env = { ...process.env, COMPUTER_USE_ENABLED: "true", COMPUTER_USE_SESSION_IDLE_TTL_MS: "60" };
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { env });
    const r = JSON.parse(stdout.trim());
    assert.equal(r.afterFirst, 1);
    assert.equal(r.afterIdle, 2, "the idle session was evicted and a fresh browser launched");
    assert.equal(r.sessions, 1);
  });

  it("the disabled gate still refuses when COMPUTER_USE_ENABLED is not set (child process)", async () => {
    const moduleUrl = new URL("../lib/tools/computer-use-tool.js", import.meta.url).href;
    const script = `
      const m = await import(${JSON.stringify(moduleUrl)});
      const r = await m.executeComputerUse({ name: "computer_use", args: { action: "screenshot" } });
      console.log(r);
    `;
    const env = { ...process.env };
    delete env.COMPUTER_USE_ENABLED;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { env });
    const r = JSON.parse(stdout.trim());
    assert.equal(r.ok, false);
    assert.match(r.error, /COMPUTER_USE_ENABLED/);
  });
});
