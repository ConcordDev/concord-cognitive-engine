import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const unity = join(root, "apps/concordia-living-world/unity-client");
const scripts = join(unity, "Assets/Concordia/Scripts");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("Concordia URP Linear — cinematic AA floor", () => {
  it("project color space is Linear and lights use linear intensity", () => {
    const settings = readFileSync(join(unity, "ProjectSettings/ProjectSettings.asset"), "utf8");
    const gfx = readFileSync(join(unity, "ProjectSettings/GraphicsSettings.asset"), "utf8");
    assert.match(settings, /m_ActiveColorSpace: 1/);
    assert.doesNotMatch(settings, /m_ActiveColorSpace: 0/);
    assert.match(gfx, /m_LightsUseLinearIntensity: 1/);
  });

  it("URP asset bakes soft shadows, 4 cascades, additional-light shadows, depth+opaque", () => {
    const urp = readFileSync(join(unity, "Assets/Settings/URP-Pipeline.asset"), "utf8");
    assert.match(urp, /m_SoftShadowsSupported: 1/);
    assert.match(urp, /m_ShadowCascadeCount: 4/);
    assert.match(urp, /m_AdditionalLightShadowsSupported: 1/);
    assert.match(urp, /m_AdditionalLightsPerObjectLimit: 8/);
    assert.match(urp, /m_RequireDepthTexture: 1/);
    assert.match(urp, /m_RequireOpaqueTexture: 1/);
    assert.match(urp, /m_ShadowDistance: 110/);
    assert.match(urp, /m_ColorGradingMode: 1/);
    assert.match(urp, /m_ColorGradingLutSize: 64/);
    assert.match(urp, /m_ReflectionProbeBlending: 1/);
    assert.match(urp, /m_ReflectionProbeBoxProjection: 1/);
    assert.doesNotMatch(urp, /m_SoftShadowsSupported: 0/);
    assert.doesNotMatch(urp, /m_ShadowCascadeCount: 1\b/);
  });

  it("SSAO is a committed renderer feature, not an Editor-only inject", () => {
    const renderer = readFileSync(join(unity, "Assets/Settings/URP-Renderer.asset"), "utf8");
    assert.match(renderer, /guid: f62c9c65cf3354c93be831c8bc075510/);
    assert.match(renderer, /m_Name: SSAO/);
    assert.match(renderer, /m_RendererFeatures:/);
    assert.doesNotMatch(renderer, /m_RendererFeatures: \[\]/);
    const look = src("HubLook.cs");
    assert.match(look, /BakeUrp\(/);
    assert.match(look, /Stay on URP/);
    assert.doesNotMatch(look, /High Definition Render Pipeline/);
  });

  it("Hub and continent ground are heightfields, not Unity Planes", () => {
    const look = src("HubLook.cs");
    const builder = src("WorldBuilder.cs");
    const stream = src("ContinentStream.cs");
    const kit = src("WorldKit.cs");
    const grounding = src("Grounding.cs");
    assert.match(look, /public static GameObject Heightfield\(/);
    assert.match(builder, /HubLook\.Heightfield\(root, "Ground"/);
    assert.match(stream, /HubLook\.Heightfield\(continent, "ContinentGround"/);
    assert.match(kit, /HubLook\.Heightfield\(root, "HoldGround"/);
    assert.doesNotMatch(builder, /PrimitiveType\.Plane/);
    assert.doesNotMatch(stream, /PrimitiveType\.Plane/);
    assert.match(grounding, /sz\.y > 1\.6f/);
    assert.match(grounding, /IndexOf\("Ground"/);
  });

  it("Court ground defaults to ADG/PBR, not Cartoon grass, and upgrade keeps metal maps", () => {
    const look = src("HubLook.cs");
    assert.match(look, /ADG_Textures\/ground_vol1\/ground1\/ground1\.mat/);
    assert.doesNotMatch(look, /Material_GrassFlowers/);
    assert.match(look, /_METALLICSPECGLOSSMAP/);
    assert.match(look, /FirstTex\(src, "_MetallicGlossMap"/);
    assert.match(look, /Lantern/);
    assert.match(look, /LightShadows\.Soft/);
    assert.match(look, /Point\(parent, "CourtLamp".*true\)/);
  });
});
