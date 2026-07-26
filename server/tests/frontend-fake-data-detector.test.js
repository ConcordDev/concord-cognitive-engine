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

// ── 2026-07 precision pass ────────────────────────────────────────────────
// A full manual classification of every finding this detector produced
// against the real repo found 35 medium findings, 34 of them false
// positives, 1 true positive (DTUDiffViewer's fabricated VERSIONS). These
// fixtures are extracted/adapted from the real false positives (config/nav
// arrays, external-spread arrays, a call-argument shorthand property, a
// negated disclaimer, and an identity-key label) plus the one real true
// positive, so this pass is pinned bidirectionally: still catches the real
// shape, no longer fires on any of the real false-positive shapes.
describe("frontend-fake-data detector — 2026-07 precision pass", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("STILL FIRES on the DTUDiffViewer true-positive shape (fabricated version history: author/date + measurements, no fetch hook)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/world-lens/DTUDiffViewer.tsx": [
        "'use client';",
        "const VERSIONS = [",
        "  {",
        "    id: 'dtu-3204-v1.0',",
        "    version: 'v1.0',",
        "    name: 'USB-A Beam 6m',",
        "    material: 'USB-A',",
        "    seismicRating: 6.2,",
        "    windRating: '120mph',",
        "    weight: '142kg',",
        "    author: 'eng.martinez',",
        "    date: '2025-08-14',",
        "    validations: { gravity: '2.3 SF', wind: '120mph', seismic: '6.2', thermal: 'pass', fire: '2.0hr' },",
        "  },",
        "  {",
        "    id: 'dtu-3204-v1.1',",
        "    version: 'v1.1',",
        "    name: 'USB-A Beam 6m (Draft)',",
        "    material: 'USB-A',",
        "    seismicRating: 6.4,",
        "    windRating: '125mph',",
        "    weight: '146kg',",
        "    author: 'eng.martinez',",
        "    date: '2025-10-02',",
        "    validations: { gravity: '2.35 SF', wind: '125mph', seismic: '6.4', thermal: 'pass', fire: '2.0hr' },",
        "  },",
        "];",
        "export function DTUDiffViewer() {",
        "  return <div>{VERSIONS.map((v, i) => <span key={v.id}>{v.name}</span>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    const hits = byId(r, "hardcoded_array_rendered_as_live_data");
    assert.ok(hits.length >= 1, `expected the true positive to still fire, got: ${JSON.stringify(nonInfo(r))}`);
    assert.equal(hits[0].evidence.identifier, "VERSIONS");
    assert.equal(hits[0].evidence.hasContentKey, true, "author/date are still content-shaped signals");
  });

  it("does NOT fire on a DESTINATIONS nav array using desc/description (real FP: grounding/parenting/supplychain page.tsx)", async () => {
    dir = await tmpRepo({
      "concord-frontend/app/lenses/grounding/page.tsx": [
        "const DESTINATIONS = [",
        "  { id: 'factcheck', label: 'Fact-Check Workbench', icon: ShieldCheck, desc: 'Evidence aggregation' },",
        "  { id: 'sensors', label: 'Reality Anchor', icon: Antenna, desc: 'Sensors and readings' },",
        "  { id: 'pulse', label: 'Real-World Pulse', icon: Radio, description: 'Live chatter' },",
        "];",
        "export default function GroundingLensPage() {",
        "  return <div>{DESTINATIONS.map((d) => <button key={d.id}>{d.label}</button>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire on a country/locale lookup table keyed by code+name (real FP: CountryPicker/LanguageSelector)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/global/CountryPicker.tsx": [
        "export const COUNTRIES = [",
        "  { code: 'USA', name: 'United States' }, { code: 'CHN', name: 'China' },",
        "  { code: 'IND', name: 'India' }, { code: 'BRA', name: 'Brazil' },",
        "];",
        "export function CountryPicker() {",
        "  return <select>{COUNTRIES.map((c) => <option key={c.code}>{c.name}</option>)}</select>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the array spreads an already-fetched/mapped external source (real FP: VehicleHistory.tsx's events)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/automotive/VehicleHistory.tsx": [
        "export function VehicleHistory({ recalls, schedule, odometer }) {",
        "  const events = [",
        "    ...recalls.map((r) => ({ kind: 'recall', date: r.recallDate, recall: r })),",
        "    ...(schedule?.services || []).filter((i) => i.status !== 'ok').map((i) => ({ kind: 'maintenance', item: i })),",
        "  ];",
        "  return <div>{events.map((e, i) => <span key={i}>{e.kind}</span>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the array spreads a live prop with a fallback plus a form-state row (real FP: ObservePlatform.tsx's routes)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/observe/ObservePlatform.tsx": [
        "export function OnCallSetup({ status, routeName, channel, target, minSeverity }) {",
        "  const addRoute = () => {",
        "    const routes = [...(status?.routes || []), { name: routeName.trim() || channel, channel, target: target.trim(), minSeverity }];",
        "    return routes;",
        "  };",
        "  return <button onClick={addRoute}>Add</button>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT fire when the identifier is only used as a call-argument shorthand property, not JSX interpolation (real FP: PlanningTools.tsx's participants)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/questmarket/PlanningTools.tsx": [
        "export function PlanningTools({ base, delta, achievements, lensRun }) {",
        "  const project = async () => {",
        "    const participants = [{",
        "      name: 'You (projected)',",
        "      xp: base.xp + delta,",
        "      questsCompleted: base.completed,",
        "      achievements,",
        "    }];",
        "    const r = await lensRun('questmarket', 'leaderboardRank', { participants });",
        "    return r;",
        "  };",
        "  return <button onClick={project}>Project</button>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "hardcoded_array_rendered_as_live_data").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT flag 'sample data' as placeholder content when the sentence is honestly DENYING it (real FP: CaseAnalytics.tsx empty state)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/law/CaseAnalytics.tsx": [
        "export function CaseAnalytics() {",
        "  return (",
        "    <EmptyState",
        "      description=\"Add cases in the Case Files tab — analytics runs the real caseAnalysis macro over your real matters, never sample data.\"",
        "    />",
        "  );",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "placeholder_content_strong").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("does NOT flag 'Sample Data' as placeholder content when it's a tab LABEL naming a feature (real FP: SchemaWorkbench.tsx tab config)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/schema/SchemaWorkbench.tsx": [
        "const TABS = [",
        "  { id: 'sample', label: 'Sample Data', icon: Beaker },",
        "  { id: 'migration', label: 'Migration', icon: GitBranch },",
        "];",
        "export function SchemaWorkbench() {",
        "  return <div>{TABS.map((t) => <button key={t.id}>{t.label}</button>)}</div>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.equal(byId(r, "placeholder_content_strong").length, 0, `got: ${JSON.stringify(nonInfo(r))}`);
  });

  it("STILL FIRES on a standalone title='Sample Episode' string that is NOT an id/key/label/name/tab/value (negation/identity-key fixes stay narrow)", async () => {
    dir = await tmpRepo({
      "concord-frontend/components/blog/EpisodeHeader.tsx": [
        "export function EpisodeHeader() {",
        "  return <h1 title=\"Sample Episode\">Now playing</h1>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runFrontendFakeDataDetector({ root: dir });
    assert.ok(byId(r, "placeholder_content_strong").length >= 1, `expected the standalone title to still fire, got: ${JSON.stringify(nonInfo(r))}`);
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
