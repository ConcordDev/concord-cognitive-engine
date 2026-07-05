// tests/hardcoded-literal-data-prop-detector.test.js
//
// Proves the hardcoded-literal-data-prop detector fires on the real bug it
// was seeded from — concord-frontend/app/lenses/world/page.tsx mounting
// SkyWeatherRenderer, FactionBanners, and InstancedGrass with
// `windDirection={0}` hardcoded at all three sites instead of the live
// `windDirection` state the file already tracked — and that it does NOT
// fire on the look-alikes: a single hardcoded generic-name prop, a prop fed
// a real variable at every mount, and an unrelated always-false boolean.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runHardcodedLiteralDataPropDetector,
  extractJsxMounts,
  extractAttrs,
  classifyAttrValue,
} from "../lib/detectors/hardcoded-literal-data-prop-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hcdp-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

const byId = (r, id) => r.findings.filter((f) => f.id === id);
const nonInfo = (r) => r.findings.filter((f) => f.severity !== "info");

describe("hardcoded-literal-data-prop detector — pure helpers", () => {
  it("extractJsxMounts finds component tags and respects brace/string depth", () => {
    const src = `<Foo bar={x > 1 ? 'a' : 'b'} baz={{ a: 1 }} />\n<Bar.Sub qux="hi" />`;
    const mounts = extractJsxMounts(src);
    assert.equal(mounts.length, 2);
    assert.equal(mounts[0].component, "Foo");
    assert.ok(mounts[0].tagText.endsWith("/>"));
    assert.equal(mounts[1].component, "Bar.Sub");
  });

  it("extractAttrs pulls name=value pairs including braced and bare-string forms", () => {
    const attrs = extractAttrs(`<Foo windDirection={0} label="hi" enabled={isOn} />`);
    const names = attrs.map((a) => a.name);
    assert.deepEqual(names, ["windDirection", "label", "enabled"]);
    assert.equal(attrs[0].rawValue, "{0}");
    assert.equal(attrs[1].rawValue, `"hi"`);
    assert.equal(attrs[2].rawValue, "{isOn}");
  });

  it("classifyAttrValue recognizes the empty/off literal set and rejects expressions", () => {
    assert.equal(classifyAttrValue("{0}").literal, true);
    assert.equal(classifyAttrValue("{-0}").literal, true);
    assert.equal(classifyAttrValue("{false}").literal, true);
    assert.equal(classifyAttrValue("{null}").literal, true);
    assert.equal(classifyAttrValue("{[]}").literal, true);
    assert.equal(classifyAttrValue("{''}").literal, true);
    assert.equal(classifyAttrValue(`""`).literal, true);
    assert.equal(classifyAttrValue("{windSpeed}").literal, false);
    assert.equal(classifyAttrValue("{a || 0}").literal, false);
    assert.equal(classifyAttrValue("{getValue()}").literal, false);
    assert.equal(classifyAttrValue("{1}").literal, false, "non-zero number is not in the empty/off set");
  });
});

describe("hardcoded-literal-data-prop detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (medium) on the real seed shape: 3 DIFFERENT components each hardcoding windDirection={0}", async () => {
    // Reconstructed from the pre-fix concord-frontend/app/lenses/world/page.tsx
    // (git show 75d46fb4^:concord-frontend/app/lenses/world/page.tsx) —
    // SkyWeatherRenderer, FactionBanners, and InstancedGrass each hardcoded
    // windDirection={0} instead of reading the file's own `windDirection`
    // useState (fed by a socket handler elsewhere in the file).
    dir = await tmpRepo({
      "app/lenses/world/page.tsx": [
        "export default function WorldPage() {",
        "  const [windDirection, setWindDirection] = useState(0);",
        "  return (",
        "    <>",
        "      <SkyWeatherRenderer",
        "        timeOfDay={12}",
        "        windDirection={0}",
        "        windSpeed={2}",
        "      />",
        "      <FactionBanners",
        "        worldId={activeDistrict?.id || 'concordia-hub'}",
        "        bannerAnchors={[]}",
        "        windDirection={0}",
        "      />",
        "      <InstancedGrass",
        "        density={0.6}",
        "        windDirection={0}",
        "      />",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    assert.equal(r.ok, true);
    const multi = byId(r, "hardcoded_literal_data_prop_multi_mount");
    assert.equal(multi.length, 1, "one grouped finding for the (windDirection, 0) pair");
    assert.equal(multi[0].severity, "medium");
    assert.equal(multi[0].evidence.components.length, 3);
    assert.deepEqual(
      [...multi[0].evidence.components].sort(),
      ["FactionBanners", "InstancedGrass", "SkyWeatherRenderer"],
    );
    assert.equal(multi[0].evidence.lines.length, 3);
  });

  it("does NOT fire on a single mount with a GENERIC data-sounding prop hardcoded (conservative single-mount design)", async () => {
    dir = await tmpRepo({
      "components/Foo.tsx": [
        "export function Wrapper() {",
        "  return <ScoreBoard score={0} />;",
        "}",
      ].join("\n"),
    });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    assert.equal(nonInfo(r).length, 0, "generic-name single mount is below the confidence bar by design");
  });

  it("DOES fire (low) on a single mount with a HIGH-CONFIDENCE direction/position-style prop name", async () => {
    dir = await tmpRepo({
      "components/Bar.tsx": [
        "export function Wrapper() {",
        "  return <Compass windDirection={0} />;",
        "}",
      ].join("\n"),
    });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    const single = byId(r, "hardcoded_literal_data_prop_single_mount");
    assert.equal(single.length, 1);
    assert.equal(single[0].severity, "low");
  });

  it("does NOT fire when the SAME prop is fed a real variable/expression at every mount", async () => {
    dir = await tmpRepo({
      "app/lenses/world/page.tsx": [
        "export default function WorldPage() {",
        "  const [windDirection] = useState(0);",
        "  return (",
        "    <>",
        "      <SkyWeatherRenderer windDirection={windDirection} />",
        "      <FactionBanners windDirection={windDirection} />",
        "      <InstancedGrass windDirection={liveWind || windDirection} />",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    assert.equal(nonInfo(r).length, 0, "live-variable props must never be flagged");
  });

  it("does NOT fire on a legitimately-always-false prop with a non-data-sounding name", async () => {
    dir = await tmpRepo({
      "components/Toggle.tsx": [
        "export function Wrapper() {",
        "  return (",
        "    <>",
        "      <Modal disabled={false} />",
        "      <Modal disabled={false} />",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    assert.equal(nonInfo(r).length, 0, "'disabled' does not match any data-sounding keyword");
  });

  it("respects the // detector-allow: hardcoded-prop escape hatch, collapsing a multi-mount group", async () => {
    dir = await tmpRepo({
      "components/Weather.tsx": [
        "export function Wrapper() {",
        "  return (",
        "    <>",
        "      {/* detector-allow: hardcoded-prop this widget is intentionally static */}",
        "      <SkyWeatherRenderer windDirection={0} />",
        "      <FactionBanners windDirection={0} />",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    // The annotated occurrence drops out, leaving exactly one un-annotated
    // occurrence of (windDirection, 0) — which downgrades from a Tier A
    // multi-mount finding to a Tier B single-mount finding (windDirection
    // is in the high-confidence single-mount list).
    assert.equal(byId(r, "hardcoded_literal_data_prop_multi_mount").length, 0);
    const single = byId(r, "hardcoded_literal_data_prop_single_mount");
    assert.equal(single.length, 1);
    assert.equal(single[0].evidence.component, "FactionBanners");
  });

  it("never throws — returns ok:true on an empty tree", async () => {
    dir = await tmpRepo({ "x.txt": "no code here" });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(r.summary.total, 1); // just the info summary line
  });

  it("never throws — returns ok:true on a tsx file with no JSX at all", async () => {
    dir = await tmpRepo({ "lib/util.ts": "export const x = 1;\n" });
    const r = await runHardcodedLiteralDataPropDetector({ root: dir });
    assert.equal(r.ok, true);
  });
});
