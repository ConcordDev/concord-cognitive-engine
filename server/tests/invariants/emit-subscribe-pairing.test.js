// Invariant: every realtimeEmit() event name has at least one frontend
// subscribe() listener. Catches "dead emit" silent-bug class — server
// fires events that no UI ever reacts to. The May 2026 sprint added 17
// new event types and CLAUDE.md mandates each must be added to the
// SocketEvent union AND have a listener; this test enforces it.
//
// Scope:
//  - Walks realtimeEmit("name", ...) call sites in server/.
//  - Walks subscribe("name", ...) and subscribe<T>("name", ...) call sites
//    in concord-frontend/components, lib, hooks.
//  - An emitted event passes if it appears in at least one frontend subscribe.
//  - The SERVER_ONLY_ALLOWLIST below covers events that are *intentionally*
//    server-only (federation outbound, monitoring, event-shapes validators
//    that don't go to the UI).
//
// When a new emit is added, the test fails until you either:
//  (a) wire a frontend subscriber for it, or
//  (b) add it to SERVER_ONLY_ALLOWLIST with a one-line rationale.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", "..");
const SERVER_DIR = path.join(ROOT, "server");
const FRONTEND_DIRS = [
  path.join(ROOT, "concord-frontend", "components"),
  path.join(ROOT, "concord-frontend", "lib"),
  path.join(ROOT, "concord-frontend", "hooks"),
  path.join(ROOT, "concord-frontend", "app"),
];

// Events that legitimately have no frontend subscriber. Each entry needs
// a rationale; if you find yourself adding many, the pattern is probably
// wrong (use a different transport, or add the listener).
const SERVER_ONLY_ALLOWLIST = new Set([
  // Internal heartbeat / system metrics — consumed by Prometheus, not UI.
  "heartbeat:tick",
  "system:reconnect",
  "queue:notifications:new", // server→server queue, surfaced to UI via different fast-path
  "beacon:check",
]);

// Pre-existing dead-emit baseline. Each of these was emitting before the
// invariant test was added and has no frontend listener wired yet — they
// represent gaps to close incrementally. The test fails if new dead emits
// are added (catches the pattern going forward) or if any baseline entry
// is silently removed without either being wired or moved to allowlist.
//
// To clear an entry: add a frontend subscriber for it, then delete the
// line below. To add an entry: add a same-PR fix or wire a subscriber
// instead — the baseline isn't a hide-yet-ship pattern, it's a debt list.
const KNOWN_DEAD_BASELINE = new Set([
  // DET-C batch 10 (2026-07-24) corrected this entry's rationale: the
  // prior comment ("chat composer typing indicator — UI uses presence
  // pulse") was factually wrong — there is exactly one emit site
  // (server/routes/chat.js) and it broadcasts the AI response preview,
  // not a typing indicator. It's genuinely consumed, just through an
  // indirection this static scan (and dead-event-listener-detector.js)
  // can't trace: useRealtimeLens('chat') (concord-frontend/app/lenses/
  // chat/page.tsx:541) falls back to `${domain}:update` for any domain
  // without an explicit DOMAIN_EVENTS entry (hooks/useRealtimeLens.ts:71)
  // — 'chat' has no entry, so it resolves to a literal socket.on('chat:
  // update', ...) at runtime that this regex-based scan can't see. The
  // chat lens renders it live (LiveIndicator isLive/lastUpdated at
  // chat/page.tsx:3040). Kept in the baseline (not removed) because
  // fixing collectSubscribes() to trace template-literal socket.on()
  // calls is out of scope here — this is a documentation fix, not a
  // wiring fix.
  "chat:update",
  // Dead-event-listener follow-up (2026-07-24) corrected this entry's rationale:
  // the prior comment ("city-presence sync — frontend pulls via REST, not socket")
  // was factually wrong — `realtimeEmit("city:npcs", ...)` (server/lib/
  // city-presence.js) IS genuinely consumed, just not by concord-frontend (which
  // this test's collectSubscribes() scans) — by the Godot world client instead:
  // world-lens-godot/avatar/avatar_manager.gd explicitly documents and ingests
  // "`city:npcs`" frames (see its header + `update_transform` docs/GODOT_PROTOCOL.md
  // §3, which cites both `city:positions`/`city:npcs` as IMPLEMENTED and mirrored via
  // realtimeEmit's global broadcast() path). Same indirection CLASS as chat:update
  // above (a real, live consumer this static two-directory scan structurally can't
  // see), just a different transport (a non-web client) instead of a regex-invisible
  // template literal. Kept in the baseline — not stale (still emitted) and not
  // "wired" by this test's own definition (subs.has() will never be true for a
  // consumer outside concord-frontend) — with the corrected reason on record.
  "city:npcs",
  "emergent:activity",              // emergent-engine summary — replaced by activity:new
  // "gameJuice:fanfare" + "npc:dialogue" removed (dead-event-listener sweep
  // continuation, 2026-07-24): both event-shapes.js entries were RETIRED
  // outright (deleted, not just left undispatched) — DET-C batch 4 had found
  // ZERO real realtimeEmit() call sites for either, ever, so they were
  // documented-but-never-built contracts, not live broadcasts that lost a
  // listener. See server/lib/event-shapes.js's "── NPC ──"/"── GameJuice
  // fanfare ──" section headers for the full retirement rationale. (Their
  // presence in this baseline was also accidentally self-perpetuating: the
  // explanatory comments that used to sit above each entry literally
  // contained the text `realtimeEmit("npc:dialogue", ...)` /
  // `realtimeEmit("gameJuice:fanfare", ...)` as part of describing why they
  // were dead, which collectEmits() above — a raw regex with no comment
  // awareness — matched as if they were real call sites. Deleting the
  // comments alongside the registry entries closes that footgun too.)
  // DET-C batch 10 (2026-07-24) corrected this entry's rationale: the prior comment
  // ("knowledge graph diff — graph view pulls on-demand") was factually wrong — the
  // graph lens is live, not pull-only. Same indirection class as chat:update above:
  // useRealtimeLens('graph') (concord-frontend/app/lenses/graph/page.tsx:181) hits
  // the same `${domain}:update` default-fallback in hooks/useRealtimeLens.ts (no
  // 'graph' entry in DOMAIN_EVENTS), and the page renders it live (LiveIndicator +
  // RealtimeDataPanel at graph/page.tsx:1175-1177). Kept in the baseline for the same
  // reason as chat:update — documentation fix, not a wiring fix.
  "graph:update",
  // "channel:inbound" removed (DET-C batch 11, 2026-07-24): debt cleared for real —
  // server/routes/channels.js's realtimeEmit call sites now pass { userId } so the
  // broadcast is scoped to the recipient's own user:<id> room instead of an unscoped
  // global emit (it had been leaking which userId received an external message to
  // every connected socket), and concord-frontend/hooks/useChannelInboundToast.ts
  // (mounted in AppShell alongside useSocialNotificationToast) subscribes for real and
  // surfaces a toast. 'channel:inbound' is also now in socket.ts's SocketEvent union.
  // The full channel-linking settings page / inbound-message inbox view is still not
  // built — that remains a genuinely separate, larger feature — but the specific
  // "broadcast into the void" gap this baseline entry tracked is closed.
  "world:action",                    // generic world event — superseded by typed channels
  // "world:broadcast" + "world:loot-node" removed 2026-06-26: debt cleared — both now have real
  // frontend subscribers (wired into EmergentEventFeed during the orphan-emit wiring pass).
  // "qualia:policy" removed (DET-C batch 10, 2026-07-24): debt cleared — this baseline entry
  // went stale when DET-C batch 8 (2026-07-24) wired it into EmergentEventFeed.tsx's
  // TRACKED_EVENTS array (`{ name: 'qualia:policy', channel: 'agent', ... }`) but never
  // removed the now-redundant baseline line, which made the "entries either still need
  // wiring OR have been wired" cleanup test fail (subs.has('qualia:policy') is true via the
  // reArrayItem indirection match, so the entry was always dead weight after batch 8).
  // "app:created" + "pain:avoidance_created" removed (DET-C batch 6, 2026-07-23): debt cleared
  // — both are wired via EmergentEventFeed.tsx's channel-array indirection (verified: `grep -n
  // "'app:created'\|'pain:avoidance_created'" concord-frontend/components/world/
  // EmergentEventFeed.tsx`).
  // "timeline:post" removed (DET-C batch 6, 2026-07-23): debt cleared — genuinely wired via a
  // direct `subscribe('timeline:post', ...)` call in concord-frontend/app/lenses/feed/page.tsx:380.
  "world:notification",             // generic world toast — replaced by per-domain toasts
]);

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "coverage" || entry.name === "dist" || entry.name === "build") continue;
      walkFiles(full, out);
    } else if (entry.isFile() && /\.(js|ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function extractMatches(content, regex) {
  const out = new Set();
  let m;
  while ((m = regex.exec(content)) !== null) {
    out.add(m[1]);
  }
  return out;
}

function collectEmits() {
  const emits = new Set();
  // Match: realtimeEmit("event:name", ...) with " or '
  const re = /realtimeEmit\(\s*["']([a-z][a-zA-Z0-9:_-]*)["']/g;
  for (const f of walkFiles(SERVER_DIR)) {
    if (f.includes(`${path.sep}tests${path.sep}`)) continue;
    if (f.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const content = fs.readFileSync(f, "utf8");
    for (const e of extractMatches(content, re)) emits.add(e);
  }
  return emits;
}

function collectSubscribes() {
  const subs = new Set();
  // Match: subscribe("name", ...) or subscribe<T>("name", ...) — both forms.
  const reSubscribe = /\bsubscribe(?:<[^>]+>)?\(\s*["']([a-z][a-zA-Z0-9:_-]*)["']/g;
  // EmergentEventFeed-style dynamic subscribers: subscribe(evt.name, ...)
  // walks an array of { name: 'event:name', ... }. Pick those up too.
  const reArrayItem = /\bname\s*:\s*["']([a-z][a-zA-Z0-9:_-]*:[a-zA-Z0-9:_-]+)["']/g;
  for (const dir of FRONTEND_DIRS) {
    for (const f of walkFiles(dir)) {
      const content = fs.readFileSync(f, "utf8");
      for (const s of extractMatches(content, reSubscribe)) subs.add(s);
      for (const s of extractMatches(content, reArrayItem)) subs.add(s);
    }
  }
  // Union members in concord-frontend/lib/realtime/socket.ts SocketEvent
  // type — any event listed there is type-acknowledged by the frontend
  // and reachable through subscribe(). Treat union membership as a
  // first-class subscriber signal.
  const socketTs = path.join(ROOT, "concord-frontend", "lib", "realtime", "socket.ts");
  if (fs.existsSync(socketTs)) {
    const content = fs.readFileSync(socketTs, "utf8");
    const unionMatch = content.match(/export type SocketEvent\s*=([\s\S]*?);\s*\n/);
    if (unionMatch) {
      // Union members don't all carry a colon ('brawl-invited',
      // 'brawl-started' are hyphen-only) — the earlier colon-required
      // regex silently skipped those, flagging genuinely-consumed events
      // (forwarded via useSocket's FORWARDED_EVENTS loop) as dead. The
      // match is scoped to the union block, which contains only event
      // names, so accepting any quoted token here is safe.
      const re = /["']([a-z][a-zA-Z0-9:_-]+)["']/g;
      for (const s of extractMatches(unionMatch[1], re)) subs.add(s);
    }
  }
  return subs;
}

test("no NEW dead emits beyond the documented baseline", () => {
  const emits = collectEmits();
  const subs = collectSubscribes();

  assert.ok(emits.size > 0, "expected to find some realtimeEmit calls in server/ — pattern probably broken");
  assert.ok(subs.size > 0, "expected to find some subscribe() calls in concord-frontend/ — pattern probably broken");

  const newDead = [];
  for (const e of emits) {
    if (subs.has(e)) continue;
    if (SERVER_ONLY_ALLOWLIST.has(e)) continue;
    if (KNOWN_DEAD_BASELINE.has(e)) continue;
    newDead.push(e);
  }

  assert.deepStrictEqual(
    newDead.sort(),
    [],
    `${newDead.length} NEW server emit(s) have no frontend subscriber:\n` +
      newDead.sort().map((e) => `  - "${e}"`).join("\n") +
      `\n\nThe Concord pattern is: emit → subscribe pair. Pick one:\n` +
      `  (a) add a subscribe('<name>', ...) in concord-frontend/{components,lib,hooks}, OR\n` +
      `  (b) add to KNOWN_DEAD_BASELINE in this test (acknowledged debt — explain why).\n` +
      `\nDon't add to SERVER_ONLY_ALLOWLIST unless the event is genuinely server-only\n` +
      `(federation outbound, server-to-server queue, monitoring metric).`,
  );
});

test("SERVER_ONLY_ALLOWLIST entries are still actually emitted (no stale entries)", () => {
  const emits = collectEmits();
  const stale = [];
  for (const e of SERVER_ONLY_ALLOWLIST) {
    if (!emits.has(e)) stale.push(e);
  }
  assert.deepStrictEqual(
    stale.sort(),
    [],
    `${stale.length} SERVER_ONLY_ALLOWLIST entries no longer correspond to any realtimeEmit. ` +
      `Remove them so the allowlist stays a meaningful gate:\n` +
      stale.sort().map((e) => `  - "${e}"`).join("\n"),
  );
});

test("KNOWN_DEAD_BASELINE entries either still need wiring OR have been wired (cleanup invariant)", () => {
  const emits = collectEmits();
  const subs = collectSubscribes();
  const stale = [];          // baseline entries no longer emitted (delete the line)
  const wired = [];          // baseline entries that DO have a subscriber now (delete the line)
  for (const e of KNOWN_DEAD_BASELINE) {
    if (!emits.has(e)) { stale.push(e); continue; }
    if (subs.has(e)) wired.push(e);
  }
  const issues = [];
  if (stale.length) {
    issues.push(
      `${stale.length} KNOWN_DEAD_BASELINE entries no longer correspond to any emit — delete:\n` +
        stale.sort().map((e) => `  - "${e}"`).join("\n"),
    );
  }
  if (wired.length) {
    issues.push(
      `${wired.length} KNOWN_DEAD_BASELINE entries DO have a subscriber now — delete (debt cleared):\n` +
        wired.sort().map((e) => `  - "${e}"`).join("\n"),
    );
  }
  assert.strictEqual(issues.length, 0, issues.join("\n\n"));
});
