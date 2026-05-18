// Tier-2 contract test — Studio Sprint C #4: stem splitter.
//
// We don't require Demucs to be installed. Tests cover:
//   - macro reports demucs_not_installed when DEMUCS_BIN is absent
//   - input validation (no path / no actor / missing parent DTU)
//   - cache-hit flow returns fromCache:true without spawning
// And verify MODALITY config wires correctly.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import registerStudioStemMacros from "../domains/studio-stems.js";
import { MODALITY } from "../lib/modality-config.js";
import { splitStems, _internal } from "../lib/studio/stem-splitter.js";

const TEST_CACHE = "./data/test-stems-cache";

function makeRegistry() {
  const macros = new Map();
  registerStudioStemMacros((domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  });
  return macros;
}

function makeFakeDb() {
  const dtus = new Map();
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args) => {
          if (s.startsWith("INSERT INTO dtus")) {
            const [id, title, creator, meta] = args;
            dtus.set(id, { id, kind: "audio_stem", title, creator_id: creator, meta_json: meta });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (s.includes("FROM dtus WHERE id = ?")) {
            const [id] = args;
            return dtus.get(id);
          }
          return undefined;
        },
        all: () => [],
      };
    },
    _addTrack(id, creator, audioPath) {
      dtus.set(id, {
        id, kind: "audio", creator_id: creator, title: id,
        meta_json: JSON.stringify({ audio_path: audioPath }),
      });
    },
    _tables: { dtus },
  };
}

describe("studio.split_audio when Demucs is not installed", () => {
  beforeEach(() => { MODALITY.stems.enabled = false; });

  it("returns demucs_not_installed via splitStems directly", () => {
    const r = splitStems({ inputPath: "/tmp/anything.wav" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "demucs_not_installed");
  });

  it("macro proxies the not-installed result", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    const out = await macros.get("studio.split_audio").handler(
      { db, actor: { userId: "u1" } },
      { audio_path: "/tmp/anything.wav" },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "demucs_not_installed");
  });

  it("stems_status reports unavailable cleanly", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.stems_status").handler({}, {});
    assert.equal(out.ok, true);
    assert.equal(out.available, false);
  });
});

describe("studio.split_audio input validation", () => {
  it("rejects when actor is missing", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.split_audio").handler(
      { db: makeFakeDb() }, { audio_path: "/x.wav" },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_actor");
  });

  it("rejects when neither audio_path nor parent_audio_dtuId given", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.split_audio").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } }, {},
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "audio_path_required");
  });

  it("returns parent_audio_not_found when parent DTU id is unknown", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.split_audio").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } },
      { parent_audio_dtuId: "missing" },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "parent_audio_not_found");
  });

  it("returns parent_audio_has_no_path when DTU meta lacks audio_path", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("audio_1", "u1", null); // null path → no audio_path in meta
    // Overwrite meta to not include audio_path
    db._tables.dtus.set("audio_1", {
      ...db._tables.dtus.get("audio_1"),
      meta_json: JSON.stringify({ genre: "lofi" }),
    });
    const out = await macros.get("studio.split_audio").handler(
      { db, actor: { userId: "u1" } },
      { parent_audio_dtuId: "audio_1" },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "parent_audio_has_no_path");
  });
});

describe("splitStems cache behavior", () => {
  beforeEach(() => {
    MODALITY.stems.enabled = true;
    MODALITY.stems.bin = "/usr/bin/true";   // safe no-op binary
    MODALITY.stems.cacheDir = TEST_CACHE;
    if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true, force: true });
    mkdirSync(TEST_CACHE, { recursive: true });
  });
  afterEach(() => {
    MODALITY.stems.enabled = false;
    MODALITY.stems.bin = "";
    if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true, force: true });
  });

  it("returns fromCache:true when pre-populated stems directory exists", () => {
    // Pre-populate a cache slot by computing the SHA for a known buffer
    // and laying down 4 stem files.
    const inputBuffer = Buffer.from("fake-audio-bytes-for-test");
    const sha = _internal.sha1Hex(inputBuffer);
    const outDir = path.join(TEST_CACHE, sha, "demucs-model", "track");
    mkdirSync(outDir, { recursive: true });
    for (const role of _internal.STEM_ROLES) {
      writeFileSync(path.join(outDir, `${role}.wav`), "ignored");
    }
    const r = splitStems({ inputBuffer });
    assert.equal(r.ok, true);
    assert.equal(r.fromCache, true);
    assert.equal(r.cachedSha, sha);
    for (const role of _internal.STEM_ROLES) {
      assert.ok(r.stems[role], `cached path for ${role}`);
    }
  });

  it("rejects when no input is supplied", () => {
    const r = splitStems({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_input");
  });
});

describe("MODALITY.stems config shape", () => {
  it("ships with the expected default fields", () => {
    assert.equal(MODALITY.stems.backend, "demucs");
    assert.equal(MODALITY.stems.binEnv, "DEMUCS_BIN");
    assert.ok(MODALITY.stems.timeoutMs >= 30_000);
    assert.ok(MODALITY.stems.cacheDir);
  });
});
