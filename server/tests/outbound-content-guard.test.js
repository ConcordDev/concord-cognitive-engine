// server/tests/outbound-content-guard.test.js
//
// Pins server/lib/outbound-content-guard.js's true/false-positive
// behavior directly, plus proves it's actually wired into
// byo-providers.js#providerChat — the single enforcement point that
// covers BYO and platform-provider calls alike (task #24 of the Private
// Mode / High Power Mode plan).
//
// Fixture note: every "true positive" string below is built by
// concatenating fragments (never a single contiguous literal) so it
// can't be matched by GitHub's own push-protection secret scanner as an
// apparent real credential in this file's diff — these are synthetic
// shapes for regex-fixture purposes only, not real keys.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { scanTextForLeaks, scanMessagesForLeaks } from "../lib/outbound-content-guard.js";
import { providerChat } from "../lib/byo-providers.js";

const cat = (...parts) => parts.join("");

const FAKE_OPENAI_KEY = cat("sk-", "proj-", "Q7mK2wPz9vLxN4tRhY8sB1cD3eF5", "gH6jJ0");
const FAKE_ANTHROPIC_KEY = cat("sk-", "ant-", "Q7mK2wPz9vLxN4tRhY8sB1cD3eF5", "gH6jJ0api03");
const FAKE_GITHUB_TOKEN = cat("ghp_", "Q7mK2wPz9vLxN4tRhY8sB1cD3eF5", "gH6jJ0k1L2m3N4o5P6");
const FAKE_AWS_KEY = cat("AKIA", "Q7MK2WPZ9VLXN4TR");
const FAKE_STRIPE_KEY = cat("sk_", "live_", "Q7mK2wPz9vLxN4tRhY8sB1cD3eF5", "gH6jJ0k1L2m3");
const FAKE_GOOGLE_KEY = cat("AIza", "SyD_7x9K2mPzQ4vLxN8tRhY1sB6cW3eF5gH");

describe("scanTextForLeaks — true positives", () => {
  it("flags an OpenAI-shaped key", () => {
    const r = scanTextForLeaks(`here's my key ${FAKE_OPENAI_KEY}`);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "openai_key");
  });

  it("flags an Anthropic-shaped key", () => {
    const r = scanTextForLeaks(FAKE_ANTHROPIC_KEY);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "anthropic_key");
  });

  it("flags a GitHub personal access token", () => {
    const r = scanTextForLeaks(`token: ${FAKE_GITHUB_TOKEN}`);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "github_token");
  });

  it("flags an AWS access key id", () => {
    const r = scanTextForLeaks(`${FAKE_AWS_KEY} is my access key`);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "aws_access_key");
  });

  it("flags a Stripe live secret key", () => {
    const r = scanTextForLeaks(FAKE_STRIPE_KEY);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "stripe_live_key");
  });

  it("flags an embedded PEM private key", () => {
    const r = scanTextForLeaks(cat("-----BEGIN ", "RSA ", "PRIVATE KEY-----", "\nMIIEow..."));
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "private_key_pem");
  });

  it("flags a Google API key (real keys are exactly 39 chars: 'AIza' + 35)", () => {
    const r = scanTextForLeaks(`my key is ${FAKE_GOOGLE_KEY} in the config`);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "google_api_key");
  });

  it("flags a US SSN shape", () => {
    const r = scanTextForLeaks("my ssn is 123-45-6789 please help");
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "us_ssn");
  });

  it("flags a Luhn-valid credit card number", () => {
    // 4111 1111 1111 1111 is the standard Luhn-valid Visa test number.
    const r = scanTextForLeaks(`card number ${cat("4111", "1111", "1111", "1111")} exp 12/29`);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "credit_card");
  });
});

describe("scanTextForLeaks — false positives (must NOT block)", () => {
  it("ignores ordinary chat content", () => {
    const r = scanTextForLeaks("hey, can you help me write a haiku about the ocean?");
    assert.equal(r.blocked, false);
  });

  it("ignores an obviously-fake/example key (marker filter)", () => {
    const r = scanTextForLeaks("set OPENAI_API_KEY=sk-your-key-goes-here-example");
    assert.equal(r.blocked, false);
  });

  it("ignores a non-Luhn-valid 16-digit number (e.g. a DTU id or order number)", () => {
    const r = scanTextForLeaks(`order number ${cat("1234", "5678", "9012", "3456")} shipped yesterday`);
    assert.equal(r.blocked, false);
  });

  it("ignores a key-shaped test fixture explicitly marked fake", () => {
    const r = scanTextForLeaks(cat("sk-", "ant-", "fakekey-abc-1234567890"));
    assert.equal(r.blocked, false);
  });

  it("ignores a phone number (not SSN-shaped, not a card-length run)", () => {
    const r = scanTextForLeaks("call me at 555-867-5309");
    assert.equal(r.blocked, false);
  });

  it("handles non-string / empty / missing content gracefully", () => {
    assert.equal(scanTextForLeaks("").blocked, false);
    assert.equal(scanTextForLeaks(null).blocked, false);
    assert.equal(scanTextForLeaks(undefined).blocked, false);
    assert.equal(scanTextForLeaks(42).blocked, false);
  });
});

describe("scanMessagesForLeaks", () => {
  it("scans every message in the array, not just the first", () => {
    const r = scanMessagesForLeaks([
      { role: "system", content: "you are a helpful assistant" },
      { role: "user", content: "what's 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: `ok here's my real key: ${FAKE_OPENAI_KEY}` },
    ]);
    assert.equal(r.blocked, true);
    assert.equal(r.patternId, "openai_key");
  });

  it("returns not-blocked for a clean conversation", () => {
    const r = scanMessagesForLeaks([
      { role: "system", content: "you are a helpful assistant" },
      { role: "user", content: "tell me about the water cycle" },
    ]);
    assert.equal(r.blocked, false);
  });

  it("handles a non-array input without throwing", () => {
    assert.equal(scanMessagesForLeaks(null).blocked, false);
    assert.equal(scanMessagesForLeaks(undefined).blocked, false);
  });
});

describe("providerChat() wiring — the guard actually gates the outbound call", () => {
  it("rejects a call whose messages contain a live-shaped secret, WITHOUT reaching the adapter", async () => {
    // Use a KNOWN provider ('openai') so the only way this call can fail
    // before reaching a real network attempt is the guard itself (there's
    // no live network in this sandbox, but the guard must short-circuit
    // strictly before the adapter is invoked, and the returned error tells
    // us which branch fired).
    const r = await providerChat({
      provider: "openai",
      apiKey: "test-key-not-used-because-guard-should-fire-first",
      slot: "conscious",
      messages: [{ role: "user", content: `here's my real key: ${FAKE_OPENAI_KEY}` }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "blocked_secret_detected:openai_key");
  });

  it("a clean message set is NOT blocked by the guard (falls through to the adapter)", async () => {
    const r = await providerChat({
      provider: "openai",
      apiKey: "test-key-not-a-real-network-target",
      slot: "conscious",
      messages: [{ role: "user", content: "what's the capital of France?" }],
    });
    // We don't have live network in this sandbox, so we can't assert
    // r.ok === true here — but the guard must NOT be what failed it.
    if (r.error) assert.ok(!String(r.error).startsWith("blocked_secret_detected"), `unexpected block: ${r.error}`);
  });
});
