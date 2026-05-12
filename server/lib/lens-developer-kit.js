// @sync-fs-ok: lens scaffolding tool used at dev/build time only
/**
 * Lens Developer Kit (LDK) — Core Library
 *
 * Provides the programmatic backbone for creating, validating, linting,
 * and publishing new lenses into the Concord cognitive architecture.
 *
 * Exports:
 *   generateLensTemplate(config)  — scaffold domain handler + frontend page from a config
 *   validateLens(domainHandler)   — verify handler exports required functions
 *   lintLens(handlerCode)         — static quality checks for stubs, TODOs, empty bodies
 *   publishLens(lensData)         — register a new lens in ALL_LENS_DOMAINS + write handler file
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Template Registry ───────────────────────────────────────────────────────

const TEMPLATE_DIR = path.join(__dirname, "lens-templates");
let _templateCache = null;

/**
 * Load all available lens templates from the lens-templates/ directory.
 * Templates must export: id, name, description, category, tags, generate().
 */
export async function loadTemplates() {
  if (_templateCache) return _templateCache;

  _templateCache = new Map();
  try {
    const files = fs.readdirSync(TEMPLATE_DIR).filter(f => f.endsWith(".js"));
    for (const file of files) {
      try {
        const mod = await import(path.join(TEMPLATE_DIR, file));
        const tmpl = mod.default || mod;
        if (tmpl.id && tmpl.generate) {
          _templateCache.set(tmpl.id, {
            id: tmpl.id,
            name: tmpl.name || tmpl.id,
            description: tmpl.description || "",
            category: tmpl.category || "general",
            tags: tmpl.tags || [],
            generate: tmpl.generate,
          });
        }
      } catch (err) {
        // Skip malformed templates
      }
    }
  } catch {
    // Template directory may not exist yet
  }
  return _templateCache;
}

/**
 * Bust the template cache so freshly added templates are picked up.
 */
export function clearTemplateCache() {
  _templateCache = null;
}

// ── Generate Lens Template ──────────────────────────────────────────────────

/**
 * Generate a lens template (domain handler code + frontend page) from config.
 *
 * @param {object} config
 * @param {string} config.domain       — Lens domain ID (e.g. "inventory")
 * @param {string} [config.template]   — Template ID to use (default "basic-crud")
 * @param {string} [config.entityName] — Entity name for CRUD templates
 * @param {string[]} [config.fields]   — Entity fields
 * @param {string[]} [config.actions]  — Custom action names
 * @param {object} [config.options]    — Template-specific options
 * @returns {Promise<{ok: boolean, handler: string, page: string, template: string, domain: string}>}
 */
export async function generateLensTemplate(config) {
  if (!config || !config.domain) {
    return { ok: false, error: "config.domain is required" };
  }

  const domain = config.domain.toLowerCase().replace(/\s+/g, "-");
  const templateId = config.template || "basic-crud";
  const templates = await loadTemplates();
  const tmpl = templates.get(templateId);

  if (!tmpl) {
    return {
      ok: false,
      error: `Template "${templateId}" not found. Available: ${[...templates.keys()].join(", ")}`,
    };
  }

  try {
    const result = tmpl.generate({
      domain,
      entityName: config.entityName || pascal(domain),
      fields: config.fields,
      actions: config.actions,
      ...config.options,
    });

    return {
      ok: true,
      handler: result.handler,
      page: result.page,
      template: templateId,
      domain,
      templateMeta: {
        name: tmpl.name,
        category: tmpl.category,
        tags: tmpl.tags,
      },
    };
  } catch (err) {
    return { ok: false, error: `Template generation failed: ${err.message}` };
  }
}

// ── Validate Lens ───────────────────────────────────────────────────────────

/**
 * Validate a domain handler module to ensure it exports the required interface.
 *
 * A valid domain handler must:
 *   1. Export a default function (the register function)
 *   2. The register function must accept `registerLensAction` as its first argument
 *   3. When called, it must invoke registerLensAction at least once
 *
 * @param {object|function} domainHandler — The module or default export to validate
 * @returns {{ok: boolean, errors: string[], warnings: string[], info: object}}
 */
export function validateLens(domainHandler) {
  const errors = [];
  const warnings = [];
  const info = { actionsRegistered: 0, domains: new Set(), actionNames: [] };

  // Unwrap default export if needed
  const handler = domainHandler?.default || domainHandler;

  // Check 1: must be a function
  if (typeof handler !== "function") {
    errors.push("Domain handler must export a default function: export default function registerXActions(registerLensAction) { ... }");
    return { ok: false, errors, warnings, info: {} };
  }

  // Check 2: function should accept at least one argument (registerLensAction)
  if (handler.length < 1) {
    warnings.push("Register function accepts no arguments — it should accept (registerLensAction) as its first parameter.");
  }

  // Check 3: call the handler with a mock registerLensAction to verify it registers actions
  try {
    const probeRegister = (domain, action, fn) => {
      info.actionsRegistered++;
      info.domains.add(domain);
      info.actionNames.push(`${domain}.${action}`);

      if (typeof fn !== "function") {
        errors.push(`Action "${domain}.${action}" handler is not a function (got ${typeof fn}).`);
      }
    };

    handler(probeRegister);
  } catch (err) {
    errors.push(`Handler threw during registration: ${err.message}`);
    return { ok: errors.length === 0, errors, warnings, info: serializeInfo(info) };
  }

  // Check 4: must register at least one action
  if (info.actionsRegistered === 0) {
    errors.push("Handler did not call registerLensAction() — no actions were registered.");
  }

  // Check 5: warn if multiple domains are used (unusual for a single handler)
  if (info.domains.size > 1) {
    warnings.push(`Handler registers actions across ${info.domains.size} domains: ${[...info.domains].join(", ")}. Typically a handler registers for a single domain.`);
  }

  return { ok: errors.length === 0, errors, warnings, info: serializeInfo(info) };
}

function serializeInfo(info) {
  return {
    actionsRegistered: info.actionsRegistered,
    domains: [...info.domains],
    actionNames: info.actionNames,
  };
}

// ── Lint Lens ───────────────────────────────────────────────────────────────

/**
 * Lint a lens handler's source code for quality issues:
 *   - Stub patterns (console.log only, no return)
 *   - Empty function bodies
 *   - TODO/FIXME/HACK/XXX placeholders
 *   - Missing error handling
 *   - Hardcoded credentials or secrets
 *
 * @param {string} handlerCode — The JavaScript source code of the handler
 * @returns {{ok: boolean, issues: Array<{severity: string, message: string, line?: number}>, score: number}}
 */
export function lintLens(handlerCode) {
  if (!handlerCode || typeof handlerCode !== "string") {
    return { ok: false, issues: [{ severity: "error", message: "No handler code provided." }], score: 0 };
  }

  const issues = [];
  const lines = handlerCode.split("\n");

  // Pattern checks per line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // @fake-data-ok: this is the linter rule that warns when developer
    // lens code contains TODO/FIXME/HACK/XXX placeholders — same pattern
    // family the fake-data detector scans for.
    if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(trimmed)) {
      issues.push({ severity: "warning", message: `Placeholder comment found: "${trimmed.slice(0, 80)}"`, line: lineNum });
    }

    // console.log as sole statement in a handler body (stub pattern)
    if (/^\s*console\.(log|warn|info|debug)\(/.test(line) && !trimmed.startsWith("//")) {
      issues.push({ severity: "info", message: `Console statement found — remove before production.`, line: lineNum });
    }

    // Hardcoded secrets
    if (/(?:password|secret|apiKey|api_key|token)\s*[:=]\s*["'][^"']{4,}["']/i.test(trimmed)) {
      issues.push({ severity: "error", message: `Potential hardcoded secret detected.`, line: lineNum });
    }

    // Return value is just a literal string (lazy stub)
    if (/return\s+["'].*["']\s*;?\s*$/.test(trimmed) && !/return\s+["']use/.test(trimmed)) {
      issues.push({ severity: "warning", message: `Action returns a plain string literal — should return { ok, result }.`, line: lineNum });
    }
  }

  // Structural checks on the full source

  // Empty function bodies: () => {} or function() {}
  const emptyFnPattern = /(?:=>|\))\s*\{\s*\}/g;
  let emptyMatch;
  while ((emptyMatch = emptyFnPattern.exec(handlerCode)) !== null) {
    const beforeEmpty = handlerCode.slice(0, emptyMatch.index);
    const emptyLine = beforeEmpty.split("\n").length;
    issues.push({ severity: "warning", message: "Empty function body detected — likely a stub.", line: emptyLine });
  }

  // Console-only handlers: registerLensAction callbacks that only have console.log
  const actionPattern = /registerLensAction\([^)]+,\s*\([^)]*\)\s*=>\s*\{([^}]*)\}/g;
  let actionMatch;
  while ((actionMatch = actionPattern.exec(handlerCode)) !== null) {
    const body = actionMatch[1].trim();
    if (body && /^console\.\w+\(/.test(body) && body.split("\n").filter(l => l.trim() && !l.trim().startsWith("//")).length <= 2) {
      const beforeAction = handlerCode.slice(0, actionMatch.index);
      const actionLine = beforeAction.split("\n").length;
      issues.push({ severity: "warning", message: "Action handler body is console-only — this is a stub.", line: actionLine });
    }
  }

  // Missing { ok: ... } return pattern — actions should return structured results
  const registerBlocks = handlerCode.match(/registerLensAction\(/g) || [];
  const okReturns = handlerCode.match(/return\s*\{[^}]*ok\s*:/g) || [];
  if (registerBlocks.length > 0 && okReturns.length === 0) {
    issues.push({ severity: "warning", message: "No action returns { ok: ... } — handlers should return structured results." });
  }

  // Missing export default
  if (!/export\s+default\s+function/.test(handlerCode)) {
    issues.push({ severity: "error", message: "Missing 'export default function' — domain handlers must use a default export." });
  }

  // Score: 100 minus deductions
  const errorWeight = 15;
  const warningWeight = 5;
  const infoWeight = 1;
  const deductions =
    issues.filter(i => i.severity === "error").length * errorWeight +
    issues.filter(i => i.severity === "warning").length * warningWeight +
    issues.filter(i => i.severity === "info").length * infoWeight;

  const score = Math.max(0, Math.min(100, 100 - deductions));

  return {
    ok: issues.filter(i => i.severity === "error").length === 0,
    issues,
    score,
    summary: {
      errors: issues.filter(i => i.severity === "error").length,
      warnings: issues.filter(i => i.severity === "warning").length,
      info: issues.filter(i => i.severity === "info").length,
      totalLines: lines.length,
      actionCount: registerBlocks.length,
    },
  };
}

// ── Publish Lens ────────────────────────────────────────────────────────────

/**
 * Publish a new lens: write the domain handler file and register the domain.
 *
 * This function:
 *   1. Validates the handler code via lintLens
 *   2. Writes the handler to server/domains/<domain>.js
 *   3. Returns registration instructions (the caller in server.js actually
 *      pushes into ALL_LENS_DOMAINS and calls registerLensAction at runtime)
 *
 * @param {object} lensData
 * @param {string} lensData.domain       — Domain ID (e.g. "inventory")
 * @param {string} lensData.handler      — Full handler source code
 * @param {string} [lensData.page]       — Frontend page source code
 * @param {string} [lensData.description]— Human description
 * @param {string[]} [lensData.tags]     — Domain tags for routing
 * @param {string} [lensData.category]   — Lens category
 * @returns {{ok: boolean, domain: string, handlerPath: string, pagePath?: string, lint: object}}
 */
export function publishLens(lensData) {
  if (!lensData || !lensData.domain) {
    return { ok: false, error: "lensData.domain is required" };
  }
  if (!lensData.handler) {
    return { ok: false, error: "lensData.handler (source code) is required" };
  }

  const domain = lensData.domain.toLowerCase().replace(/\s+/g, "-");

  // Lint check before writing
  const lintResult = lintLens(lensData.handler);
  if (lintResult.issues.some(i => i.severity === "error")) {
    return {
      ok: false,
      error: "Handler has lint errors that must be fixed before publishing.",
      lint: lintResult,
    };
  }

  // Determine file paths
  const domainsDir = path.join(__dirname, "..", "domains");
  const handlerPath = path.join(domainsDir, `${domain}.js`);

  // Safety: refuse to overwrite existing built-in handlers
  if (fs.existsSync(handlerPath)) {
    return { ok: false, error: `Domain handler already exists at ${handlerPath}. Use a unique domain name or remove the existing handler first.` };
  }

  // Write the domain handler
  try {
    fs.writeFileSync(handlerPath, lensData.handler, "utf-8");
  } catch (err) {
    return { ok: false, error: `Failed to write handler file: ${err.message}` };
  }

  // Optionally write the frontend page
  let pagePath = null;
  if (lensData.page) {
    const pagesDir = path.resolve(__dirname, "..", "..", "app", "lenses", domain);
    try {
      fs.mkdirSync(pagesDir, { recursive: true });
      pagePath = path.join(pagesDir, "page.tsx");
      fs.writeFileSync(pagePath, lensData.page, "utf-8");
    } catch (err) {
      // Non-fatal: handler was written, page failed
      pagePath = null;
    }
  }

  return {
    ok: true,
    domain,
    handlerPath,
    pagePath,
    lint: lintResult,
    manifest: {
      lensId: domain,
      domain,
      description: lensData.description || `${pascal(domain)} lens`,
      tags: lensData.tags || [],
      category: lensData.category || "user-created",
      source: "user",
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert kebab-case to PascalCase */
function pascal(str) {
  return str.replace(/(^|[-_])(\w)/g, (_, _sep, c) => c.toUpperCase());
}

export default {
  generateLensTemplate,
  validateLens,
  lintLens,
  publishLens,
  loadTemplates,
  clearTemplateCache,
};
