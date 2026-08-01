// server/tests/verify-move-render-coverage-gate.test.js
//
// Real acceptance tests for scripts/verify-move-render-coverage.mjs — the
// Universal Move System's render-coverage gate. It statically parses five
// frontend registries (move-types.ts, skill-motion.ts, action-biomechanics.ts,
// world-vfx-bridge.ts, SoundscapeEngine.tsx) and replicates the move-resolver
// derivation to prove every renderable primitive binds to a real clip + VFX +
// SFX rather than silently falling to a generic placeholder.
//
// The script has no exported functions and derives its ROOT from
// `import.meta.url` two directories up (ROOT/concord-frontend/...), so the
// faithful way to exercise its actual parsing + derivation logic under a
// controlled scenario is to copy the REAL, current script into an isolated
// temp root alongside synthetic — but real-shaped — registry fixtures (same
// regex-matched idioms as the real files, including the `Record<X, (a) =>
// Y>` arrow-in-type-annotation quirk the script's own comment calls out),
// and drive it with execFileSync.
//
// Two fixture registry sets, hand-computed against the script's own
// documented derivation (see the block comments below each number):
//   GOOD — every primitive resolves. Expect overall 100%, 0 findings.
//   BAD  — one declared archetype ('flight') has no pose generator, and one
//          element ('shadow') has no skill-motion table entry (so it falls
//          to the generic vfx/sfx fallback in both derived layers). Expect
//          exactly 3 findings (1 archetype + 1 vfx + 1 sfx) and 75% on every
//          layer (9 ok / 12 total across all three layers).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-move-render-coverage.mjs");

// ── Shared fixture pieces (identical across GOOD/BAD) ───────────────────────

const SKILL_MOTION_TS = `
export const ELEMENT_MOTION = {
  fire:      { vfx: 'flame',  sfx: 'fire_whoosh' },
  ice:       { vfx: 'frost',  sfx: 'ice_crackle' },
};
`;

const ACTION_BIOMECHANICS_TS = `
export type ActionArchetype = 'cast_channel';

const ARCHETYPE_GEN: Record<ActionArchetype, (a: number) => ActionPose[]> = {
  cast_channel: poses_cast_channel,
};

const MOTION_EXTRA_GEN: Record<string, (a: number) => ActionPose[]> = {
  firearm: poses_firearm,
};

export const ACTION_DESCRIPTORS: Record<string, ActionDescriptor> = {
  chop: { archetype: 'cast_channel', leadingLimb: 'both_arms', phases: [180, 120, 260], juiceId: 'impact_wood', sfxId: 'fire_whoosh', vfx: 'flame' },
};
`;

const WORLD_VFX_BRIDGE_TS = `
export function particleParamsForType(type) {
  switch (type) {
    case 'flame':
      return { color: 0xff0000, count: 1, spread: 1, speed: 1, gravity: 0, lifetimeMs: 100, size: 0.1 };
    case 'frost':
      return { color: 0x00ffff, count: 1, spread: 1, speed: 1, gravity: 0, lifetimeMs: 100, size: 0.1 };
    default:
      return { color: 0xffffff, count: 1, spread: 1, speed: 1, gravity: 0, lifetimeMs: 100, size: 0.1 };
  }
}
`;

const SOUNDSCAPE_ENGINE_TSX = `
const SFX_MAP: Record<string, SFXDef> = {
  'fire-whoosh': { freq: 1, type: 'sine', duration: 1, attack: 0.1, decay: 0.1 },
  'ice-crackle': { freq: 1, type: 'sine', duration: 1, attack: 0.1, decay: 0.1 },
};

const LAYER_MAP: Record<string, LayerStep[]> = {
};

const SFX_ALIASES: Record<string, string> = {
};
`;

// ── The two scenarios differ only in move-types.ts ──────────────────────────

const MOVE_TYPES_GOOD_TS = `
export type ActionArchetype = 'cast_channel';
export type MotionArchetype =
  | ActionArchetype
  | 'firearm';

export const SKILL_KIND_MOTION: Record<SkillKind, SkillKindMotion> = {
  spell: { family: 'magic', archetype: 'cast_channel', effect: 'projectile', limb: 'both_arms', gauge: 'mana' },
};

export const ELEMENT_EFFECT_BIAS: Record<string, EffectArchetype> = {
  fire: 'projectile', ice: 'ground_zone',
};
`;

const MOVE_TYPES_BAD_TS = `
export type ActionArchetype = 'cast_channel';
export type MotionArchetype =
  | ActionArchetype
  | 'firearm' | 'flight';

export const SKILL_KIND_MOTION: Record<SkillKind, SkillKindMotion> = {
  spell: { family: 'magic', archetype: 'cast_channel', effect: 'projectile', limb: 'both_arms', gauge: 'mana' },
};

export const ELEMENT_EFFECT_BIAS: Record<string, EffectArchetype> = {
  fire: 'projectile', ice: 'ground_zone', shadow: 'debuff',
};
`;

function makeTempRoot(moveTypesSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-move-render-test-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "lib", "concordia", "move-catalog"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "lib", "world-lens"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "components", "world-lens"), { recursive: true });

  fs.copyFileSync(REAL_SCRIPT, path.join(root, "scripts", "verify-move-render-coverage.mjs"));

  const FE = path.join(root, "concord-frontend");
  fs.writeFileSync(path.join(FE, "lib", "concordia", "move-catalog", "move-types.ts"), moveTypesSrc);
  fs.writeFileSync(path.join(FE, "lib", "concordia", "skill-motion.ts"), SKILL_MOTION_TS);
  fs.writeFileSync(path.join(FE, "lib", "concordia", "action-biomechanics.ts"), ACTION_BIOMECHANICS_TS);
  fs.writeFileSync(path.join(FE, "lib", "world-lens", "world-vfx-bridge.ts"), WORLD_VFX_BRIDGE_TS);
  fs.writeFileSync(path.join(FE, "components", "world-lens", "SoundscapeEngine.tsx"), SOUNDSCAPE_ENGINE_TSX);
  return root;
}

function runGate(root, args = []) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(root, "scripts", "verify-move-render-coverage.mjs"), ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

describe("verify-move-render-coverage.mjs — GOOD fixture (everything resolves)", () => {
  it("reports overall 100%, 0 findings, exit 0 under --json --ci", () => {
    const root = makeTempRoot(MOVE_TYPES_GOOD_TS);
    try {
      const res = runGate(root, ["--json", "--ci", "100"]);
      assert.equal(res.code, 0, `expected exit 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      const out = JSON.parse(res.stdout);
      assert.equal(out.overall, 100);
      assert.equal(out.layers.archetype, 100);
      assert.equal(out.layers.vfx, 100);
      assert.equal(out.layers.sfx, 100);
      assert.equal(out.findings.length, 0);
      assert.equal(out.counts.archetype.total, 3);
      assert.equal(out.counts.vfx.total, 3);
      assert.equal(out.counts.sfx.total, 3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("human-readable mode reports the no-fallback banner", () => {
    const root = makeTempRoot(MOVE_TYPES_GOOD_TS);
    try {
      const res = runGate(root, []);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /Nothing falls back/);
      assert.match(res.stdout, /OVERALL\s*:\s*100%/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verify-move-render-coverage.mjs — BAD fixture (real gaps introduced)", () => {
  it("catches the ungenerated 'flight' archetype and the 'shadow' element's generic vfx+sfx fallback", () => {
    const root = makeTempRoot(MOVE_TYPES_BAD_TS);
    try {
      const res = runGate(root, ["--json"]);
      assert.equal(res.code, 0, "no --ci flag: report-only, exit 0 regardless of coverage");
      const out = JSON.parse(res.stdout);
      assert.equal(out.overall, 75);
      assert.equal(out.layers.archetype, 75);
      assert.equal(out.layers.vfx, 75);
      assert.equal(out.layers.sfx, 75);
      assert.equal(out.findings.length, 3);

      const archFinding = out.findings.find((f) => f.layer === "archetype");
      assert.ok(archFinding, "expected an archetype-layer finding");
      assert.equal(archFinding.id, "flight");
      assert.match(archFinding.reason, /NO pose generator/);

      const vfxFinding = out.findings.find((f) => f.layer === "vfx");
      assert.ok(vfxFinding, "expected a vfx-layer finding");
      assert.equal(vfxFinding.id, "spell+shadow");
      assert.match(vfxFinding.reason, /no skill-motion row/);

      const sfxFinding = out.findings.find((f) => f.layer === "sfx");
      assert.ok(sfxFinding, "expected an sfx-layer finding");
      assert.equal(sfxFinding.id, "spell+shadow");
      assert.match(sfxFinding.reason, /does not resolve to a SoundscapeEngine voice/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails --ci with the default 100% floor (exit 1)", () => {
    const root = makeTempRoot(MOVE_TYPES_BAD_TS);
    try {
      const res = runGate(root, ["--ci"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /FAIL: overall 75% < floor 100%/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes --ci with a floor at or below the actual 75% coverage", () => {
    const root = makeTempRoot(MOVE_TYPES_BAD_TS);
    try {
      const res = runGate(root, ["--ci", "70"]);
      assert.equal(res.code, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("human-readable mode lists the fallback findings under their layer headers", () => {
    const root = makeTempRoot(MOVE_TYPES_BAD_TS);
    try {
      const res = runGate(root, []);
      assert.match(res.stdout, /Fallback list \(3\)/);
      assert.match(res.stdout, /\[archetype\] 1/);
      assert.match(res.stdout, /\[vfx\] 1/);
      assert.match(res.stdout, /\[sfx\] 1/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verify-move-render-coverage.mjs — live repo smoke", () => {
  it("runs cleanly against the real repo registries and produces a well-formed report", () => {
    const stdout = execFileSync(process.execPath, [REAL_SCRIPT, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const out = JSON.parse(stdout);
    assert.equal(typeof out.overall, "number");
    assert.ok(out.overall >= 0 && out.overall <= 100);
    assert.ok(Array.isArray(out.findings));
    for (const layer of ["archetype", "vfx", "sfx"]) {
      assert.ok(out.counts[layer].total > 0, `expected real registries to yield ${layer} entries`);
    }
  });
});
