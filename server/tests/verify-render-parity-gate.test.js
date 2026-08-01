// server/tests/verify-render-parity-gate.test.js
//
// Real acceptance tests for scripts/verify-render-parity.mjs — the static
// appearance-layer render-parity gate. It scores two dimensions:
//   1. "move clip+VFX+SFX" — delegated wholesale to
//      scripts/verify-move-render-coverage.mjs (spawned via execSync with
//      cwd: ROOT), whose own fixture-based coverage is separately pinned in
//      verify-move-render-coverage-gate.test.js.
//   2. "station interior" — ROUTER_TABLE (frontend interactable stations) ∩
//      ROOM_TEMPLATES (server purpose-built interiors); any router station
//      with no matching template is a "falls back to a generic empty room"
//      finding.
//
// The script has no exported functions and derives ROOT from
// `import.meta.url`. Because it shells out to a SIBLING script by relative
// path (`node scripts/verify-move-render-coverage.mjs --json`, cwd: ROOT),
// exercising it under a controlled scenario means copying BOTH the real,
// current verify-render-parity.mjs AND the real, current
// verify-move-render-coverage.mjs into the same isolated temp root, plus
// synthetic registries for all five files either script reads.
//
// Hand-computed expectations:
//   GOOD  — 2 router stations, both have templates (stationPct=100); move
//           registries are the same "everything resolves" fixture used in
//           verify-move-render-coverage-gate.test.js (movePct=100).
//           => overall 100%, 0 station gaps.
//   BAD   — same 2 router stations, but ONE (hacking_terminal) has no
//           matching ROOM_TEMPLATES entry (stationPct=50, 1/2). Move
//           registries stay the "everything resolves" GOOD fixture
//           (movePct=100). Overall = average(100, 50) = 75%.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_PARITY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-render-parity.mjs");
const REAL_MOVE_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-move-render-coverage.mjs");

// ── Move-render fixtures: the "everything resolves" (100%) set, reused
// verbatim from verify-move-render-coverage-gate.test.js's GOOD scenario. ──
const MOVE_TYPES_TS = `
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

// ── Station-router / room-template fixtures ─────────────────────────────────
const ROUTER_TABLE_TSX = `
const ROUTER_TABLE: Record<string, React.LazyExoticComponent<React.ComponentType<OverlayProps>>> = {
  farm_plot:        FarmTileEditor,
  hacking_terminal: HackingTerminal,
};

export const STATION_TYPES = Object.freeze(Object.keys(ROUTER_TABLE));
`;

const ROOM_TEMPLATES_GOOD_JS = `
export const ROOM_TEMPLATES = {
  farm_plot:        { capacity: 2, typical_furniture: ['plot'], width: 5, depth: 5, height: 1 },
  hacking_terminal: { capacity: 2, typical_furniture: ['terminal'], width: 5, depth: 5, height: 3 },
};
`;

const ROOM_TEMPLATES_BAD_JS = `
export const ROOM_TEMPLATES = {
  farm_plot: { capacity: 2, typical_furniture: ['plot'], width: 5, depth: 5, height: 1 },
  generic:   { capacity: 4, typical_furniture: [], width: 6, depth: 6, height: 3 },
};
`;

function makeTempRoot(roomTemplatesSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-render-parity-test-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "lib", "concordia", "move-catalog"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "lib", "world-lens"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "components", "world-lens"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "components", "world"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });

  fs.copyFileSync(REAL_PARITY_SCRIPT, path.join(root, "scripts", "verify-render-parity.mjs"));
  fs.copyFileSync(REAL_MOVE_SCRIPT, path.join(root, "scripts", "verify-move-render-coverage.mjs"));

  const FE = path.join(root, "concord-frontend");
  fs.writeFileSync(path.join(FE, "lib", "concordia", "move-catalog", "move-types.ts"), MOVE_TYPES_TS);
  fs.writeFileSync(path.join(FE, "lib", "concordia", "skill-motion.ts"), SKILL_MOTION_TS);
  fs.writeFileSync(path.join(FE, "lib", "concordia", "action-biomechanics.ts"), ACTION_BIOMECHANICS_TS);
  fs.writeFileSync(path.join(FE, "lib", "world-lens", "world-vfx-bridge.ts"), WORLD_VFX_BRIDGE_TS);
  fs.writeFileSync(path.join(FE, "components", "world-lens", "SoundscapeEngine.tsx"), SOUNDSCAPE_ENGINE_TSX);
  fs.writeFileSync(path.join(FE, "components", "world", "StationInteractionRouter.tsx"), ROUTER_TABLE_TSX);

  fs.writeFileSync(path.join(root, "server", "lib", "building-interiors.js"), roomTemplatesSrc);
  return root;
}

function runGate(root, args = []) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(root, "scripts", "verify-render-parity.mjs"), ...args],
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

describe("verify-render-parity.mjs — GOOD fixture (stations fully covered)", () => {
  it("reports overall 100%, station 100%, 0 station gaps, exit 0 under --json --ci", () => {
    const root = makeTempRoot(ROOM_TEMPLATES_GOOD_JS);
    try {
      const res = runGate(root, ["--json", "--ci", "100"]);
      assert.equal(res.code, 0, `expected exit 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      const out = JSON.parse(res.stdout);
      assert.equal(out.overall, 100);
      const stationDim = out.dimensions.find((d) => d.name === "station interior");
      assert.equal(stationDim.pct, 100);
      const moveDim = out.dimensions.find((d) => d.name === "move clip+VFX+SFX");
      assert.equal(moveDim.pct, 100);
      assert.deepEqual(out.stationGaps, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verify-render-parity.mjs — BAD fixture (one station has no interior template)", () => {
  it("catches hacking_terminal falling back to a generic room; overall drops to 75%", () => {
    const root = makeTempRoot(ROOM_TEMPLATES_BAD_JS);
    try {
      const res = runGate(root, ["--json"]);
      assert.equal(res.code, 0, "no --ci flag: report-only, exit 0 regardless of coverage");
      const out = JSON.parse(res.stdout);
      const stationDim = out.dimensions.find((d) => d.name === "station interior");
      assert.equal(stationDim.pct, 50);
      assert.equal(out.overall, 75);
      assert.deepEqual(out.stationGaps, ["hacking_terminal"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails --ci with the default 100% floor (exit 1) and names the gap in the human-readable report", () => {
    const root = makeTempRoot(ROOM_TEMPLATES_BAD_JS);
    try {
      const res = runGate(root, ["--ci"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /FAIL: overall 75% < floor 100%/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("human-readable mode names the specific gap and points at building-interiors.js", () => {
    const root = makeTempRoot(ROOM_TEMPLATES_BAD_JS);
    try {
      const res = runGate(root, []);
      assert.match(res.stdout, /falling back to a generic room/);
      assert.match(res.stdout, /hacking_terminal/);
      assert.match(res.stdout, /building-interiors\.js/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes --ci with a floor at or below the actual 75% coverage", () => {
    const root = makeTempRoot(ROOM_TEMPLATES_BAD_JS);
    try {
      const res = runGate(root, ["--ci", "70"]);
      assert.equal(res.code, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verify-render-parity.mjs — live repo smoke", () => {
  it("runs cleanly against the real repo registries and produces a well-formed report", () => {
    const stdout = execFileSync(process.execPath, [REAL_PARITY_SCRIPT, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const out = JSON.parse(stdout);
    assert.equal(typeof out.overall, "number");
    assert.ok(out.overall >= 0 && out.overall <= 100);
    assert.ok(Array.isArray(out.dimensions));
    assert.ok(Array.isArray(out.stationGaps));
    const stationDim = out.dimensions.find((d) => d.name === "station interior");
    assert.ok(stationDim, "expected a station-interior dimension in the live report");
  });
});
