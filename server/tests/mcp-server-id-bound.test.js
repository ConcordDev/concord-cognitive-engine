// FIX-byo-keys-011 (MCP leg): mcp.connect accepted a serverId of any
// length. The bound lives at the domain action; a behavioural drive
// would attempt a real connection, so this pins the guard at its source.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../domains/mcp.js", import.meta.url), "utf8");

describe("mcp connect — serverId bound (FIX-byo-keys-011)", () => {
  it("connect refuses a serverId past 64 chars by name", () => {
    assert.match(SRC, /serverId\.trim\(\)\.length > 64/);
    assert.match(SRC, /reason: "server_id_too_long"/);
  });
});
