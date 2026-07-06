// tests/duplicate-handler-race-detector.test.js
//
// Proves the duplicate-handler-race detector fires on the two REAL bug
// shapes it was seeded from:
//   - c74b60d6 — ConcordiaScene.tsx's anonymous `addEventListener('contextmenu',
//     (e) => e.preventDefault())` could never be removed (no outer reference),
//     so every effect re-run stacked another permanent listener.
//   - eecb0bec — CommandPalette.tsx and AppShell.tsx each independently
//     registered a global keydown listener checking
//     `(e.metaKey || e.ctrlKey) && e.key === 'k'` and raced toggling the same
//     shared store.
// ...and does NOT fire on a properly cleaned-up effect (named handler +
// matching removeEventListener), nor on an empty tree.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runDuplicateHandlerRaceDetector,
  isBareReference,
  splitTopLevelArgs,
  extractEffectBodies,
} from "../lib/detectors/duplicate-handler-race-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dup-handler-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}
const real = (r) => r.findings.filter((f) => f.severity !== "info");
const byId = (r, id) => r.findings.filter((f) => f.id === id);

describe("duplicate-handler-race detector — pure helpers", () => {
  it("isBareReference: identifiers/member-exprs are references, inline fns/binds are not", () => {
    assert.equal(isBareReference("handler"), true);
    assert.equal(isBareReference("onKey"), true);
    assert.equal(isBareReference("this.onKey"), true);
    assert.equal(isBareReference("ref.current"), true);
    assert.equal(isBareReference("handlersRef.current.onKey"), true);
    assert.equal(isBareReference("(e) => e.preventDefault()"), false);
    assert.equal(isBareReference("function(e) { return e; }"), false);
    assert.equal(isBareReference("this.onKey.bind(this)"), false);
  });

  it("splitTopLevelArgs respects nesting and strings", () => {
    assert.deepEqual(splitTopLevelArgs(`'keydown', onKey, { once: true, meta: {a:1} }`), [
      "'keydown'",
      "onKey",
      "{ once: true, meta: {a:1} }",
    ]);
    assert.deepEqual(splitTopLevelArgs(`'a,b', fn(1, 2)`), ["'a,b'", "fn(1, 2)"]);
  });

  it("extractEffectBodies finds the balanced body of a useEffect callback", () => {
    const src = `useEffect(() => { const x = { a: 1 }; doThing(x); }, [dep]);`;
    const bodies = extractEffectBodies(src);
    assert.equal(bodies.length, 1);
    const bodyText = src.slice(bodies[0].start, bodies[0].end + 1);
    assert.match(bodyText, /doThing\(x\)/);
  });
});

describe("duplicate-handler-race detector — anonymous listener leak (c74b60d6 shape)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (medium) on an anonymous addEventListener with no matching cleanup, inside a useEffect", async () => {
    // Synthesized from the real before-fix ConcordiaScene.tsx shape: a named
    // handler that IS cleaned up correctly, plus a second, anonymous
    // contextmenu listener that has no way to ever be removed.
    dir = await tmpRepo({
      "concord-frontend/components/world-lens/ConcordiaScene.tsx": [
        `import { useEffect } from 'react';`,
        ``,
        `export default function ConcordiaScene({ canvasRef }) {`,
        `  useEffect(() => {`,
        `    const canvas = canvasRef.current;`,
        `    if (!canvas) return;`,
        ``,
        `    function handleContextMenu(e) {`,
        `      e.preventDefault();`,
        `    }`,
        `    canvas.addEventListener('contextmenu', handleContextMenu);`,
        ``,
        `    canvas.addEventListener('contextmenu', (e) => e.preventDefault());`,
        ``,
        `    return () => {`,
        `      canvas.removeEventListener('contextmenu', handleContextMenu);`,
        `    };`,
        `  }, [canvasRef]);`,
        ``,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(r.ok, true);
    const leaks = byId(r, "anonymous_listener_leak");
    assert.equal(leaks.length, 1, `expected exactly 1 anonymous-listener finding, got: ${JSON.stringify(leaks)}`);
    assert.match(leaks[0].location, /ConcordiaScene\.tsx:13/);
    assert.equal(leaks[0].severity, "medium");
    assert.equal(leaks[0].evidence.eventName, "contextmenu");
  });

  it("does NOT flag a { once: true } inline listener", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/world/Gesture.tsx": [
        `import { useEffect } from 'react';`,
        `export function Gesture() {`,
        `  useEffect(() => {`,
        `    window.addEventListener('pointerdown', () => resume(), { once: true });`,
        `  }, []);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "anonymous_listener_leak").length, 0);
  });

  it("respects the `detector-allow: duplicate-handler` opt-out annotation", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/world/Annotated.tsx": [
        `import { useEffect } from 'react';`,
        `export function Annotated({ canvasRef }) {`,
        `  useEffect(() => {`,
        `    const canvas = canvasRef.current;`,
        `    // detector-allow: duplicate-handler intentionally fire-and-forget, no dependency cycle risk`,
        `    canvas.addEventListener('contextmenu', (e) => e.preventDefault());`,
        `  }, [canvasRef]);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "anonymous_listener_leak").length, 0);
  });

  it("does NOT flag a named handler passed through a TS `as EventListener` cast", async () => {
    // Regression pin: a live spot-check found this exact shape (named
    // useCallback handler + `as EventListener` type assertion) all over
    // concord-frontend/components/world/*.tsx (BuildingWearLayer,
    // BuildingCollapseVFX, CombatVFXBridge, EmbodiedParticlesBridge, ...) —
    // it's a real, removable reference; the `as EventListener` cast must not
    // make the detector think it's an inline anonymous function.
    dir = await tmpRepo({
      "concord-frontend/components/world/BuildingWearLayer.tsx": [
        `import { useEffect, useCallback } from 'react';`,
        `export function BuildingWearLayer({ worldId }) {`,
        `  const handle = useCallback((e) => { applyWearEvent(e); }, [worldId]);`,
        `  useEffect(() => {`,
        `    window.addEventListener('concordia:building-state', handle as EventListener);`,
        `    return () => window.removeEventListener('concordia:building-state', handle as EventListener);`,
        `  }, [handle]);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "anonymous_listener_leak").length, 0);
  });

  it("respects the `@resource-leak-ok` annotation (sibling detector's opt-out) for a worker listener", async () => {
    dir = await tmpRepo({
      "concord-frontend/hooks/useAvatarAnimator.ts": [
        `import { useEffect } from 'react';`,
        `export function useAvatarAnimator() {`,
        `  useEffect(() => {`,
        `    const worker = new Worker('./animator.worker.js');`,
        `    worker.addEventListener('message', (ev) => { // @resource-leak-ok — worker.terminate() below tears the listener down with it`,
        `      handleMessage(ev);`,
        `    });`,
        `    return () => worker.terminate();`,
        `  }, []);`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "anonymous_listener_leak").length, 0);
  });
});

describe("duplicate-handler-race detector — cross-file key-handler race (eecb0bec shape)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (high) when two files each bind a global keydown listener checking the same Mod+K", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/common/CommandPalette.tsx": [
        `import { useEffect, useState } from 'react';`,
        `export function CommandPalette() {`,
        `  const [isOpen, setOpen] = useState(false);`,
        `  useEffect(() => {`,
        `    const handleGlobalKeyDown = (e) => {`,
        `      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {`,
        `        e.preventDefault();`,
        `        setOpen(!isOpen);`,
        `      }`,
        `    };`,
        `    document.addEventListener('keydown', handleGlobalKeyDown);`,
        `    return () => document.removeEventListener('keydown', handleGlobalKeyDown);`,
        `  }, [isOpen]);`,
        `  return null;`,
        `}`,
      ].join("\n"),
      "concord-frontend/components/shell/AppShell.tsx": [
        `import { useEffect, useState } from 'react';`,
        `export function AppShell() {`,
        `  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);`,
        `  useEffect(() => {`,
        `    const handleKeyDown = (e) => {`,
        `      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {`,
        `        e.preventDefault();`,
        `        setCommandPaletteOpen(!commandPaletteOpen);`,
        `      }`,
        `    };`,
        `    document.addEventListener('keydown', handleKeyDown);`,
        `    return () => document.removeEventListener('keydown', handleKeyDown);`,
        `  }, [commandPaletteOpen]);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(r.ok, true);
    const races = byId(r, "duplicate_key_handler_race");
    assert.equal(races.length, 1, `expected exactly 1 duplicate-key-race group, got: ${JSON.stringify(races)}`);
    const f = races[0];
    assert.equal(f.severity, "high");
    assert.equal(f.evidence.eventName, "keydown");
    assert.equal(f.evidence.keyLiteral, "k");
    assert.equal(f.evidence.modifiers, "ctrlKey+metaKey");
    assert.equal(f.evidence.locations.length, 2);
    assert.ok(f.evidence.locations.some((l) => l.includes("CommandPalette.tsx")));
    assert.ok(f.evidence.locations.some((l) => l.includes("AppShell.tsx")));
  });

  it("does NOT pair two files that check the same key with DIFFERENT modifiers", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/a/Alpha.tsx": [
        `import { useEffect } from 'react';`,
        `export function Alpha() {`,
        `  useEffect(() => {`,
        `    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { doA(); } };`,
        `    document.addEventListener('keydown', onKey);`,
        `    return () => document.removeEventListener('keydown', onKey);`,
        `  }, []);`,
        `  return null;`,
        `}`,
      ].join("\n"),
      "concord-frontend/components/b/Beta.tsx": [
        `import { useEffect } from 'react';`,
        `export function Beta() {`,
        `  useEffect(() => {`,
        `    const onKey = (e) => { if (e.key === 'k' && !e.metaKey && !e.ctrlKey) { doB(); } };`,
        `    window.addEventListener('keydown', onKey);`,
        `    return () => window.removeEventListener('keydown', onKey);`,
        `  }, []);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "duplicate_key_handler_race").length, 0);
  });

  it("does NOT pair two files that check the same key with NO modifier at all (bare Escape idiom)", async () => {
    // Regression pin: a live spot-check against the real tree found a bare
    // `e.key === 'Escape'`-with-no-modifier "close this modal" idiom
    // independently repeated across 10+ unrelated components — that's normal,
    // not a race, and must not be flagged. Only modifier-gated global
    // shortcuts (Mod+K, Mod+Shift+F, ...) are in scope for this rule.
    dir = await tmpRepo({
      "concord-frontend/components/a/ModalOne.tsx": [
        `import { useEffect } from 'react';`,
        `export function ModalOne() {`,
        `  useEffect(() => {`,
        `    const onKey = (e) => { if (e.key === 'Escape') { closeOne(); } };`,
        `    document.addEventListener('keydown', onKey);`,
        `    return () => document.removeEventListener('keydown', onKey);`,
        `  }, []);`,
        `  return null;`,
        `}`,
      ].join("\n"),
      "concord-frontend/components/b/ModalTwo.tsx": [
        `import { useEffect } from 'react';`,
        `export function ModalTwo() {`,
        `  useEffect(() => {`,
        `    const onKey = (e) => { if (e.key === 'Escape') { closeTwo(); } };`,
        `    window.addEventListener('keydown', onKey);`,
        `    return () => window.removeEventListener('keydown', onKey);`,
        `  }, []);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "duplicate_key_handler_race").length, 0);
  });

  it("does NOT fire on a single file registering the shortcut (no second owner)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/common/OnlyOwner.tsx": [
        `import { useEffect } from 'react';`,
        `export function OnlyOwner() {`,
        `  useEffect(() => {`,
        `    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { toggle(); } };`,
        `    document.addEventListener('keydown', onKey);`,
        `    return () => document.removeEventListener('keydown', onKey);`,
        `  }, []);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "duplicate_key_handler_race").length, 0);
  });
});

describe("duplicate-handler-race detector — negative + empty-tree cases", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("does NOT flag a properly cleaned-up effect (named handler + matching removeEventListener)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/world/Clean.tsx": [
        `import { useEffect } from 'react';`,
        `export function Clean() {`,
        `  useEffect(() => {`,
        `    function onResize() {`,
        `      console.log('resized');`,
        `    }`,
        `    window.addEventListener('resize', onResize);`,
        `    return () => window.removeEventListener('resize', onResize);`,
        `  }, []);`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(real(r).length, 0, `expected 0 real findings, got: ${JSON.stringify(real(r))}`);
  });

  it("returns ok:true with 0 findings on an empty/clean tree", async () => {
    dir = await tmpRepo({ "README.md": "nothing to see here" });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(real(r).length, 0);
  });

  it("never throws when concord-frontend/ or server/ don't exist", async () => {
    dir = await tmpRepo({ "x.txt": "no code" });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(r.ok, true);
  });
});

describe("duplicate-handler-race detector — server-side duplicate socket.on / route registration", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (high) on a duplicate socket.on('event', ...) within one file", async () => {
    dir = await tmpRepo({
      "server/server.js": [
        `io.on('connection', (socket) => {`,
        `  socket.on('room:join', ({ room }) => { joinRoom(room); });`,
        `  socket.on('ping', () => { socket.emit('pong'); });`,
        `  socket.on('room:join', ({ room }) => { joinRoomAgain(room); });`,
        `});`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    const dupes = byId(r, "duplicate_socket_handler");
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].severity, "high");
    assert.equal(dupes[0].evidence.event, "room:join");
  });

  it("FIRES (high) on a duplicate app.get('/same/path', ...) within one file", async () => {
    dir = await tmpRepo({
      "server/server.js": [
        `app.get("/api/status", (req, res) => { res.json({ ok: true }); });`,
        `app.get("/api/other", (req, res) => { res.json({ ok: true }); });`,
        `app.get("/api/status", (req, res) => { res.json({ ok: false }); });`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    const dupes = byId(r, "duplicate_route_registration");
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].evidence.path, "/api/status");
    assert.equal(dupes[0].evidence.method, "GET");
  });

  it("does NOT flag distinct socket events or distinct routes", async () => {
    dir = await tmpRepo({
      "server/server.js": [
        `socket.on('a', () => {});`,
        `socket.on('b', () => {});`,
        `app.get("/api/a", (req, res) => { res.end(); });`,
        `app.post("/api/a", (req, res) => { res.end(); });`,
      ].join("\n"),
    });
    const r = await runDuplicateHandlerRaceDetector({ root: dir });
    assert.equal(byId(r, "duplicate_socket_handler").length, 0);
    assert.equal(byId(r, "duplicate_route_registration").length, 0);
  });
});
