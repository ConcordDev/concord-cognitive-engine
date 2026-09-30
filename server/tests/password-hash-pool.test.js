// server/tests/password-hash-pool.test.js
//
// bcrypt runs on a worker thread (lib/password-hash-pool.js) so logins don't
// cost the request loop ~300ms of CPU each. Pins: hashes are standard bcrypt
// and interoperate with in-thread bcryptjs in BOTH directions (existing
// passwords keep working), wrong passwords fail, and the main thread stays free.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { hashPasswordOffThread, verifyPasswordOffThread, terminatePasswordWorkers } from "../lib/password-hash-pool.js";

after(() => terminatePasswordWorkers());

test("worker hashes are standard bcrypt and interoperate both ways", async () => {
  const h = await hashPasswordOffThread("correct horse", 8);
  assert.match(h, /^\$2[aby]\$08\$/);
  assert.equal(bcrypt.compareSync("correct horse", h), true, "in-thread bcryptjs verifies a worker hash");
  const legacy = bcrypt.hashSync("battery staple", 8);
  assert.equal(await verifyPasswordOffThread("battery staple", legacy), true, "worker verifies an existing hash");
  assert.equal(await verifyPasswordOffThread("wrong", legacy), false);
});

test("hashing does not block the main event loop", async () => {
  let maxGap = 0, last = Date.now(), stop = false;
  const tick = () => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; if (!stop) setTimeout(tick, 5); };
  tick();
  await Promise.all([hashPasswordOffThread("a", 12), hashPasswordOffThread("b", 12)]);
  stop = true;
  assert.ok(maxGap < 80, `main loop stalled ${maxGap}ms while two 12-round hashes ran`);
});
