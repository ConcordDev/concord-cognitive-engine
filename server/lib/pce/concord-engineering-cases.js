// server/lib/pce/concord-engineering-cases.js
//
// Concord engineering surface benchmarks — macro, migration, detector, lens, MCP, schema, organs.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveConcordRoot } from "./concord-bench-cases.js";

function setupMiniConcord(dir) {
  mkdirSync(join(dir, "server", "lib"), { recursive: true });
  mkdirSync(join(dir, "server", "tests", "depth"), { recursive: true });
  mkdirSync(join(dir, "server", "migrations"), { recursive: true });
  mkdirSync(join(dir, "server", "domains"), { recursive: true });
  writeFileSync(join(dir, "server", "lib", "sample.js"), `export function compute(x) { return x + 1; }\n`);
  writeFileSync(join(dir, "server", "tests", "depth", "sample-behavior.test.js"), `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../../lib/sample.js";
describe("sample", () => { it("works", () => assert.equal(compute(2), 3)); });
`);
  return dir;
}

export const ENGINEERING_BENCH_CASES = Object.freeze([
  {
    id: "eng_macro_registration_surface",
    category: "macro_registration",
    description: "Real tree has register/registerLensAction macro registration patterns",
    readOnly: true,
    async run({ concordRoot }) {
      const domainsDir = join(concordRoot, "server", "domains");
      const indexPath = join(domainsDir, "index.js");
      if (!existsSync(indexPath)) return { ok: false, reason: "domains_index_missing" };
      const idx = readFileSync(indexPath, "utf8");
      const domainFiles = readdirSync(domainsDir).filter((f) => f.endsWith(".js") && f !== "index.js");
      const hasDila = domainFiles.includes("dila.js") && idx.includes("dila");
      const registerHits = (idx.match(/register\w*\(/g) || []).length;
      return { ok: hasDila && registerHits >= 3, domainCount: domainFiles.length, registerHits };
    },
  },
  {
    id: "eng_lens_action_pattern",
    category: "macro_registration",
    description: "Dila domain uses registerLensAction for lens macros",
    readOnly: true,
    async run({ concordRoot }) {
      const p = join(concordRoot, "server", "domains", "dila.js");
      if (!existsSync(p)) return { ok: false, reason: "missing_dila" };
      const src = readFileSync(p, "utf8");
      const count = (src.match(/registerLensAction\(/g) || []).length;
      return { ok: count >= 8, macroCount: count };
    },
  },
  {
    id: "eng_migration_convention",
    category: "migrations",
    description: "Migrations follow NNN_name.js numbering with export function up",
    readOnly: true,
    async run({ concordRoot }) {
      const migDir = join(concordRoot, "server", "migrations");
      const files = readdirSync(migDir).filter((f) => /^\d{3}_/.test(f) && f.endsWith(".js"));
      let valid = 0;
      for (const f of files.slice(-5)) {
        const content = readFileSync(join(migDir, f), "utf8");
        if (/export function up\s*\(/.test(content)) valid += 1;
      }
      return { ok: files.length >= 400 && valid >= 3, total: files.length, sampledValid: valid };
    },
  },
  {
    id: "eng_migration_authoring_sandbox",
    category: "migrations",
    description: "PCE authors valid migration in sandbox",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const migPath = "server/migrations/434_test_column.js";
      const { executePceTask } = await import("./pce-engine.js");
      await executePceTask({
        db, repoRoot: dir, intent: "add migration column",
        manualSteps: [{
          primitive: "CREATE_FILE",
          args: {
            filePath: migPath,
            content: `export function up(db) {\n  db.exec(\`ALTER TABLE items ADD COLUMN qty INTEGER DEFAULT 0\`);\n}\n`,
          },
        }],
      });
      const content = readFileSync(join(dir, migPath), "utf8");
      return { ok: content.includes("export function up") && content.includes("db.exec") };
    },
  },
  {
    id: "eng_detector_gate_exists",
    category: "detector_compliance",
    description: "Detector suite and CI baseline exist",
    readOnly: true,
    async run({ concordRoot }) {
      const detectorScript = join(concordRoot, "server", "scripts", "run-detectors.js");
      const baseline = join(concordRoot, "audit", "detectors", "BASELINE.json");
      return {
        ok: existsSync(detectorScript) && existsSync(baseline),
        hasScript: existsSync(detectorScript),
        hasBaseline: existsSync(baseline),
      };
    },
  },
  {
    id: "eng_honesty_detector_present",
    category: "detector_compliance",
    description: "Frontend fake-data detector exists for zero-demo invariant",
    readOnly: true,
    async run({ concordRoot }) {
      const p = join(concordRoot, "server", "lib", "detectors", "frontend-fake-data-detector.js");
      return { ok: existsSync(p) };
    },
  },
  {
    id: "eng_lens_wiring_verifier",
    category: "lens_wiring",
    description: "Lens backend wiring verifier script exists",
    readOnly: true,
    async run({ concordRoot }) {
      const p = join(concordRoot, "scripts", "verify-lens-backends.mjs");
      return { ok: existsSync(p) };
    },
  },
  {
    id: "eng_dila_domain_registered",
    category: "lens_wiring",
    description: "Dila domain is registered in domains index",
    readOnly: true,
    async run({ concordRoot }) {
      const idx = readFileSync(join(concordRoot, "server", "domains", "index.js"), "utf8");
      return { ok: idx.includes("dila") && existsSync(join(concordRoot, "server", "domains", "dila.js")) };
    },
  },
  {
    id: "eng_mcp_tools_surface",
    category: "mcp_tools",
    description: "MCP server and tools modules exist with tool registration",
    readOnly: true,
    async run({ concordRoot }) {
      const tools = join(concordRoot, "server", "lib", "mcp-tools.js");
      const server = join(concordRoot, "server", "lib", "mcp-server.js");
      if (!existsSync(tools) || !existsSync(server)) return { ok: false };
      const src = readFileSync(tools, "utf8");
      const toolDefs = (src.match(/name:\s*["']/g) || []).length;
      return { ok: toolDefs >= 5, toolDefs };
    },
  },
  {
    id: "eng_mcp_internal_tools_mission",
    category: "mcp_tools",
    description: "Mission runtime internal tools include PCE bench tools",
    readOnly: true,
    async run() {
      const { INTERNAL_RUNTIME_TOOLS } = await import("../mission-templates.js");
      const required = ["pce_execute", "concord_bench_run", "pce_excellence_run", "pce_improvement_run"];
      const missing = required.filter((t) => !INTERNAL_RUNTIME_TOOLS.has(t));
      return { ok: missing.length === 0, missing };
    },
  },
  {
    id: "eng_schema_pce_tables",
    category: "db_schema",
    description: "PCE substrate migrations define pattern and metrics tables",
    readOnly: true,
    async run({ concordRoot }) {
      const m431 = readFileSync(join(concordRoot, "server", "migrations", "431_pce_substrate.js"), "utf8");
      const m432 = readFileSync(join(concordRoot, "server", "migrations", "432_pce_metrics.js"), "utf8");
      return {
        ok: m431.includes("pce_patterns") && m431.includes("pce_failure_signatures")
          && m432.includes("pce_metrics"),
      };
    },
  },
  {
    id: "eng_cross_organ_mission_runtime",
    category: "cross_organ",
    description: "Mission runtime dispatches through F0 auth-gate",
    readOnly: true,
    async run({ concordRoot }) {
      const rt = readFileSync(join(concordRoot, "server", "lib", "mission-runtime.js"), "utf8");
      const cycle = readFileSync(join(concordRoot, "server", "emergent", "mission-runtime-cycle.js"), "utf8");
      return {
        ok: rt.includes("dispatchMCP") && cycle.includes("dispatchMCP"),
      };
    },
  },
  {
    id: "eng_failure_recovery_module",
    category: "failure_recovery",
    description: "Recovery module supports mission retry escalation",
    readOnly: true,
    async run({ concordRoot }) {
      const p = join(concordRoot, "server", "lib", "runtime", "recovery.js");
      if (!existsSync(p)) return { ok: false };
      const src = readFileSync(p, "utf8");
      return {
        ok: src.includes("applyMissionRecovery") && src.includes("escalat"),
      };
    },
  },
  {
    id: "eng_recovery_sandbox_retry",
    category: "failure_recovery",
    description: "PCE recovers after failed transform with valid retry",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const fail = await executePceTask({
        db, repoRoot: dir, intent: "break syntax",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "export function compute",
            replace: "export function compute",
          },
        }],
      });
      const ok = await executePceTask({
        db, repoRoot: dir, intent: "fix compute",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "return x + 1;",
            replace: "return x + 2;",
          },
        }],
      });
      const content = readFileSync(join(dir, "server", "lib", "sample.js"), "utf8");
      return { ok: fail.ok === false && ok.ok === true && content.includes("x + 2") };
    },
  },
  {
    id: "eng_multi_file_change",
    category: "multi_file",
    description: "PCE applies coordinated multi-file changes in sandbox",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      writeFileSync(join(dir, "server", "lib", "util.js"), `export const VERSION = 1;\n`);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "multi file version bump",
        manualSteps: [
          {
            primitive: "SEARCH_REPLACE",
            args: {
              filePath: "server/lib/util.js",
              search: "export const VERSION = 1;",
              replace: "export const VERSION = 2;",
            },
          },
          {
            primitive: "SEARCH_REPLACE",
            args: {
              filePath: "server/lib/sample.js",
              search: "export function compute(x) { return x + 1; }",
              replace: "import { VERSION } from './util.js';\nexport function compute(x) { return x + VERSION; }",
            },
          },
        ],
      });
      const util = readFileSync(join(dir, "server", "lib", "util.js"), "utf8");
      const sample = readFileSync(join(dir, "server", "lib", "sample.js"), "utf8");
      return {
        ok: util.includes("VERSION = 2") && sample.includes("import { VERSION }"),
        filesChanged: r.changedFiles?.length,
      };
    },
  },
  {
    id: "eng_domain_macro_sandbox",
    category: "macro_registration",
    description: "Sandbox domain file follows registerLensAction pattern",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const domainPath = "server/domains/widget.js";
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "register lens action in domain",
        manualSteps: [{
          primitive: "CREATE_FILE",
          args: {
            filePath: domainPath,
            content: `export default function registerWidget(registerLensAction) {
  registerLensAction("widget", "ping", async () => ({ ok: true, pong: true }));
}\n`,
          },
        }],
      });
      const content = readFileSync(join(dir, domainPath), "utf8");
      return { ok: content.includes("registerLensAction") && r.changedFiles?.includes(domainPath) };
    },
  },
]);

export const ENGINEERING_CATEGORIES = Object.freeze([
  "macro_registration",
  "migrations",
  "detector_compliance",
  "lens_wiring",
  "mcp_tools",
  "db_schema",
  "cross_organ",
  "failure_recovery",
  "multi_file",
]);
