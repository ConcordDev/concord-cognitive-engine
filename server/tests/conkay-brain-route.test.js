// BR-02 (GB-1541) — ConKay's dedicated brain slot.
// Before: ConKay turns ran on slot "conscious" (runAgentLoop's default) and
// no code read CONKAY_MODEL at all — the deploy env var named a model that
// was not installed and a variable nothing consumed. Now BRAIN_CONFIG has a
// conkay entry resolving CONKAY_MODEL (deploy sets kimi-k3.1-pro:cloud),
// falling back to the conscious model itself when unset, and the chat-agent
// stream route sends ConKay turns to the conkay slot.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const brainConfigUrl = new URL("../lib/brain-config.js", import.meta.url).href;

function conkayModelWithEnv(extraEnv) {
  const script = `
    const m = await import(${JSON.stringify(brainConfigUrl)});
    console.log(JSON.stringify({ conkay: m.BRAIN_CONFIG.conkay?.model, conscious: m.BRAIN_CONFIG.conscious?.model }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, BRAIN_LOCAL_UNIFIED_MODEL: "", ...extraEnv },
    encoding: "utf8",
    timeout: 30000,
  });
  return JSON.parse(out.trim().split("\n").pop());
}

describe("BR-02 conkay brain slot", () => {
  it("BRAIN_CONFIG.conkay exists with the full brain field set, on the conscious endpoints", async () => {
    const { BRAIN_CONFIG, BRAIN_PRIORITY } = await import(brainConfigUrl);
    const c = BRAIN_CONFIG.conkay;
    assert.ok(c, "conkay entry exists");
    for (const f of ["url", "urls", "model", "role", "temperature", "timeout", "priority", "maxConcurrent", "contextWindow", "maxTokens"]) {
      assert.ok(c[f] !== undefined && c[f] !== "", `field ${f} present`);
    }
    assert.deepEqual(c.urls, BRAIN_CONFIG.conscious.urls);
    assert.equal(c.url, BRAIN_CONFIG.conscious.url);
    assert.equal(BRAIN_PRIORITY.conkay, 1);
  });

  it("with CONKAY_MODEL unset, conkay resolves to the conscious model (pre-GB-1541 behaviour)", () => {
    const r = conkayModelWithEnv({ CONKAY_MODEL: "" });
    assert.equal(r.conkay, r.conscious);
  });

  it("with CONKAY_MODEL set, it wins (the deploy step sets kimi-k3.1-pro:cloud)", () => {
    const r = conkayModelWithEnv({ CONKAY_MODEL: "kimi-k3.1-pro:cloud" });
    assert.equal(r.conkay, "kimi-k3.1-pro:cloud");
  });

  it("brainChat resolves the conkay slot — no 'Unknown brain' (the slot is real in the router)", () => {
    // Subprocess with the conscious/conkay endpoints pointed at a dead local
    // port: the router must reach the conkay config and fail on the
    // CONNECTION, never on an unknown slot. Bounded by the exec timeout.
    const byoUrl = new URL("../lib/byo-router.js", import.meta.url).href;
    const script = `
      const { brainChat } = await import(${JSON.stringify(byoUrl)});
      const r = await brainChat({ db: null, userId: "br02-test", slot: "conkay",
        messages: [{ role: "user", content: "ping" }], opts: { timeoutMs: 2000 } });
      console.log(JSON.stringify({ error: String(r?.error || "") }));
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, BRAIN_CONSCIOUS_URLS: "http://127.0.0.1:1", BRAIN_CONSCIOUS_URL: "http://127.0.0.1:1", BRAIN_LOCAL_UNIFIED_MODEL: "" },
      encoding: "utf8", timeout: 60000,
    });
    const r = JSON.parse(out.trim().split("\n").pop());
    assert.doesNotMatch(r.error, /Unknown brain/);
  });

  it("the stream route sends ConKay turns to the conkay slot and leaves other callers' slots alone", () => {
    const src = readFileSync(path.join(here, "../routes/chat-agent-stream.js"), "utf8");
    assert.match(src, /slot: isConKay \? "conkay" : slot/);
  });
});
