// FIX-events-003 — events record an intended visibility, and a private
// event's public page cannot be published. Before: event-create stored
// no visibility at all, so the planner offered no public/private
// control and nothing recorded the owner's intent; the only public
// surface (the published page) is now gated on that recorded intent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const domain = readFileSync(join(root, "server", "domains", "events.js"), "utf8");
const planner = readFileSync(join(root, "concord-frontend", "components", "events", "EventPlanner.tsx"), "utf8");

test("event-create stores a validated visibility, defaulting to private", () => {
  const i = domain.indexOf('registerLensAction("events", "event-create"');
  const block = domain.slice(i, i + 1500);
  assert.match(block, /\["public", "private"\]\.includes\(params\.visibility\) \? params\.visibility : "private"/);
});

test("event-update can change visibility; publish-page refuses a private event", () => {
  assert.match(domain, /params\.visibility != null && \["public", "private"\]\.includes\(params\.visibility\)\) event\.visibility = params\.visibility/);
  const i = domain.indexOf('registerLensAction("events", "publish-page"');
  const block = domain.slice(i, i + 1200);
  assert.match(block, /set its visibility to Public before publishing/);
});

test("the planner offers the control at create and in detail, and lists the state", () => {
  assert.match(planner, /aria-label="Event visibility"/, "create form has the selector");
  assert.match(planner, /visibility: form\.visibility/, "create sends the choice");
  assert.match(planner, /aria-label="Visibility"/, "detail view can change it");
  assert.match(planner, /'Public' : 'Private'/, "list rows show the state");
});
