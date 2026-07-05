// tests/fabrication-mechanism-detector.test.js
//
// Proves the fabrication-mechanism detector fires on MECHANISM-based
// fabrication (Math.random() feeding a metric-shaped field that reaches a
// user or an API) that fake-data-detector.js structurally cannot see
// because it only looks for incriminating NAMES (fake/mock/stub). It also
// proves the detector stays quiet on the legitimate randomness this
// codebase is full of: allowlisted game/sim mechanics, and ID/timing
// generation.
//
// The positive fixture below reproduces the shape of the real
// MixerPeekStrip.tsx bug fixed in commit c74b60d6 (a `fakeLevel()` helper
// whose name is metric-shaped, feeding a JSX-rendered VU meter with no
// disclosure) — adapted to use Math.random() directly (the real file used
// a deterministic Math.sin jitter specifically so it would NOT trip a
// Math.random scanner; this detector's contract is Math.random-based per
// its spec, so the fixture inlines Math.random() into the same
// fakeLevel/level/JSX-render shape to exercise the intended mechanism).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runFabricationMechanismDetector,
  findFabricationTarget,
  jsxRenderEvidence,
  apiSendEvidence,
  argHasRealComputation,
  findFakeProgressSetter,
} from "../lib/detectors/fabrication-mechanism-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fabmech-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}
const realFindings = (r) => r.findings.filter((f) => f.severity !== "info");

describe("fabrication-mechanism detector — pure helpers", () => {
  it("findFabricationTarget: direct Math.random() -> metric-named target", () => {
    const win = [
      "function fakeLevel(volume) {",
      "  return Math.min(1, volume * (0.7 + Math.random() * 0.15));",
      "}",
    ].join("\n");
    const found = findFabricationTarget(win);
    assert.ok(found, "expected a fabrication target");
    assert.equal(found.target, "fakeLevel");
    assert.equal(found.word, "level");
  });

  it("findFabricationTarget: one-hop through an intermediate variable", () => {
    const win = [
      "const wobble = Math.random() * 5;",
      "const uptimePercent = 95 + wobble;",
    ].join("\n");
    const found = findFabricationTarget(win);
    assert.ok(found);
    assert.equal(found.target, "uptimePercent");
  });

  it("findFabricationTarget: no metric word nearby -> null", () => {
    const win = "const spinAngle = Math.random() * 360;";
    assert.equal(findFabricationTarget(win), null);
  });

  it("jsxRenderEvidence matches a prop binding and a text interpolation", () => {
    assert.equal(jsxRenderEvidence("<Meter level={level} />", "level"), true);
    assert.equal(jsxRenderEvidence("<span>{progress}%</span>", "progress"), true);
    assert.equal(jsxRenderEvidence("<span>no match here</span>", "level"), false);
  });

  it("apiSendEvidence recognizes fetch/api/mint/runMacro sinks", () => {
    assert.equal(apiSendEvidence("await fetch('/x', {method:'POST'})"), true);
    assert.equal(apiSendEvidence("api.post('/api/lens/run', body)"), true);
    assert.equal(apiSendEvidence("runMacro('dtu','create', input)"), true);
    assert.equal(apiSendEvidence("console.log('nothing here')"), false);
  });

  it("argHasRealComputation: false for prev+const, true when other identifiers appear", () => {
    assert.equal(argHasRealComputation("Math.min(99, prev + 7)", new Set(["prev"])), false);
    assert.equal(argHasRealComputation("prev + (bytesLoaded / total) * 100", new Set(["prev"])), true);
  });

  it("findFakeProgressSetter flags a progress setter with no real backing computation", () => {
    const body = "() => { setProgress((prev) => Math.min(99, prev + 7)); }, 300";
    const found = findFakeProgressSetter(body);
    assert.ok(found);
    assert.equal(found.stateName, "Progress");
  });

  it("findFakeProgressSetter does NOT flag a setter driven by real data", () => {
    const body = "() => { setUploadPercent((prev) => Math.min(100, (bytesLoaded / totalBytes) * 100)); }, 300";
    assert.equal(findFakeProgressSetter(body), null);
  });
});

describe("fabrication-mechanism detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES on the MixerPeekStrip fakeLevel shape: Math.random() -> metric name -> JSX render", async () => {
    dir = await tmpRepo({
      "components/studio/MixerPeekStrip.tsx": [
        "'use client';",
        "import { useState } from 'react';",
        "",
        "function fakeLevel(volume) {",
        "  // Fabricated VU meter level — no real audio-analyser input.",
        "  return Math.min(1, volume * (0.7 + Math.random() * 0.15));",
        "}",
        "",
        "export default function MixerPeekStrip({ tracks }) {",
        "  return (",
        "    <div>",
        "      {tracks.map((t) => {",
        "        const level = t.mute ? 0 : fakeLevel(t.volume);",
        "        return <Meter key={t.id} level={level} />;",
        "      })}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFabricationMechanismDetector({ root: dir });
    assert.equal(r.ok, true);
    const hits = realFindings(r).filter((f) => f.id === "fabrication_random_metric");
    assert.ok(hits.length >= 1, `expected a fabrication_random_metric finding, got: ${JSON.stringify(realFindings(r))}`);
    assert.equal(hits[0].severity, "high");
    assert.match(hits[0].location, /MixerPeekStrip\.tsx/);
    assert.equal(hits[0].evidence.rendered, true);
  });

  it("FIRES on the setInterval fake-progress-bar antipattern", async () => {
    dir = await tmpRepo({
      "components/upload/FakeUploadProgress.tsx": [
        "'use client';",
        "import { useState, useEffect } from 'react';",
        "",
        "export function FakeUploadProgress() {",
        "  const [progress, setProgress] = useState(0);",
        "  useEffect(() => {",
        "    const timer = setInterval(() => {",
        "      setProgress((prev) => Math.min(99, prev + 7));",
        "    }, 300);",
        "    return () => clearInterval(timer);",
        "  }, []);",
        "  return <div className=\"bar\" style={{ width: `${progress}%` }}>{progress}%</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFabricationMechanismDetector({ root: dir });
    const hits = realFindings(r).filter((f) => f.id === "fabrication_fake_progress_interval");
    assert.ok(hits.length >= 1, `expected a fabrication_fake_progress_interval finding, got: ${JSON.stringify(realFindings(r))}`);
    assert.equal(hits[0].severity, "high");
    assert.match(hits[0].location, /FakeUploadProgress\.tsx/);
  });

  it("does NOT flag Math.random() in an allowlisted game/sim path, even with a metric-shaped name", async () => {
    dir = await tmpRepo({
      "server/emergent/foo-spawn-cycle.js": [
        "export function runFooSpawnCycle(STATE) {",
        "  // Deliberately metric-shaped name — must NOT fire: this is a game-mechanic",
        "  // spawn-timing roll in an allowlisted emergent module, not fabricated telemetry.",
        "  const spawnPowerLevel = Math.random() * 100;",
        "  STATE.nextSpawnPower = spawnPowerLevel;",
        "  return spawnPowerLevel;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFabricationMechanismDetector({ root: dir });
    assert.equal(realFindings(r).length, 0, `expected 0 findings in allowlisted path, got: ${JSON.stringify(realFindings(r))}`);
  });

  it("does NOT flag Math.random() used for id/uuid generation even when a metric word is nearby", async () => {
    dir = await tmpRepo({
      "concord-frontend/lib/session-helper.ts": [
        "export function generateSessionId() {",
        "  // 'randomLevel' is just an entropy source name here, not a real metric —",
        "  // the id/uuid context near Math.random() must suppress this.",
        "  const randomLevel = Math.random();",
        "  const id = 'session-' + Math.floor(randomLevel * 1e9).toString(36);",
        "  return id;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFabricationMechanismDetector({ root: dir });
    assert.equal(realFindings(r).length, 0, `expected 0 findings for id/uuid-context Math.random(), got: ${JSON.stringify(realFindings(r))}`);
  });

  it("respects the // detector-allow: fabrication opt-out annotation", async () => {
    dir = await tmpRepo({
      "components/studio/AnnotatedMeter.tsx": [
        "function fakeLevel(volume) {",
        "  // detector-allow: fabrication intentional decorative jitter, disclosed in the UI",
        "  return Math.min(1, volume * (0.7 + Math.random() * 0.15));",
        "}",
        "export default function Meter({ volume }) {",
        "  const level = fakeLevel(volume);",
        "  return <div level={level} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFabricationMechanismDetector({ root: dir });
    assert.equal(realFindings(r).length, 0, "annotation should suppress the finding");
  });

  it("never throws — returns ok:true and 0 real findings on an empty tree", async () => {
    dir = await tmpRepo({ "x.txt": "no code here" });
    const r = await runFabricationMechanismDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(realFindings(r).length, 0);
  });
});
