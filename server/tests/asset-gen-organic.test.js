import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { stripWebpExtension, normalizeGlb, alphaVisible } from "../lib/asset-gen/organic/glb-normalize.js";
import { conceptPrompt, budgetFor, planForPrompt } from "../lib/asset-gen/organic/prompts.js";
import { buildGameLods } from "../lib/evo-asset/game-lod.js";

// Grid mesh with UVs: rows*cols*2 triangles.
function grid(doc, buffer, rows, cols) {
  const pos = []; const uv = []; const idx = [];
  for (let r = 0; r <= rows; r += 1) {for (let c = 0; c <= cols; c += 1) {
    pos.push(c / cols, Math.sin((c / cols) * 6) * 0.1 + Math.cos((r / rows) * 5) * 0.1, r / rows);
    uv.push(c / cols, r / rows);
  }}
  const row = cols + 1;
  for (let r = 0; r < rows; r += 1) {for (let c = 0; c < cols; c += 1) {
    const a = r * row + c; idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
  }}
  return doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buffer));
}

// Write a GLB whose textures are WebP behind a REQUIRED EXT_texture_webp,
// the way TRELLIS.2 ships them. Built as a PNG GLB, then the JSON is edited.
async function writeTrellisLikeGlb(file, { alphaMode = "OPAQUE", rows = 60, cols = 80 } = {}) {
  const webpRGBA = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 150, b: 40, alpha: 0.5 } } }).webp().toBuffer();
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tex = doc.createTexture("base").setImage(new Uint8Array(webpRGBA)).setMimeType("image/png");
  const mat = doc.createMaterial("m").setBaseColorTexture(tex).setAlphaMode(alphaMode);
  const mesh = doc.createMesh("geometry_0").addPrimitive(grid(doc, buffer, rows, cols).setMaterial(mat));
  const world = doc.createNode("world").addChild(doc.createNode("geometry_0").setMesh(mesh));
  doc.createScene().addChild(world);
  const glb = Buffer.from(await new NodeIO().writeBinary(doc));
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.slice(20, 20 + jsonLen).toString("utf8"));
  json.images[0].mimeType = "image/webp";
  json.textures[0] = { extensions: { EXT_texture_webp: { source: json.textures[0].source } } };
  json.extensionsUsed = ["EXT_texture_webp"];
  json.extensionsRequired = ["EXT_texture_webp"];
  let jb = Buffer.from(JSON.stringify(json));
  if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
  const rest = glb.slice(20 + jsonLen);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jb.length + rest.length, 8); header.writeUInt32LE(jb.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(file, Buffer.concat([header, jb, rest]));
}

describe("organic pipeline: glb-normalize", () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "organic-")); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("stripWebpExtension moves the source and clears used/required", () => {
    const json = { textures: [{ extensions: { EXT_texture_webp: { source: 3 } } }], extensionsUsed: ["EXT_texture_webp"], extensionsRequired: ["EXT_texture_webp"] };
    assert.equal(stripWebpExtension(json), 1);
    assert.deepEqual(json, { textures: [{ source: 3 }] });
  });

  it("a TRELLIS-style GLB is unreadable as-is and readable after normalize", async () => {
    const src = path.join(dir, "t.glb");
    await writeTrellisLikeGlb(src);
    await assert.rejects(new NodeIO().read(src), /Missing required extension, "EXT_texture_webp"/);
    const r = await normalizeGlb(src, path.join(dir, "n.glb"));
    assert.equal(r.ok, true);
    const doc = await new NodeIO().read(r.path);
    assert.equal(doc.getRoot().listExtensionsUsed().length, 0);
    assert.equal(doc.getRoot().listTextures().length, 1);
  });

  it("drops alpha on OPAQUE materials (spec-ignored) but keeps it for BLEND", async () => {
    for (const [mode, mime] of [["OPAQUE", "image/jpeg"], ["BLEND", "image/png"]]) {
      const src = path.join(dir, `a_${mode}.glb`);
      await writeTrellisLikeGlb(src, { alphaMode: mode });
      const r = await normalizeGlb(src, path.join(dir, `a_${mode}_n.glb`));
      assert.deepEqual(r.converted, [mime], `${mode} → ${mime}`);
      const tex = (await new NodeIO().read(r.path)).getRoot().listTextures()[0];
      assert.equal(alphaVisible(tex), mode !== "OPAQUE");
    }
  });
});

describe("organic pipeline: budget decimation", () => {
  it("decimates LOD0 to lod0MaxTris, bands are fractions of it, and the hierarchy is kept", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "organic-lod-"));
    try {
      const src = path.join(dir, "raw.glb");
      await writeTrellisLikeGlb(src, { rows: 100, cols: 100 });
      const norm = await normalizeGlb(src, path.join(dir, "mon_test.glb"));
      const r = await buildGameLods(norm.path, { lod0MaxTris: 4000, nodeName: "mon_test" });
      assert.equal(r.ok, true);
      assert.equal(r.source.tris, 20000);
      assert.equal(r.lod0.decimated, true);
      assert.ok(r.lod0.tris <= 4000 * 1.05 && r.lod0.tris > 3000, `lod0 ${r.lod0.tris}`);
      assert.ok(r.bands[0].tris < r.lod0.tris && r.bands[1].tris < r.bands[0].tris);
      const doc = await new NodeIO().read(r.path);
      const world = doc.getRoot().listScenes()[0].listChildren()[0];
      assert.equal(world.getName(), "world", "provider's parent node is preserved");
      assert.deepEqual(world.listChildren().map((n) => n.getName()), ["mon_test_LOD0", "mon_test_LOD1", "mon_test_LOD2"]);
      const written = doc.getRoot().listAccessors().filter((a) => a.getType() === "VEC3").map((a) => a.getCount());
      assert.ok(Math.max(...written) < 10201, "full-resolution buffers are not written out");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("organic pipeline: prompts", () => {
  // id deliberately NOT "mon_sunder_basilisk" — that id now has a
  // PROMPT_OVERRIDES entry (2026-09-24 monster batch review found its
  // auto-derived prompt consistently wrong), and conceptPrompt checks the
  // override map before deriving, so a colliding id here would silently
  // test the override's fixed string instead of the general derivation
  // logic this suite exists to cover.
  const basilisk = {
    id: "mon_test_basilisk", batch: "B4_monsters", taxonomy_tags: ["monster", "territorial", "serpentine"],
    prompt: "Orthographic turnaround plus one hero pose, pure-black silhouette inset. Stylized realism, GTA wear, Palworld readable mass, saturated light, visible bevels, PBR albedo without baked light. Thick serpentine basilisk, diamond hood, no chicken legs.",
    silhouette_notes: "Must read as a pure-black silhouette at 100m and at chase-camera distance. Windup / strike / recover poses stay distinct. Thick coil, hood as a single diamond.",
  };
  it("keeps the creature and its specific constraints, drops sheet framing and boilerplate", () => {
    const p = conceptPrompt(basilisk);
    assert.match(p, /Thick serpentine basilisk, diamond hood, no chicken legs\./);
    assert.match(p, /Thick coil, hood as a single diamond\./);
    assert.match(p, /Single full-body creature, three-quarter front view/);
    assert.doesNotMatch(p, /Orthographic turnaround|pure-black silhouette|Windup \/ strike/);
  });
  it("assigns budgets by category", () => {
    assert.deepEqual(budgetFor(basilisk), { category: "monsters", lod0MaxTris: 15000 });
    assert.equal(budgetFor({ taxonomy_tags: ["monster", "mech"] }).lod0MaxTris, 20000);
    assert.equal(budgetFor({ taxonomy_tags: ["monster", "boss"] }).category, "bosses");
    assert.equal(budgetFor({ batch: "B6_hybrids", taxonomy_tags: ["monster", "hybrid"] }).category, "hybrids");
  });
});

describe("organic pipeline: planForPrompt (ConKay ad-hoc path)", () => {
  it("builds a real plan from free text, applying the same single-subject/no-text contract every bible entry gets", () => {
    const plan = planForPrompt("a rusted iron lantern with a cracked glass pane");
    assert.equal(plan.ok, true);
    assert.equal(plan.id, null, "ad-hoc has no bible id — the caller mints one");
    assert.equal(plan.batch, "adhoc");
    assert.match(plan.prompt, /a rusted iron lantern with a cracked glass pane/);
    assert.match(plan.prompt, /Single full-body object, three-quarter front view/);
    assert.match(plan.prompt, /no text, no watermark/);
    // default hint tag ["environment"] -> budgetFor's environment bucket
    assert.equal(plan.category, "environment");
    assert.equal(plan.lod0MaxTris, 8000);
  });
  it("honors a category hint and an explicit tris override, capped at 20000", () => {
    const plan = planForPrompt("a two-headed goat", { tags: ["monster"], lod0MaxTris: 999999 });
    assert.equal(plan.category, "monsters");
    assert.equal(plan.lod0MaxTris, 20000, "an unreviewed ad-hoc request never gets more than the cap");
  });
  it("rejects empty or oversized text — never a fabricated plan", () => {
    assert.deepEqual(planForPrompt(""), { ok: false, reason: "empty_prompt" });
    assert.deepEqual(planForPrompt("   "), { ok: false, reason: "empty_prompt" });
    assert.deepEqual(planForPrompt("x".repeat(601)), { ok: false, reason: "prompt_too_long" });
  });
});

describe("organic pipeline: end-to-end ingest (no network)", () => {
  it("supplied concept + provider GLB → normalized, budgeted LODs in the output dir, manifest entry, no registry without db", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "organic-e2e-"));
    const prev = { unity: process.env.CONCORD_ORGANIC_UNITY_DIR, data: process.env.DATA_DIR, bible: process.env.CONCORD_NATIVE_BIBLE };
    try {
      process.env.CONCORD_ORGANIC_UNITY_DIR = path.join(dir, "unity", "Assets", "Concordia", "Models", "Generated");
      process.env.DATA_DIR = path.join(dir, "data");
      process.env.CONCORD_NATIVE_BIBLE = path.join(dir, "bible.json");
      fs.writeFileSync(process.env.CONCORD_NATIVE_BIBLE, JSON.stringify({ entries: [{
        id: "mon_test_beast", display_name: "Test Beast", batch: "B4_monsters", world_ids: ["Fantasy"],
        taxonomy_tags: ["monster"], prompt: "x PBR albedo without baked light. A test beast.", silhouette_notes: "Low wedge.",
      }] }));
      const raw = path.join(dir, "raw.glb");
      await writeTrellisLikeGlb(raw, { rows: 130, cols: 130 }); // 33,800 tris > 15k monster budget
      const concept = path.join(dir, "concept.webp");
      await sharp({ create: { width: 16, height: 16, channels: 3, background: "#aa7733" } }).webp().toFile(concept);

      const { generateOrganicAsset, MANIFEST } = await import(`../lib/asset-gen/organic/generate-organic.js?e2e=${Date.now()}`);
      const r = await generateOrganicAsset({ id: "mon_test_beast", conceptImage: concept, rawGlb: raw, meshProvider: "fixture" });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.evoAssetId, null, "no db → nothing registered");
      assert.ok(r.stages.lods.lod0Tris <= 15000 * 1.05, `LOD0 at budget: ${r.stages.lods.lod0Tris}`);
      assert.ok(fs.existsSync(path.join(process.env.CONCORD_ORGANIC_UNITY_DIR, "monsters", "mon_test_beast_lods.glb")));
      assert.ok(fs.existsSync(path.join(process.env.CONCORD_ORGANIC_UNITY_DIR, "monsters", "mon_test_beast_concept.png")));
      const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).assets.mon_test_beast;
      assert.equal(m.lodsFile, "Assets/Concordia/Models/Generated/monsters/mon_test_beast_lods.glb");
      assert.equal(m.fidelity, "unchecked");
      assert.equal(m.providers.mesh, "fixture");

      const bad = await generateOrganicAsset({ id: "mon_not_in_bible" });
      assert.deepEqual(bad, { ok: false, reason: "unknown_bible_id", id: "mon_not_in_bible" });

      // Ad-hoc path (ConKay): a `plan` from planForPrompt bypasses the bible
      // lookup entirely — same pipeline, same registry, different provenance
      // tags (conkay-adhoc instead of native-bible:<id>).
      const plan = planForPrompt("a small brass compass", { tags: ["environment"] });
      assert.equal(plan.ok, true);
      const adhocRaw = path.join(dir, "adhoc_raw.glb");
      await writeTrellisLikeGlb(adhocRaw, { rows: 40, cols: 40 });
      const adhocConcept = path.join(dir, "adhoc_concept.webp");
      await sharp({ create: { width: 16, height: 16, channels: 3, background: "#334455" } }).webp().toFile(adhocConcept);
      const ar = await generateOrganicAsset({
        id: "adhoc_test1234", plan, conceptImage: adhocConcept, rawGlb: adhocRaw, meshProvider: "fixture",
      });
      assert.equal(ar.ok, true, JSON.stringify(ar));
      assert.ok(fs.existsSync(path.join(process.env.CONCORD_ORGANIC_UNITY_DIR, "environment", "adhoc_test1234_lods.glb")));
      const am = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).assets.adhoc_test1234;
      assert.equal(am.batch, "adhoc");
    } finally {
      for (const [k, v] of [["CONCORD_ORGANIC_UNITY_DIR", prev.unity], ["DATA_DIR", prev.data], ["CONCORD_NATIVE_BIBLE", prev.bible]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("organic pipeline: hand-corrected prompt overrides", () => {
  it("uses the override verbatim for ids the 2026-09-24 review rejected, bypassing derivation", async () => {
    const { conceptPrompt } = await import("../lib/asset-gen/organic/prompts.js");
    for (const id of ["mon_sunder_basilisk", "mon_ruins_wraith", "mon_grid_drone", "mon_frontier_domebreaker"]) {
      const p = conceptPrompt({ id, prompt: "should be ignored", silhouette_notes: "should also be ignored" });
      assert.doesNotMatch(p, /should be ignored/);
      assert.match(p, /Single full-body (creature|object), three-quarter front view/);
    }
  });
  it("basilisk override bans the exact two failures seen on 3/3 real seeds: gem-hood and clawed legs", async () => {
    const { conceptPrompt } = await import("../lib/asset-gen/organic/prompts.js");
    const p = conceptPrompt({ id: "mon_sunder_basilisk" });
    assert.match(p, /no legs, no arms, no claws/);
    assert.match(p, /not a gemstone, not a crystal/);
  });
  it("grid_drone override explicitly bans propellers, the actual failure (not covered by the bible's own 'no spaghetti antennae' wording)", async () => {
    const { conceptPrompt } = await import("../lib/asset-gen/organic/prompts.js");
    const p = conceptPrompt({ id: "mon_grid_drone" });
    assert.match(p, /no propellers, no rotors, no spinning blades/);
  });
});
