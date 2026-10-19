// server/tests/chunked-write.test.js
// INC-100 state-save: writeFileChunkedYielding must land byte-identical output
// and yield between chunks (so the event loop can run).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileChunkedYielding } from "../lib/chunked-write.js";

const now = (fn) => fn();

describe("writeFileChunkedYielding", () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chunked-write-"));
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("writes byte-identical output for a multi-chunk string", async () => {
    const file = path.join(dir, "a.json");
    const data = "x".repeat(1024 * 1024 + 17); // > 2 default-ish chunks at 512KB
    await writeFileChunkedYielding(file, data, { chunkSize: 64 * 1024, scheduler: now });
    assert.equal(fs.readFileSync(file, "utf8"), data);
  });

  it("yields between chunks (scheduler called)", async () => {
    const file = path.join(dir, "b.json");
    let yields = 0;
    const scheduler = (fn) => { yields++; fn(); };
    const data = "y".repeat(200 * 1024);
    await writeFileChunkedYielding(file, data, { chunkSize: 64 * 1024, scheduler });
    // 200KB / 64KB = 4 chunks (ceil) → at least 4 yields
    assert.ok(yields >= 4, `expected >=4 yields, got ${yields}`);
    assert.equal(fs.readFileSync(file, "utf8"), data);
  });

  it("handles empty string", async () => {
    const file = path.join(dir, "empty.json");
    await writeFileChunkedYielding(file, "", { scheduler: now });
    assert.equal(fs.readFileSync(file, "utf8"), "");
  });
});
