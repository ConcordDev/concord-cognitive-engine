import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("Concordia HUD modes — AAA density", () => {
  it("explore / combat / social / scheme never stack, and keybinds are hold-Tab", () => {
    const hud = src("ConcordiaHUD.cs");
    assert.match(hud, /enum HudMode \{ Explore, Combat, Social, Scheme \}/);
    assert.match(hud, /HudMode ResolveMode\(\)/);
    const onGui = hud.slice(hud.indexOf("void OnGUI()"), hud.indexOf("void Hints("));
    assert.match(onGui, /if \(_mode == HudMode\.Combat\) TargetBar/);
    assert.match(onGui, /if \(_mode == HudMode\.Scheme\) PlotBar/);
    assert.match(onGui, /if \(_mode != HudMode\.Scheme\) Prompt/);
    assert.match(hud, /if \(!DebugHud && !holdTab\) return/);
    assert.match(hud, /KeyCode\.Tab/);
    assert.doesNotMatch(hud, /scheme nearby/);
  });

  it("place name is title case, Flower Law is an icon, kernel dump is F8", () => {
    const hud = src("ConcordiaHUD.cs");
    assert.doesNotMatch(hud, /world\.title\.ToUpperInvariant\(\)/);
    assert.match(hud, /GUI\.Label\(new Rect\(54, 32, 230, 22\), world\.title, _title\)/);
    assert.match(hud, /void DrawRegime\(/);
    assert.match(hud, /if \(!DebugHud\) return/);
    assert.match(hud, /WorldClock\.HudClock\(\)/);
    assert.match(hud, /WorldField\.HudLine/);
    assert.match(hud, /ConcordClient\.HudLine/);
    assert.match(hud, /ruins remain/);
    assert.match(hud, /FLOWER-LAW/);
    assert.match(hud, /KeyCode\.F1/);
    assert.match(hud, /concordia-p0-no-debug/);
    assert.match(hud, /WorldAaa\.DebugDump/);
  });

  it("one player HP metaphor: rings, not a party bar; target names are speech", () => {
    const hud = src("ConcordiaHUD.cs");
    const party = hud.slice(hud.indexOf("void PartyStrip()"), hud.indexOf("void PlotBar("));
    assert.doesNotMatch(party, /player\.hp/);
    assert.match(hud, /void Rings\(/);
    assert.match(hud, /ActorLabel\(/);
    assert.match(hud, /Court bird/);
    assert.doesNotMatch(hud, /dummy\.name : \(host \? host\.name/);
    assert.doesNotMatch(hud, /label\.ToUpperInvariant\(\)/);
    assert.match(hud, /g\.world\.ToString\(\)/);
    assert.doesNotMatch(hud, /name = g\.shortName/);
  });

  it("skill lattice HUD copy never leaks the channel id", () => {
    const obj = src("HubObjectives.cs");
    const hud = src("ConcordiaHUD.cs");
    assert.match(obj, /if \(!FromKernel\) return "Skills unbound"/);
    assert.match(obj, /PrettySkill\(/);
    assert.doesNotMatch(obj, /skills\.mastery unbound/);
    assert.doesNotMatch(hud, /skills\.mastery unbound/);
    assert.match(hud, /KitBag\.PrettyWeapon\(player\.kitWeapon\)/);
  });
});
