// tests/asymmetric-status-update-detector.test.js
//
// Bidirectional pins for the asymmetric-status-update detector: fires on
// the pre-fix SpikingNetworkPanel.tsx shape (a run-counter setter only
// called at the end of the success path, gating a `count === 0 ? 'idle' :
// status` ternary, so a first-attempt refusal renders as never-attempted),
// stays quiet on the real fix's shape (the setter hoisted to run
// unconditionally before every guard) and on the per-branch-duplicated
// shape, and stays quiet on the anti-noise classes found while designing
// this detector against the real tree (no gate ternary at all, a
// non-idle-worded ternary, an un-resolvable gate variable, an if/else with
// no early return, a catch-only "branch", and partial coverage).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAsymmetricStatusUpdateDetector } from "../lib/detectors/asymmetric-status-update-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "asu-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

const byId = (r, id) => r.findings.filter((f) => f.id === id);
const nonInfo = (r) => r.findings.filter((f) => f.severity !== "info");

describe("asymmetric-status-update detector — positive (the real pre-fix bug shape)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES when the run-counter setter is called only at the end of the success path", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/DemoPanel.tsx": [
        "export function DemoPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "  const [reason, setReason] = useState(null);",
        "",
        "  async function runDemo() {",
        "    setStatus('loading');",
        "    const res = await runFrontierMacro('sim', 'demo', {});",
        "    if (!res.ok || !res.result) {",
        "      setReason(res.error || 'Unknown refusal.');",
        "      setStatus('refused');",
        "      return;",
        "    }",
        "    doSomeWork(res.result);",
        "    setRunCount((n) => n + 1);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <VerifyCell status={runCount === 0 ? 'idle' : status} reason={reason} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(r.ok, true);
    const hits = byId(r, "asymmetric_status_update");
    assert.ok(hits.length >= 1, `expected a finding, got: ${JSON.stringify(nonInfo(r))}`);
    assert.equal(hits[0].severity, "medium");
    assert.equal(hits[0].evidence.setter, "setRunCount");
    assert.equal(hits[0].evidence.gateVar, "runCount");
    assert.match(hits[0].location, /DemoPanel\.tsx/);
  });

  it("FIRES with the negated-condition ternary form (!hasRun ? 'idle' : status)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/NegatedPanel.tsx": [
        "export function NegatedPanel() {",
        "  const [hasRun, setHasRun] = useState(false);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) {",
        "      setStatus('error');",
        "      return;",
        "    }",
        "    apply(res);",
        "    setHasRun(true);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <Verify status={!hasRun ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.ok(byId(r, "asymmetric_status_update").length >= 1, `expected a finding, got: ${JSON.stringify(nonInfo(r))}`);
  });
});

describe("asymmetric-status-update detector — negative (corrected / symmetric shapes)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("does NOT fire on the real fix's shape: the counter setter hoisted BEFORE the guard, dominating it", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/FixedPanel.tsx": [
        "export function FixedPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "  const [reason, setReason] = useState(null);",
        "",
        "  async function runDemo() {",
        "    setStatus('loading');",
        "    const res = await runFrontierMacro('sim', 'demo', {});",
        "    setRunCount((n) => n + 1);",
        "    if (!res.ok || !res.result) {",
        "      setReason(res.error || 'Unknown refusal.');",
        "      setStatus('refused');",
        "      return;",
        "    }",
        "    doSomeWork(res.result);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <VerifyCell status={runCount === 0 ? 'idle' : status} reason={reason} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `expected 0, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the counter setter is duplicated inside each refusal branch too", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/DuplicatedPanel.tsx": [
        "export function DuplicatedPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) {",
        "      setRunCount((n) => n + 1);",
        "      setStatus('refused');",
        "      return;",
        "    }",
        "    apply(res);",
        "    setRunCount((n) => n + 1);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `expected 0, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire on a hoisted call that dominates a guard nested one level deeper (e.g. inside a for-loop)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/LoopPanel.tsx": [
        "export function LoopPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    setStatus('loading');",
        "    const res = await callMacro();",
        "    setRunCount((n) => n + 1);",
        "    for (const frac of FRACTIONS) {",
        "      const probeRes = await probe(frac);",
        "      if (!probeRes.ok) {",
        "        setStatus('refused');",
        "        return;",
        "      }",
        "    }",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `expected 0, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("respects the // detector-allow: asymmetric-status-update opt-out annotation", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/AllowedPanel.tsx": [
        "export function AllowedPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) { setStatus('refused'); return; }",
        "    apply(res);",
        "    // detector-allow: asymmetric-status-update known limitation, tracked in TICKET-1",
        "    setRunCount((n) => n + 1);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0);
  });

  it("@asymmetric-status-update-ok-file suppresses the whole file", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/OkFilePanel.tsx": [
        "// @asymmetric-status-update-ok-file: legacy panel, tracked in TICKET-2",
        "export function OkFilePanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) { setStatus('refused'); return; }",
        "    apply(res);",
        "    setRunCount((n) => n + 1);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(nonInfo(r).length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });
});

describe("asymmetric-status-update detector — anti-noise", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("does NOT fire when there is no gate ternary at all (a plain counter with no status-gating read)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/misc/CounterOnly.tsx": [
        "export function CounterOnly() {",
        "  const [clicks, setClicks] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) { setStatus('refused'); return; }",
        "    setClicks((n) => n + 1);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <div>{clicks} clicks, status: {status}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the ternary's fallback string doesn't read as idle/never-run", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/misc/ZeroLabelPanel.tsx": [
        "export function ZeroLabelPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) { setStatus('refused'); return; }",
        "    apply(res);",
        "    setRunCount((n) => n + 1);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'zero' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the gate variable has no statically-resolvable useState setter", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/misc/PropGatePanel.tsx": [
        "export function PropGatePanel({ runCount }) {",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) { setStatus('refused'); return; }",
        "    apply(res);",
        "    setStatus('ok');",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the failure path is an if/else with no early return (real shape: MaterialsDegradationPanel.tsx)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/IfElsePanel.tsx": [
        "export function IfElsePanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    try {",
        "      const res = await callMacro();",
        "      setRunCount((n) => n + 1);",
        "      if (res.ok && res.result) {",
        "        setStatus('ok');",
        "      } else {",
        "        setStatus('refused');",
        "      }",
        "    } catch (e) {",
        "      setStatus('error');",
        "    }",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the only refusal-shaped branch is a catch block (out of scope by design)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/CatchOnlyPanel.tsx": [
        "export function CatchOnlyPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run() {",
        "    setStatus('loading');",
        "    try {",
        "      const res = await callMacro();",
        "      doWork(res);",
        "      setRunCount((n) => n + 1);",
        "      setStatus('ok');",
        "    } catch (e) {",
        "      setStatus('error');",
        "    }",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when only SOME of several refusal branches are covered (conservative partial-coverage skip)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/frontier/panels/PartialPanel.tsx": [
        "export function PartialPanel() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "",
        "  async function run(mode) {",
        "    if (mode === 'a') {",
        "      const res = await callMacroA();",
        "      setRunCount((n) => n + 1);",
        "      if (!res.ok) { setStatus('refused'); return; }",
        "      setStatus('ok');",
        "    } else {",
        "      const res = await callMacroB();",
        "      if (!res.ok) { setStatus('refused'); return; }",
        "      setRunCount((n) => n + 1);",
        "      setStatus('ok');",
        "    }",
        "  }",
        "",
        "  return <Verify status={runCount === 0 ? 'idle' : status} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(byId(r, "asymmetric_status_update").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("never throws — returns ok:true and 0 real findings on an empty tree", async () => {
    dir = await tmpRepo({ "README.md": "no code here" });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(nonInfo(r).length, 0);
  });

  it("returns ok:false (not a throw) when no root is provided", async () => {
    const r = await runAsymmetricStatusUpdateDetector({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_root");
  });

  it("does NOT scan files outside app/lenses and components", async () => {
    dir = await tmpRepo({
      "concord-frontend/lib/some-lib.tsx": [
        "export function helper() {",
        "  const [runCount, setRunCount] = useState(0);",
        "  const [status, setStatus] = useState('idle');",
        "  async function run() {",
        "    const res = await callMacro();",
        "    if (!res.ok) { setStatus('refused'); return; }",
        "    setRunCount((n) => n + 1);",
        "    setStatus('ok');",
        "  }",
        "  return runCount === 0 ? 'idle' : status;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runAsymmetricStatusUpdateDetector({ root: dir });
    assert.equal(r.summary.total, 1, "only the summary finding, nothing scanned");
  });
});
