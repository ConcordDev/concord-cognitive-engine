// FIX-services-006 — every reminder channel was an outbound one:
// reminderSchedule coerced channel to sms/email, so a member who
// wanted a reminder as a private note had no way to keep it from
// being queued to a real destination. A third channel, "none"
// ("Just for me — don't send"), is now accepted at schedule time,
// stored, offered in the form, and skipped by dispatch — it stays
// in the member's own list and is never queued or failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domain = readFileSync(join(root, "server", "domains", "services.js"), "utf8");
const suite = readFileSync(join(root, "concord-frontend", "components", "services", "BookingSuite.tsx"), "utf8");

test("the schedule action accepts the private channel", () => {
  assert.match(domain, /\["sms", "email", "none"\]\.includes\(p\.channel\)/);
});

test("dispatch never queues or fails a private reminder", () => {
  assert.match(domain, /r\.status === "scheduled" && r\.channel !== "none" && new Date\(r\.sendAt\) <= now/);
});

test("the form offers it and renders it honestly in the list", () => {
  assert.match(suite, /<option value="none">Just for me/);
  assert.match(suite, /Stays in your list only — nothing is sent\./);
  assert.match(suite, /r\.channel === 'none' \? 'just me' : r\.channel/);
});
