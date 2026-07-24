#!/usr/bin/env node
// scripts/scaffold-plugin.mjs
//
// Plugin scaffolder for THIRD-PARTY plugin authors — the missing
// `create-concord-plugin` equivalent. Before this script, an external
// developer had no way to draft a plugin and check it against
// `validatePlugin(...)` (server/plugins/validator.js's 4-gate static
// validator) without cloning the whole monolith and booting the DB/app.
//
// Mirrors scripts/scaffold-lens.mjs's conventions on purpose (same repo,
// same author expectations): never overwrites, validates its own output,
// prints manual next-steps, supports --root for test isolation.
//
// IMPORTANT — the generated plugin file must contain ZERO `import`/`require`
// statements. Disk-loaded plugins run inside a `vm.SourceTextModule` whose
// linker unconditionally throws on any import (server/lib/plugin-sandbox.js:
// "await mod.link(function () { throw new Error('plugin_imports_not_allowed'); })").
// This is why `manifest.apiVersion` below is a literal string, not an
// `import { CURRENT_API_VERSION } from "../../../lib/plugin-api-version.js"`
// — that import would make the generated plugin fail to load at runtime even
// though `node --check` and `validatePlugin(...)` (a *static* shape/pattern
// check run directly on the imported module, not through the sandbox) would
// both pass it. Don't "fix" this by adding an import.
//
// Usage:
//   node scripts/scaffold-plugin.mjs <plugin-name> ["Display Name"] [options]
//   node scripts/scaffold-plugin.mjs --validate <path-to-plugin-file>
//
//   <plugin-name>    kebab-case, e.g. "weather-tracker" (must match
//                    ^[a-z][a-z0-9-]*$). Becomes both the directory name
//                    under server/plugins/installed/ and the macro-domain
//                    prefix for the generated example macro. The plugin's
//                    `id` export is built as "<namespace>.<plugin-name>"
//                    (default namespace "authored", see --namespace) to
//                    satisfy Gate 1's namespace.name id format.
//   "Display Name"   optional human label; defaults to a title-cased form
//                    of <plugin-name>.
//
// Options:
//   --root <path>       Repo root to operate against. Defaults to the real
//                        repo (one directory up from this script). Tests
//                        MUST pass a temp directory here so the real repo's
//                        server/plugins/installed/ is never touched by a
//                        test run.
//   --namespace <ns>     Override the default "authored" id namespace.
//                        Must not collide with a reserved namespace (see
//                        server/plugins/validator.js RESERVED_NAMESPACES).
//   --dry-run            Print what would be written; touch nothing.
//   --force              Overwrite an existing plugin file for the same
//                        plugin-name. Default: refuse.
//   --validate <path>    Standalone mode: import the plugin module at
//                        <path> directly (no server boot) and run
//                        `validatePlugin(...)`'s 4 static gates against it,
//                        reporting pass/fail per gate. Ignores every other
//                        argument. Exit code 0 if valid, 1 otherwise.
//
// Self-check: after writing the plugin file this script runs `node --check`
// on it AND runs `validatePlugin(...)` against the real imported module
// (an actual dynamic import, not a string-contains check) and reports both
// results. It does not attempt to boot the sandbox (server/lib/
// plugin-sandbox.js) or the full server — that needs a running STATE/DB and
// is out of scope for a standalone scaffolder.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import { validatePlugin, RESERVED_NAMESPACES, ID_PATTERN } from "../server/plugins/validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

const PLUGIN_NAME_RE = /^[a-z][a-z0-9-]*$/;
const NAMESPACE_RE = /^[a-z0-9]+$/;
const DEFAULT_NAMESPACE = "authored";

// ── CLI parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const opts = {
    root: DEFAULT_ROOT,
    dryRun: false,
    force: false,
    namespace: DEFAULT_NAMESPACE,
    validatePath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") { opts.root = path.resolve(argv[++i] || ""); }
    else if (a === "--namespace") { opts.namespace = argv[++i] || ""; }
    else if (a === "--dry-run") { opts.dryRun = true; }
    else if (a === "--force") { opts.force = true; }
    else if (a === "--validate") { opts.validatePath = argv[++i] || ""; }
    else if (a.startsWith("--")) { throw new Error(`unknown option: ${a}`); }
    else positional.push(a);
  }
  const [pluginName, displayNameRaw] = positional;
  return { pluginName, displayNameRaw, ...opts };
}

function usage() {
  return [
    'usage: node scripts/scaffold-plugin.mjs <plugin-name> ["Display Name"] [--root <path>] [--namespace <ns>] [--dry-run] [--force]',
    "       node scripts/scaffold-plugin.mjs --validate <path-to-plugin-file>",
  ].join("\n");
}

function titleCase(kebab) {
  return kebab.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Validation of scaffolder inputs (NOT the same as validatePlugin) ────

function validateInputs({ pluginName, namespace }) {
  const errors = [];
  if (!pluginName || !PLUGIN_NAME_RE.test(pluginName)) {
    errors.push(`plugin-name "${pluginName}" must be kebab-case matching ${PLUGIN_NAME_RE}`);
  }
  if (!namespace || !NAMESPACE_RE.test(namespace)) {
    errors.push(`namespace "${namespace}" must match ${NAMESPACE_RE} (lowercase letters/digits only)`);
  } else if (RESERVED_NAMESPACES.includes(namespace)) {
    errors.push(`namespace "${namespace}" is reserved for core system (${RESERVED_NAMESPACES.join(", ")}) — pick another with --namespace`);
  }
  return errors;
}

// ── Template ─────────────────────────────────────────────────────────────

function pluginFileTemplate({ id, macroDomain, displayName, description }) {
  return `// server/plugins/installed/${macroDomain}/index.js
//
// SCAFFOLDED by scripts/scaffold-plugin.mjs for the "${displayName}" plugin.
//
// The macro below is REAL and working, not a TODO placeholder — a shipped
// macro must never fabricate a success it didn't do (CLAUDE.md's "honest by
// construction" invariant). Replace it with your plugin's real logic.
//
// ── Two different "macros", don't conflate them ──────────────────────────
// 1. The \`macros\` export below is the set of NEW "domain.action" handlers
//    THIS plugin registers (server/plugins/loader.js wires each one into
//    the same macro dispatch every server/domains/*.js file uses).
// 2. \`manifest.macros\` (near the bottom) is a DIFFERENT thing: the
//    allowlist of EXISTING macro patterns (e.g. "dtu.*") this plugin is
//    permitted to invoke via ctx.callMacro. Don't rename one to "fix" the
//    other — they answer different questions ("what do I provide" vs.
//    "what am I allowed to call").
//
// ── Reference docs ────────────────────────────────────────────────────────
//   docs/PLUGIN_AUTHORING_GUIDE.md   — the real ctx surface + shape contract
//   docs/PLUGIN_API_CONTRACT.md      — what manifest.apiVersion means
//   server/plugins/validator.js      — the 4 gates this file must pass
//
// ── No imports, ever ──────────────────────────────────────────────────────
// This file is loaded by reading it as raw text and running it inside a
// \`vm.SourceTextModule\` whose linker rejects ANY import statement
// (server/lib/plugin-sandbox.js). Do not add \`import\`/\`require\` here —
// it will pass \`node --check\` and even \`validatePlugin(...)\` (a static
// check on the already-imported module) but fail to load for real.

export const id = "${id}";
export const name = "${displayName}";
export const version = "1.0.0";
export const description = "${description}";
export const author = "your-name-here";
export const license = "MIT";

/**
 * Called once when the plugin loads. ctx is the sandboxed surface described
 * in docs/PLUGIN_AUTHORING_GUIDE.md §2 — there is no ctx.createDTU / no
 * ctx.schedule / no ambient fetch; everything goes through ctx.callMacro,
 * ctx.store, ctx.log, ctx.getDTU/getDTUCount/getEmergent, ctx.getRateLimit.
 */
export async function init(ctx) {
  ctx.log("info", "${displayName} plugin initialized");
  return { ok: true };
}

/**
 * Called once on unload. This plugin owns no timers/handles to release —
 * ctx.store is torn down by the loader on unload, and periodic work belongs
 * in \`tick\`, not a self-managed setInterval/setTimeout (those identifiers
 * don't exist in a disk-loaded plugin's vm scope at all).
 */
export function destroy() {
  // Nothing to release.
}

export const macros = {
  /**
   * ${macroDomain}.ping — a real, working example macro demonstrating the
   * three ctx methods every non-trivial plugin ends up using:
   *   - ctx.store.get/set  — private, in-memory, per-plugin-instance state
   *                          (NOT persisted across a plugin unload or a
   *                          server restart — an honest limitation, not a
   *                          bug; see docs/PLUGIN_AUTHORING_GUIDE.md §2).
   *   - ctx.callMacro       — invokes an EXISTING macro this plugin has
   *                          declared a grant for in manifest.macros below
   *                          ("discovery.*" is in the default grant every
   *                          non-emergent-gen plugin gets — see
   *                          server/plugins/loader.js DEFAULT_PLUGIN_MACRO_GRANTS).
   *   - ctx.log             — routes to the host's log function, tagged
   *                          plugin.<pluginId>.
   *
   * Invoke manually: POST /api/lens/run
   *   { "domain": "${macroDomain}", "name": "ping", "input": { "message": "hi" } }
   *
   * input: { message? }
   */
  "${macroDomain}.ping": async (ctx, input = {}) => {
    const prevCount = (await ctx.store.get("pingCount")) ?? 0;
    const nextCount = prevCount + 1;
    await ctx.store.set("pingCount", nextCount);

    const facets = await ctx.callMacro("discovery", "facets", {});
    if (!facets?.ok) {
      ctx.log("warn", \`discovery.facets unavailable: \${facets?.error || "unknown"}\`);
    }

    ctx.log("info", \`${displayName} ping #\${nextCount}\`);

    return {
      ok: true,
      count: nextCount,
      echo: typeof input.message === "string" ? input.message.slice(0, 200) : null,
      facetsOk: facets?.ok ?? false,
    };
  },
};

/**
 * Optional: runs every heartbeat while the plugin is loaded. Left as a
 * genuine no-op here (not a TODO) — most plugins don't need periodic work;
 * delete this export entirely if yours doesn't either. If you do need
 * periodic work, self-throttle via ctx.store the way
 * server/plugins/installed/example-knowledge-weather/index.js does — there
 * is no ctx.schedule primitive.
 */
export function tick(_ctx) {
  // Intentionally inert. Keep tick fast (PLUGIN_TICK_TIMEOUT_MS budget) if
  // you add real work here.
}

/**
 * manifest.apiVersion declares which major version of the ctx surface this
 * plugin was written against (server/lib/plugin-api-version.js). Hardcoded
 * as a literal string, NOT imported (see the "No imports, ever" note
 * above) — keep it in sync with CURRENT_API_VERSION by hand if the host
 * surface bumps a major version.
 *
 * manifest.macros is the allowlist of EXISTING macro patterns this plugin
 * may call via ctx.callMacro — distinct from the \`macros\` export above
 * (see the "Two different macros" note at the top of this file).
 */
export const manifest = {
  apiVersion: "1.0.0",
  macros: ["dtu.*", "discovery.*"],
};
`;
}

// ── Safe file writer (matches scaffold-lens.mjs's convention exactly) ────

function writeFileChecked(filePath, content, { dryRun, force }) {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`refusing to overwrite existing file (pass --force to override): ${filePath}`);
  }
  if (dryRun) {
    console.log(`[dry-run] would write ${filePath}:\n${"-".repeat(72)}\n${content}\n${"-".repeat(72)}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`wrote ${filePath}`);
}

function printManualSteps(macroDomain, dirRelPath) {
  console.log(`
── Manual steps this script intentionally does NOT automate ──────────────

1. Replace the "${macroDomain}.ping" example macro with your plugin's real
   logic — it's a real working starting point, not a placeholder to delete
   wholesale.

2. There is no runtime "reload" endpoint today (no /api/plugins/reload) —
   loadPluginsFromDisk() scans server/plugins/installed/ once at boot, so
   you need to restart the server to pick up ${dirRelPath}.

3. Re-run validation any time with:
     node scripts/scaffold-plugin.mjs --validate ${dirRelPath}

4. Read docs/PLUGIN_AUTHORING_GUIDE.md in full before declaring
   manifest.macros beyond the default — the confined runMacro enforces
   your declared grant + a forbidden-domain set (code/repair/admin/config)
   + a per-actor rate cap; anything outside the grant returns an error
   object at call time, it does not throw.
`);
}

// ── --validate mode ──────────────────────────────────────────────────────

async function runValidate(rawPath, root) {
  const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath);
  if (!fs.existsSync(absPath)) {
    console.error(`scaffold-plugin --validate: no such file: ${absPath}`);
    return 1;
  }

  const sourceCode = fs.readFileSync(absPath, "utf8");

  let pluginModule;
  try {
    // Direct dynamic import of the plugin's real exports — no server boot,
    // no DB, no sandbox/vm. This is the same static-shape input
    // validatePlugin expects (a reflected module object), just obtained the
    // cheap way for a standalone CLI instead of via the sandbox's
    // reflection path (server/plugins/loader.js#reflectionModuleFromShape).
    pluginModule = await import(pathToFileURL(absPath).href + `?scaffold-validate=${Date.now()}`);
  } catch (err) {
    console.error(`scaffold-plugin --validate: failed to import ${absPath}:`);
    console.error(err.stack || err.message);
    return 1;
  }

  const result = validatePlugin(pluginModule, { sourceCode, isEmergentGen: false });

  console.log(`\nvalidatePlugin report for ${absPath}\n${"=".repeat(72)}`);
  for (const gate of result.gates) {
    const status = gate.passed ? "PASS" : "FAIL";
    console.log(`[${status}] Gate: ${gate.name}`);
    for (const e of gate.errors) console.log(`         - ${e}`);
  }
  console.log("=".repeat(72));
  console.log(result.valid ? "OVERALL: valid" : "OVERALL: INVALID");

  return result.valid ? 0 : 1;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (args.validatePath !== null) {
    process.exitCode = await runValidate(args.validatePath, args.root);
    return;
  }

  const { pluginName, displayNameRaw, root, dryRun, force, namespace } = args;
  const inputErrors = validateInputs({ pluginName, namespace });
  if (inputErrors.length > 0 || !pluginName) {
    console.error("scaffold-plugin: invalid arguments:");
    for (const e of inputErrors) console.error(`  - ${e}`);
    console.error("");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const displayName = (displayNameRaw && displayNameRaw.trim()) || titleCase(pluginName);
  const id = `${namespace}.${pluginName}`;
  if (!ID_PATTERN.test(id)) {
    // Belt-and-suspenders: should be unreachable given the two regex checks
    // above, but if it ever fails, fail loudly before writing anything.
    console.error(`scaffold-plugin: derived id "${id}" does not match the required namespace.name format ${ID_PATTERN}`);
    process.exitCode = 1;
    return;
  }
  const description = `Scaffolded plugin — replace with a real description of what ${displayName} does.`;

  const pluginDir = path.join(root, "server/plugins/installed", pluginName);
  const pluginFile = path.join(pluginDir, "index.js");
  const dirRelPath = path.relative(root, pluginFile);

  console.log(`scaffold-plugin: root=${root} id=${id} macroDomain=${pluginName} dryRun=${dryRun}`);

  const content = pluginFileTemplate({ id, macroDomain: pluginName, displayName, description });

  try {
    writeFileChecked(pluginFile, content, { dryRun, force });
  } catch (err) {
    console.error(`scaffold-plugin: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (dryRun) return;

  // Self-check 1: syntax.
  try {
    execFileSync(process.execPath, ["--check", pluginFile], { stdio: "pipe" });
    console.log(`self-check: node --check ${pluginFile} — OK`);
  } catch (err) {
    console.error(`self-check FAILED (node --check) for ${pluginFile}:`);
    console.error(err.stderr?.toString() || err.message);
    process.exitCode = 1;
  }

  // Self-check 2: the real 4-gate validator, against the real imported
  // module — not a regex/string-contains proxy for it.
  const validateExit = await runValidate(pluginFile, root);
  if (validateExit !== 0) process.exitCode = 1;

  printManualSteps(pluginName, dirRelPath);
}

main();
