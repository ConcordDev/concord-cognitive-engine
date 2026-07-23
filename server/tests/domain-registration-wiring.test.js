// server/tests/domain-registration-wiring.test.js
//
// Wiring-audit fix (2026-07-23): 5 domain files each exported a real
// registerXMacros(register) that delegates to a real, tested lib engine, but
// the file itself was never imported from server.js or domains/index.js — a
// caller-with-no-receiver dead-code gap (only their own unit tests imported
// them, so their macros were unreachable at runtime via /api/lens/run or the
// MCP server). Fixed by adding the same 2-line import+register pattern used
// throughout server.js's registration block. See CLAUDE.md's method §1
// ("runtime-truth over source-guessing") — this test pins BOTH the static
// wire (server.js source actually calls the registrar) AND the runtime
// behavior (the registrar actually lands macros in a MACROS-shaped map),
// so a future refactor can't silently re-orphan one of these domains.
//
// Domains covered: immersive_sim, skill_tree, sports_careers, survival,
// vehicle_tuning.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import registerImmersiveSimMacros from "../domains/immersive-sim.js";
import registerSkillTreeMacros from "../domains/skill-tree.js";
import registerSportsMacros from "../domains/sports-careers.js";
import registerSurvivalMacros from "../domains/survival.js";
import registerVehicleTuningMacros from "../domains/vehicle-tuning.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(join(__dirname, "..", "server.js"), "utf8");

const DOMAINS = [
  {
    domain: "immersive_sim",
    file: "./domains/immersive-sim.js",
    importName: "registerImmersiveSimMacros",
    register: registerImmersiveSimMacros,
    expectedMacros: [
      "prop_verbs", "invoke_verb", "all_prop_kinds", "has_verb",
      "recognition_probability", "roll_recognition", "registries",
    ],
  },
  {
    domain: "skill_tree",
    file: "./domains/skill-tree.js",
    importName: "registerSkillTreeMacros",
    register: registerSkillTreeMacros,
    expectedMacros: ["for_me", "for_actor", "check_gate", "catalog"],
  },
  {
    domain: "sports_careers",
    file: "./domains/sports-careers.js",
    importName: "registerSportsMacros",
    register: registerSportsMacros,
    expectedMacros: [
      "open_league", "add_team", "add_roster_member", "teams",
      "request_tryout", "my_career", "schedule_match", "play_match",
      "tick", "advance_stage", "record_outcome", "retire", "constants",
    ],
  },
  {
    domain: "survival",
    file: "./domains/survival.js",
    importName: "registerSurvivalMacros",
    register: registerSurvivalMacros,
    expectedMacros: [
      "get_budget", "tick", "eat", "drink", "sleep", "contract_disease",
      "tick_diseases", "list_diseases", "cure_partial", "constants", "summary",
    ],
  },
  {
    domain: "vehicle_tuning",
    file: "./domains/vehicle-tuning.js",
    importName: "registerVehicleTuningMacros",
    register: registerVehicleTuningMacros,
    expectedMacros: [
      "create_part", "list_catalog", "list_mine", "install", "uninstall",
      "vehicle_stats", "list_installed", "set_paint", "add_decal",
      "remove_decal", "base_stats", "get_part",
    ],
  },
];

describe("previously-orphaned domains are statically wired into server.js", () => {
  for (const d of DOMAINS) {
    it(`server.js imports + calls ${d.importName}(register) from ${d.file}`, () => {
      const importLine = `import ${d.importName} from "${d.file}";`;
      assert.ok(
        SERVER_JS.includes(importLine),
        `server.js must contain: ${importLine}`,
      );
      const callLine = `${d.importName}(register);`;
      assert.ok(
        SERVER_JS.includes(callLine),
        `server.js must contain: ${callLine}`,
      );
    });
  }
});

describe("previously-orphaned domains register their real macros at runtime", () => {
  for (const d of DOMAINS) {
    it(`${d.domain} registers all expected macros via register(domain, name, fn)`, () => {
      const MACROS = new Map();
      const register = (domain, name, fn) => {
        if (!MACROS.has(domain)) MACROS.set(domain, new Map());
        MACROS.get(domain).set(name, fn);
      };
      d.register(register);
      assert.ok(MACROS.has(d.domain), `expected domain "${d.domain}" to be registered`);
      const names = [...MACROS.get(d.domain).keys()];
      for (const expected of d.expectedMacros) {
        assert.ok(
          names.includes(expected),
          `expected macro "${d.domain}.${expected}", got [${names.join(", ")}]`,
        );
      }
    });
  }
});
