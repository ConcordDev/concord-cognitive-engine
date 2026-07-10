// tests/frontend-fake-data-detector.test.js
//
// Proves the frontend fake-data detector fires on the task-brief's worked
// example — a hardcoded `episodes = [{ title: 'Sample Episode', ... }]`
// array rendered via `.map()` with no data-fetching hook anywhere in its
// component — and stays quiet on the real `useLensData`-backed render it's
// modeled after. Also covers the Math.random()-in-JSX and placeholder-string
// rules, and the false-positive classes found and fixed while tuning this
// detector against the real tree (Tailwind `placeholder:`/`placeholder-`
// utility classes, TABS/nav-config arrays, arrow-function bodies that also
// end in `>` like JSX tags, `const x = {...}` declarations that also start
// with `=` like JSX attributes, id/uuid generation, random-pick-from-a-real-
// array idioms).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFrontendFakeDataDetector } from "../lib/detectors/frontend-fake-data-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffd-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

const byId = (r, id) => r.findings.filter((f) => f.id === id);
const nonInfo = (r) => r.findings.filter((f) => f.severity !== "info");

describe("frontend-fake-data detector — hardcoded array rendered as live data", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (high) on the task-brief's exact shape: episodes = [{ title: 'Sample Episode' }] rendered via .map() with no fetch hook", async () => {
    dir = await tmpRepo({
      "concord-frontend/app/lenses/podcast/page.tsx": [
        "'use client';",
        "export default function PodcastPage() {",
        "  const episodes = [",
        "    { title: 'Sample Episode', description: 'Sample text about the show', date: '2025-01-01' },",
        "    { title: 'Sample Episode 2', description: 'More sample text', date: '2025-01-08' },",
        "  ];",
        "  return (",
        "    <div>",
        "      {episodes.map((e) => (",
        "        <div key={e.title}>{e.title}</div>",
        "      ))}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(r.ok, true);
    const hits = byId(r, "hardcoded_array_rendered_as_live_data");
    assert.ok(hits.length >= 1, `expected a finding, got: ${JSON.stringify(nonInfo(r))}`);
    assert.equal(hits[0].severity, "high", "placeholder term ('Sample Episode') present -> high");
    assert.match(hits[0].location, /podcast\/page\.tsx/);
    assert.equal(hits[0].evidence.identifier, "episodes");
  });

  it("does NOT fire on the real useLensData-backed render of the same shape", async () => {
    dir = await tmpRepo({
      "concord-frontend/app/lenses/podcast/page.tsx": [
        "'use client';",
        "import { useLensData } from '@/lib/hooks/use-lens-data';",
        "export default function PodcastPage() {",
        "  const { data: episodes } = useLensData('podcast', 'list_episodes');",
        "  return (",
        "    <div>",
        "      {(episodes || []).map((e) => (",
        "        <div key={e.title}>{e.title}</div>",
        "      ))}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0, `expected 0 findings, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire on lensRun-backed data in the same component", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/podcast/EpisodeList.tsx": [
        "import { lensRun } from '@/lib/lens-client';",
        "export function EpisodeList() {",
        "  const [episodes, setEpisodes] = useState([]);",
        "  useEffect(() => { lensRun('podcast', 'list_episodes').then((r) => setEpisodes(r.episodes)); }, []);",
        "  return <div>{episodes.map((e) => <div key={e.id}>{e.title}</div>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0);
  });

  it("does NOT fire on a UI-config TABS array (structural fields only: id/label/icon)", async () => {
    dir = await tmpRepo({
      "concord-frontend/app/lenses/agriculture/page.tsx": [
        "export function DeereWorkbenchSection() {",
        "  const TABS = [",
        "    { id: 'map', label: 'Farm map' },",
        "    { id: 'equipment', label: 'Equipment' },",
        "    { id: 'zones', label: 'Zones' },",
        "  ];",
        "  return <div>{TABS.map((t) => <button key={t.id}>{t.label}</button>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0, `TABS should be skipped, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("respects the // detector-allow: frontend-fake-data opt-out annotation", async () => {
    dir = await tmpRepo({
      "concord-frontend/app/lenses/podcast/page.tsx": [
        "export default function PodcastPage() {",
        "  // detector-allow: frontend-fake-data intentional static seed content, tracked in TICKET-123",
        "  const episodes = [",
        "    { title: 'Sample Episode', description: 'Sample text' },",
        "    { title: 'Sample Episode 2', description: 'Sample text' },",
        "  ];",
        "  return <div>{episodes.map((e) => <span key={e.title}>{e.title}</span>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0);
  });
});

describe("frontend-fake-data detector — Math.random() in render", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES on Math.random() used directly as JSX child text", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/status/StatusBadge.tsx": [
        "export function StatusBadge() {",
        "  return <span>{Math.random() > 0.5 ? 'Online' : 'Offline'}</span>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    const hits = byId(r, "math_random_in_render");
    assert.ok(hits.length >= 1, `expected a finding, got: ${JSON.stringify(nonInfo(r))}`);
    assert.equal(hits[0].severity, "medium");
  });

  it("FIRES on Math.random() used directly as a JSX attribute value", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/status/MeterBar.tsx": [
        "export function MeterBar() {",
        "  return <div style={{ width: `${Math.random() * 100}%` }} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.ok(byId(r, "math_random_in_render").length >= 1, `expected a finding, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire on Math.random() used for id generation", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/util/IdHelper.tsx": [
        "function generateUUID() {",
        "  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {",
        "    const r = (Math.random() * 16) | 0;",
        "    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);",
        "  });",
        "}",
        "export function IdHelper() {",
        "  const id = generateUUID();",
        "  return <div data-id={id} />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "math_random_in_render").length, 0, `expected 0, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire on Math.random() inside a plain arrow-function body (not JSX)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/util/RandomPicker.tsx": [
        "export function RandomPicker({ onPick }) {",
        "  const handlePick = () => {",
        "    const options = ['a', 'b', 'c'];",
        "    const pick = options[Math.floor(Math.random() * options.length)];",
        "    onPick(pick);",
        "  };",
        "  return <button onClick={handlePick}>Pick</button>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "math_random_in_render").length, 0, `expected 0 (arrow-fn body + array-pick idiom), got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire on Math.random() inside a plain `const x = {...}` object-literal assignment", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/util/BuildPayload.tsx": [
        "export function BuildPayload() {",
        "  const seedValue = 0.5;",
        "  const payload = {",
        "    weight: Math.random() * seedValue,",
        "  };",
        "  console.log(payload);",
        "  return <div>ready</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "math_random_in_render").length, 0, `expected 0 (const decl, not JSX attr), got: ${JSON.stringify(nonInfo(r))}`);
  });
});

describe("frontend-fake-data detector — placeholder/lorem content", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (medium) on 'lorem ipsum' rendered as JSX attribute string content", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/blog/PostCard.tsx": [
        "export function PostCard() {",
        "  return <p title=\"Lorem ipsum dolor sit amet, real-looking body copy\">Post</p>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    const hits = byId(r, "placeholder_content_strong");
    assert.ok(hits.length >= 1, `expected a finding, got: ${JSON.stringify(nonInfo(r))}`);
    assert.equal(hits[0].severity, "medium");
  });

  it("does NOT fire on the legitimate `placeholder=\"...\"` input-hint attribute", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/search/SearchBar.tsx": [
        "export function SearchBar() {",
        "  return <input placeholder=\"Search accounts, transactions, or people...\" />;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(nonInfo(r).filter((f) => f.category === "frontend-fake-data").length, 0, `expected 0, got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire on Tailwind `placeholder-*` / `placeholder:` utility classes in className", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/search/SearchBar2.tsx": [
        "export function SearchBar2() {",
        "  return (",
        "    <input",
        "      placeholder=\"Search\"",
        "      className=\"w-full text-sm placeholder-gray-500 placeholder:text-gray-400 focus:outline-none\"",
        "    />",
        "  );",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    const relevant = r.findings.filter((f) => f.category === "frontend-fake-data" && f.id.startsWith("placeholder_content"));
    assert.equal(relevant.length, 0, `expected 0 Tailwind-class false positives, got: ${JSON.stringify(relevant)}`);
  });

  it("respects the // detector-allow: frontend-fake-data opt-out annotation", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/blog/PostCard2.tsx": [
        "export function PostCard2() {",
        "  // detector-allow: frontend-fake-data intentional style-guide sample copy",
        "  return <p>Lorem ipsum dolor sit amet</p>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "placeholder_content_strong").length, 0);
  });

  it("@frontend-fake-data-ok-file suppresses the whole file", async () => {
    dir = await tmpRepo({
      "concord-frontend/app/lenses/styleguide/page.tsx": [
        "// @frontend-fake-data-ok-file: style-guide showcase page, intentionally sample content",
        "export default function StyleGuidePage() {",
        "  const episodes = [",
        "    { title: 'Sample Episode', description: 'Sample text' },",
        "    { title: 'Sample Episode 2', description: 'Sample text' },",
        "  ];",
        "  return <div>{episodes.map((e) => <p key={e.title}>Lorem ipsum {e.title}</p>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(nonInfo(r).length, 0, `file-level opt-out should suppress everything, got: ${JSON.stringify(nonInfo(r))}`);
  });
});

describe("frontend-fake-data detector — scope + safety", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("does NOT scan files outside app/lenses and components", async () => {
    dir = await tmpRepo({
      "concord-frontend/lib/some-lib.tsx": [
        "export function helper() {",
        "  const episodes = [",
        "    { title: 'Sample Episode', description: 'Sample text' },",
        "    { title: 'Sample Episode 2', description: 'Sample text' },",
        "  ];",
        "  return <div>{episodes.map((e) => <p key={e.title}>{e.title}</p>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(r.summary.total, 1, "only the summary finding, nothing scanned"); // scanned:0
  });

  it("never throws — returns ok:true and 0 real findings on an empty tree", async () => {
    dir = await tmpRepo({ "README.md": "no code here" });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(nonInfo(r).length, 0);
  });

  it("returns ok:false (not a throw) when no root is provided", async () => {
    const r = await runFrontendFakeDataDetector({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_root");
  });
});
