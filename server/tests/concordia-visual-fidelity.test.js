import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bible = join(root, "apps/concordia-living-world/bible");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");
const aura = join(root, "apps/concordia-living-world/unity-client");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("Concordia cinematic visual-fidelity contract", () => {
  it("bible names the bar, the 2k library, profiles, and the ten shots", () => {
    const cinematic = readFileSync(join(bible, "CINEMATIC.md"), "utf8");
    assert.match(cinematic, /visual-fidelity target/);
    assert.match(cinematic, /_2k\.jpg/);
    assert.match(cinematic, /LeanPlay/);
    assert.match(cinematic, /WebGL/);
    assert.match(cinematic, /Unity build succeeded/);
    assert.match(cinematic, /ActionRunner/);
    assert.match(cinematic, /HitResolver/);
    assert.match(cinematic, /SHOT 01 — Court/);
    assert.match(cinematic, /SHOT 02 — Character/);
    assert.match(cinematic, /SHOT 03 — Combat/);
    assert.match(cinematic, /SHOT 04 — Sprint/);
    assert.match(cinematic, /SHOT 05 — Road/);
    assert.match(cinematic, /SHOT 06 — Weather/);
    assert.match(cinematic, /SHOT 07 — Interior/);
    assert.match(cinematic, /SHOT 08 — NPC/);
    assert.match(cinematic, /SHOT 09 — Mount/);
    assert.match(cinematic, /SHOT 10 — Consequence/);
    assert.match(cinematic, /Do not accept asset presence|asset presence as completion|Indexed ≠ bound/i);
    assert.doesNotMatch(cinematic, /4K\/8K is LIVE/);
    assert.doesNotMatch(cinematic, /volumetric fog is LIVE/i);
  });

  it("runtime dump lists the same ten shots and refuses compile-as-pass", () => {
    const fidelity = src("VisualFidelity.cs");
    assert.match(fidelity, /SHOT 01 — Court/);
    assert.match(fidelity, /SHOT 10 — Consequence/);
    assert.match(fidelity, /Profile\.LeanPlay/);
    assert.match(fidelity, /Profile\.WebGL/);
    assert.match(fidelity, /static string Dump\(/);
    assert.match(fidelity, /bible\/CINEMATIC\.md/);
    const menu = readFileSync(
      join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Editor/VisualFidelityMenu.cs"),
      "utf8",
    );
    assert.match(menu, /Visual Fidelity\/Dump Shot Gate/);
    assert.match(menu, /Compile is not a pass/);
  });

  it("Aura bind-now and skill point at the cinematic contract, not pack-index as finish", () => {
    const bind = readFileSync(join(aura, "Assets/Concordia/AURA_BIND_NOW.md"), "utf8");
    const prompt = readFileSync(join(aura, "Assets/Concordia/AURA_CHAT_PROMPT.txt"), "utf8");
    const skill = readFileSync(join(aura, ".Aura/Skills/visual-fidelity/SKILL.md"), "utf8");
    const lock = readFileSync(join(root, "docs/UNITY_ART_LOCK.md"), "utf8");
    const docs = readFileSync(join(root, "docs/AURA_VISUAL_FIDELITY.md"), "utf8");
    assert.match(bind, /CINEMATIC\.md/);
    assert.match(prompt, /CINEMATIC/);
    assert.match(skill, /SHOT 01 — Court/);
    assert.match(skill, /SHOT 10 — Consequence/);
    assert.match(skill, /_2k\.jpg/);
    assert.match(skill, /ActionRunner/);
    assert.match(skill, /Unity build succeeded/);
    assert.match(lock, /CINEMATIC\.md/);
    assert.match(docs, /bible\/CINEMATIC\.md/);
  });

  it("live look still goes through HubLook PBR 2k, not a second stack", () => {
    const look = src("HubLook.cs");
    assert.match(look, /_diffuse_2k/);
    assert.match(look, /_nor_gl_2k/);
    assert.match(look, /_arm_2k/);
    assert.match(look, /TonemappingMode\.ACES/);
    assert.match(look, /LiveFog\(/);
    assert.match(look, /GroundInLight\(/);
    assert.match(look, /ApplyInterior\(/);
    assert.match(look, /RenderSettings\.sun = /);
    assert.match(look, /PolyHaven\/HDRIs/);
    assert.match(look, /kloofendal_48d_partly_cloudy_puresky_2k\.hdr/);
    assert.match(look, /WetStone\(/);
    assert.match(look, /CX_Tile_CourtCobble/);
    assert.doesNotMatch(look, /Models\/polyhaven\/" \+ file/);
    assert.match(src("HubPlaza.cs"), /GateMouth/);
    assert.doesNotMatch(src("HubPlaza.cs"), /PortalVeil/);
    assert.match(src("WorldBuilder.cs"), /WetStone\(/);
    assert.match(src("ContinentStream.cs"), /CourtGround/);
    assert.match(src("ConcordiaHost.cs"), /LookLean => false/);
    assert.match(src("HubPlaza.cs"), /CourtBanner/);
    assert.match(src("HubPlaza.cs"), /CourtSanctum/);
    assert.match(src("HubLook.cs"), /public static void Shaft\(/);
    assert.match(src("HubLook.cs"), /public static void StoneDress\(/);
    assert.match(src("WorldBreath.cs"), /ConcordiaHost\.LookLean/);
    assert.doesNotMatch(src("WorldBreath.cs"), /ConcordiaHost\.LeanPlay/);
    assert.match(src("ChaseCamera.cs"), /sprinting \? PovFov/);
    assert.match(src("ChaseCamera.cs"), /public void Punch\(/);
    assert.match(src("ChaseCamera.cs"), /farClipPlane = 420f/);
    assert.match(src("CombatFeel.cs"), /public void Present\(/);
    assert.match(src("CombatFeel.cs"), /BeatFor\(/);
    assert.match(src("CombatFeel.cs"), /DefenseOutcome/);
    assert.match(readFileSync(join(scripts, "WorldBreath.cs"), "utf8"), /class WorldBreath/);
    assert.match(src("ConcordiaPlayer.cs"), /feel\?\.Present\(/);
  });
});
