// fd-guard and the faction-rep batch buffer once called the logger module's
// default export as a function. It is an object, so the boot guard crashed the
// server wherever the fd limit sat between the warn floor and the target, and
// every faction-rep flush threw from both its success and error paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startupFdGuard } from "../lib/fd-guard.js";
import { getFactionRepBuffer, setFactionRepFlushHandler } from "../lib/batch-commit-buffer.js";

test("startupFdGuard logs instead of throwing", () => {
  assert.doesNotThrow(() => startupFdGuard());
});

test("a faction-rep flush reaches its handler and completes", async () => {
  const seen = [];
  setFactionRepFlushHandler(async (grouped) => { seen.push(grouped); });
  const buf = getFactionRepBuffer();
  buf.enqueue("player1:court", 5);
  buf.enqueue("player2:court", 3);
  await buf.flush();
  buf.stop();
  setFactionRepFlushHandler(null);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].get("court").map((e) => e.delta).sort(), [3, 5]);
  assert.equal(buf.size(), 0);
});
