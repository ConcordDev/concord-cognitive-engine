// Shared lens backend scan — extracts domains, REST paths, and (domain, action) pairs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const SERVER = path.join(ROOT, "server");
export const LENSDIR = path.join(ROOT, "concord-frontend/app/lenses");
const FRONTEND = path.join(ROOT, "concord-frontend");

const LENS_RUN_PAIR_RE =
  /\b(?:runDomain|lensRun)(?:<[^>(]*>)?\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]\s*,\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;
const API_HELPERS_RUN_DOMAIN_RE =
  /apiHelpers\.lens\.runDomain\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]\s*,\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;
const LENS_RUN_DYNAMIC_ACTION_RE =
  /\b(?:runDomain|lensRun)(?:<[^>(]*>)?\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]\s*,\s*([a-zA-Z_$][\w$]*)/g;
const MACRO_DOMAIN_RE =
  /\b(?:runDomain|lensRun)(?:<[^>(]*>)?\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;
const GENERIC_HOOK_RE = /useLensData\(|useRunArtifact\(|useLensArtifact\(/;
const API_PATH_RE = /["'`](\/api\/[a-zA-Z0-9/_.\-]*)/g;
const API_CLIENT_RE =
  /\b(?:api|apiClient)\.(?:get|post|put|delete|patch)\(\s*["'`](\/api\/[a-zA-Z0-9/_.\-]*)/g;

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function resolveImport(alias) {
  const rel = alias.replace(/^@\//, "");
  const abs = path.join(FRONTEND, rel);
  const candidates = [`${abs}.tsx`, `${abs}.ts`];
  for (const c of candidates) if (fs.existsSync(c)) return [c];
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(abs, f));
  }
  return [];
}

export function scanFile(src) {
  const calledDomains = new Set();
  const macroActions = [];
  const apiPaths = new Set();
  const seenPairs = new Set();

  for (const m of src.matchAll(LENS_RUN_PAIR_RE)) {
    const domain = m[1];
    const action = m[2];
    const key = `${domain}.${action}`;
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      macroActions.push({ domain, action });
    }
    calledDomains.add(domain);
  }
  for (const m of src.matchAll(API_HELPERS_RUN_DOMAIN_RE)) {
    const domain = m[1];
    const action = m[2];
    const key = `${domain}.${action}`;
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      macroActions.push({ domain, action });
    }
    calledDomains.add(domain);
  }
  for (const m of src.matchAll(LENS_RUN_DYNAMIC_ACTION_RE)) {
    calledDomains.add(m[1]);
  }
  for (const m of src.matchAll(MACRO_DOMAIN_RE)) calledDomains.add(m[1]);
  for (const m of src.matchAll(API_PATH_RE)) apiPaths.add(m[1].replace(/\/+$/, ""));
  for (const m of src.matchAll(API_CLIENT_RE)) apiPaths.add(m[1].replace(/\/+$/, ""));

  return {
    calledDomains,
    macroActions,
    apiPaths,
    usesGeneric: GENERIC_HOOK_RE.test(src),
  };
}

export function scanPageWithChildren(pageSrc) {
  const acc = scanFile(pageSrc);
  for (const m of pageSrc.matchAll(/from\s+["'`](@\/[a-zA-Z0-9/_.\-]+)["'`]/g)) {
    if (!/^@\/components\//.test(m[1])) continue;
    if (/^@\/components\/lens\//.test(m[1])) continue;
    for (const child of resolveImport(m[1])) {
      const cs = scanFile(readIfExists(child));
      for (const d of cs.calledDomains) acc.calledDomains.add(d);
      for (const p of cs.apiPaths) acc.apiPaths.add(p);
      for (const ma of cs.macroActions) {
        const key = `${ma.domain}.${ma.action}`;
        if (!acc.macroActions.some((x) => `${x.domain}.${x.action}` === key)) {
          acc.macroActions.push(ma);
        }
      }
      acc.usesGeneric ||= cs.usesGeneric;
    }
  }
  if (/from\s+["'`]@\/lib\/api\/client["'`]/.test(pageSrc)) acc.usesGeneric = true;
  return acc;
}

export function listLensIds() {
  return fs
    .readdirSync(LENSDIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("["))
    .filter((e) => fs.existsSync(path.join(LENSDIR, e.name, "page.tsx")))
    .map((e) => e.name)
    .sort();
}

export function scanLens(lensId) {
  const pf = path.join(LENSDIR, lensId, "page.tsx");
  if (!fs.existsSync(pf)) {
    return {
      lensId,
      hasPage: false,
      calledDomains: new Set(),
      macroActions: [],
      apiPaths: new Set(),
      usesGeneric: false,
    };
  }
  const src = fs.readFileSync(pf, "utf8");
  const scan = scanPageWithChildren(src);
  return { lensId, hasPage: true, ...scan };
}

export function collectMacroDomains() {
  const serverFiles = walkJs(SERVER);
  const macroDomains = new Set();
  for (const f of serverFiles) {
    const src = fs.readFileSync(f, "utf8");
    const aliases = new Set(["register", "registerLensAction"]);
    for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) {
      aliases.add(m[1]);
    }
    const aliasRe = new RegExp(
      String.raw`\b(?:` + [...aliases].join("|") + String.raw`)\(\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]\s*,\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]`,
      "g",
    );
    let m;
    while ((m = aliasRe.exec(src))) macroDomains.add(m[1]);
  }
  return macroDomains;
}

function walkJs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "tests", "test"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, acc);
    else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}
