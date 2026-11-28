#!/usr/bin/env node
// scripts/walk/run-check.mjs — run check specs (scripts/walk/check-spec.mjs) on a live site.
//
//   node scripts/walk/run-check.mjs <spec.json | dir> [--base https://concord-os.org]
//        [--out audit/walk/results.jsonl] [--shots audit/walk/shots] [--headed]
//
// Accounts come from the environment, never from a spec:
//   CONCORD_WALK_MEMBER_USER / CONCORD_WALK_MEMBER_PASS   (and MEMBER2, ADMIN)
// "anon" runs signed out. A spec whose account has no credentials is ERROR, not a pass.
//
// Each spec gives one result line (appended to --out, printed to stdout):
//   { type:"check_result", id, lens, ticket, verdict:"PASS"|"FAIL"|"ERROR", why, base, path,
//     account, viewport, steps:[{i,do,ok,error?}], expect:[{i,kind,ok,detail}],
//     consoleErrors:[...], screenshot, startedAt, durationMs }
// Exit code: 0 all pass, 1 any FAIL, 2 any ERROR or invalid spec.
//
// Read-only by intent: specs may click and fill, so point them at fixture accounts and fixture
// data, the same rule the human walks follow.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSpec, VIEWPORTS } from "./check-spec.mjs";

const DEFAULT_TIMEOUT = 8000;

function arg(name, dflt) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; }

export function credentialsFor(account, env = process.env) {
  if (account === "anon") return null;
  const k = account.toUpperCase();
  const user = env[`CONCORD_WALK_${k}_USER`], pass = env[`CONCORD_WALK_${k}_PASS`];
  if (!user || !pass) return { missing: `CONCORD_WALK_${k}_USER / CONCORD_WALK_${k}_PASS` };
  return { user, pass };
}

function locate(page, t) {
  let loc;
  if (t.role) loc = page.getByRole(t.role, t.name !== undefined ? { name: t.name, exact: t.match !== "contains" } : {});
  else if (t.label) loc = page.getByLabel(t.label, { exact: t.match !== "contains" });
  else if (t.text) loc = page.getByText(t.text, { exact: t.match === "exact" });
  else loc = page.getByTestId(t.testId);
  return Number.isInteger(t.nth) ? loc.nth(t.nth) : loc.first();
}
const describe = (t) => (t.role ? `${t.role}${t.name !== undefined ? ` "${t.name}"` : ""}` : t.label ? `label "${t.label}"` : t.text ? `text "${t.text}"` : `testId ${t.testId}`);

// WCAG 2.x relative luminance and contrast, compositing translucent layers over what is behind them.
export const CONTRAST_JS = `(el) => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }; return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const layers = []; let image = false;
  for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage && s.backgroundImage !== "none") image = true; const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
  const s = getComputedStyle(el); let fg = parse(s.color) || { r: 0, g: 0, b: 0, a: 1 }; fg = over({ ...fg, a: fg.a * Number(s.opacity || 1) }, bg);
  const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  return { ratio: Math.round(ratio * 100) / 100, fg: s.color, bg: \`rgb(\${Math.round(bg.r)}, \${Math.round(bg.g)}, \${Math.round(bg.b)})\`, image };
}`;

// null when the element is what sits under its centre point; otherwise a short description of the cover.
const COVER_JS = (el) => {
  el.scrollIntoView({ block: "center", inline: "center" });
  const b = el.getBoundingClientRect();
  const x = Math.min(Math.max(b.left + b.width / 2, 0), window.innerWidth - 1), y = Math.min(Math.max(b.top + b.height / 2, 0), window.innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  if (!hit || el === hit || el.contains(hit) || hit.contains(el)) return null;
  const name = (n) => `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${n.getAttribute("data-testid") ? `[data-testid=${n.getAttribute("data-testid")}]` : ""}${n.getAttribute("aria-label") ? `[aria-label="${n.getAttribute("aria-label").slice(0, 40)}"]` : ""}`;
  let top = hit; while (top.parentElement && top.parentElement !== document.body && getComputedStyle(top).position === "static") top = top.parentElement;
  return name(top === hit ? hit : top);
};

async function signIn(context, base, creds) {
  // the login route validates `email` as an address: send whichever the account is
  const who = creds.user.includes("@") ? { email: creds.user } : { username: creds.user };
  const r = await context.request.post(`${base}/api/auth/login`, { data: { ...who, password: creds.pass }, failOnStatusCode: false });
  if (r.status() >= 400) throw new Error(`sign-in failed: HTTP ${r.status()}`);
}

/** Run one validated spec. `browser` is a Playwright browser; nothing global is touched. */
export async function runSpec(spec, { browser, base, shotsDir = null, env = process.env, userAgent } = {}) {
  const started = Date.now();
  const out = { type: "check_result", id: spec.id, lens: spec.lens, ticket: spec.ticket || null, verdict: "ERROR", why: spec.why, base, path: spec.path, account: spec.account, viewport: spec.viewport, steps: [], expect: [], consoleErrors: [], screenshot: null, startedAt: new Date(started).toISOString(), durationMs: 0 };
  const v = validateSpec(spec);
  if (!v.ok) { out.error = `invalid spec: ${v.errors.join("; ")}`; out.durationMs = Date.now() - started; return out; }
  const creds = credentialsFor(spec.account, env);
  if (creds?.missing) { out.error = `no credentials for account "${spec.account}" (set ${creds.missing})`; out.durationMs = Date.now() - started; return out; }
  const context = await browser.newContext({ viewport: VIEWPORTS[spec.viewport], acceptDownloads: true, ...(userAgent ? { userAgent } : {}) });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") out.consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => out.consoleErrors.push(`uncaught: ${String(e?.message || e).slice(0, 300)}`));
  let lastDownload = null;
  page.on("download", (d) => { lastDownload = d; });
  try {
    if (creds) await signIn(context, base, creds);
    await page.goto(`${base}${spec.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    let stepFailed = false;
    for (const [i, s] of spec.steps.entries()) {
      const rec = { i, do: s.do, ok: false };
      try {
        if (s.do === "goto") await page.goto(`${base}${s.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        else if (s.do === "click") await locate(page, s.target).click({ timeout: DEFAULT_TIMEOUT });
        else if (s.do === "fill") await locate(page, s.target).fill(s.value, { timeout: DEFAULT_TIMEOUT });
        else if (s.do === "select") await locate(page, s.target).selectOption(s.value, { timeout: DEFAULT_TIMEOUT });
        else if (s.do === "press") { if (s.target) await locate(page, s.target).press(s.key, { timeout: DEFAULT_TIMEOUT }); else await page.keyboard.press(s.key); }
        else if (s.do === "wait") await locate(page, s.for).waitFor({ state: "visible", timeout: s.timeoutMs || DEFAULT_TIMEOUT });
        else if (s.do === "scroll") await locate(page, s.target).scrollIntoViewIfNeeded({ timeout: DEFAULT_TIMEOUT });
        rec.ok = true;
      } catch (e) { rec.error = String(e?.message || e).split("\n")[0].slice(0, 240); stepFailed = true; }
      out.steps.push(rec);
      if (stepFailed) break;
    }
    // a step that cannot be done is a FAIL of the check (the person could not do it either)
    for (const [i, e] of spec.expect.entries()) {
      const kind = Object.keys(e)[0]; const a = e[kind];
      const rec = { i, kind, ok: false, detail: "" };
      try {
        if (stepFailed) { rec.detail = "not checked: a step failed"; out.expect.push(rec); continue; }
        if (kind === "visible") {
          // "visible" means a person can see it: rendered AND not covered (a splash, a sticky bar, a
          // floating button). Playwright's own visibility ignores what is drawn on top, so check the
          // element is what sits under its centre, waiting for a cover that clears (a boot splash).
          // Limit: this is a hit test, so a see-through overlay that ignores the pointer
          // (pointer-events: none, e.g. a fading splash) is not seen as a cover.
          const loc = locate(page, a.target);
          const shown = await loc.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT }).then(() => true, () => false);
          if (!shown) rec.detail = `${describe(a.target)} not visible`;
          else {
            const deadline = Date.now() + DEFAULT_TIMEOUT; let cover = null;
            for (;;) {
              cover = await loc.evaluate(COVER_JS).catch(() => "could not test");
              if (!cover || Date.now() > deadline) break;
              await page.waitForTimeout(250);
            }
            rec.ok = !cover; rec.detail = cover ? `${describe(a.target)} is covered by ${cover}` : "";
          }
        }
        else if (kind === "hidden") { await locate(page, a.target).waitFor({ state: "hidden", timeout: DEFAULT_TIMEOUT }).then(() => { rec.ok = true; }, () => { rec.detail = `${describe(a.target)} still visible`; }); }
        else if (kind === "text") {
          const t = ((await locate(page, a.target).textContent({ timeout: DEFAULT_TIMEOUT })) || "").replace(/\s+/g, " ").trim();
          rec.ok = a.equals !== undefined ? t === a.equals : a.contains !== undefined ? t.includes(a.contains) : new RegExp(a.matches).test(t);
          rec.detail = `text: "${t.slice(0, 160)}"`;
        } else if (kind === "count") {
          const t = a.target; const base_ = t.role ? page.getByRole(t.role, t.name !== undefined ? { name: t.name, exact: t.match !== "contains" } : {}) : t.label ? page.getByLabel(t.label) : t.text ? page.getByText(t.text, { exact: t.match === "exact" }) : page.getByTestId(t.testId);
          const n = await base_.count();
          rec.ok = (a.eq === undefined || n === a.eq) && (a.min === undefined || n >= a.min) && (a.max === undefined || n <= a.max);
          rec.detail = `count ${n}`;
        } else if (kind === "url") { const u = page.url(); rec.ok = new RegExp(a.matches).test(u); rec.detail = u; }
        else if (kind === "download") {
          if (!lastDownload) rec.detail = "no download started";
          else {
            const name = lastDownload.suggestedFilename(); rec.detail = name;
            rec.ok = name.toLowerCase().endsWith(a.ext.toLowerCase());
            if (rec.ok && a.contains !== undefined) { const p = await lastDownload.path(); const body = p ? fs.readFileSync(p, "utf8") : ""; rec.ok = body.includes(a.contains); rec.detail += rec.ok ? "" : ` (does not contain "${a.contains}")`; }
          }
        } else if (kind === "focusInside") { rec.ok = await locate(page, a.target).evaluate((el) => el.contains(document.activeElement)); rec.detail = rec.ok ? "" : "focus is outside"; }
        else if (kind === "noHorizontalScroll") {
          const r = await page.evaluate(() => { const w = window.innerWidth; const wide = [...document.querySelectorAll("body *")].filter((el) => { const b = el.getBoundingClientRect(); return b.right > w + 1 && b.width > 0 && getComputedStyle(el).position !== "fixed"; }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.getAttribute("data-testid") ? `[data-testid=${el.getAttribute("data-testid")}]` : ""}`); return { scroll: document.documentElement.scrollWidth, w, wide }; });
          rec.ok = r.scroll <= r.w + 1; rec.detail = `page ${r.scroll}px in a ${r.w}px viewport${r.wide.length ? `; wider: ${r.wide.join(", ")}` : ""}`;
        } else if (kind === "contrast") {
          // eslint-disable-next-line no-new-func -- the contrast routine is serialised so it runs in the page, not in Node
          const r = await locate(page, a.target).evaluate(new Function(`return (${CONTRAST_JS})`)());
          rec.ok = !r.image && r.ratio >= a.min; rec.detail = `${r.ratio}:1 (${r.fg} on ${r.bg})${r.image ? " — over a background image: needs a person" : ""}`;
        } else if (kind === "noConsoleErrors") { rec.ok = out.consoleErrors.length === 0; rec.detail = out.consoleErrors.slice(0, 3).join(" | "); }
        else if (kind === "status") { const res = await context.request.get(`${base}${a.path}`, { failOnStatusCode: false, maxRedirects: 0 }); rec.ok = res.status() === a.eq; rec.detail = `HTTP ${res.status()}`; }
      } catch (err) { rec.detail = String(err?.message || err).split("\n")[0].slice(0, 240); }
      out.expect.push(rec);
    }
    out.verdict = !stepFailed && out.expect.every((x) => x.ok) ? "PASS" : "FAIL";
    if (stepFailed) out.error = `step ${out.steps.length - 1} (${out.steps[out.steps.length - 1].do}) could not be done: ${out.steps[out.steps.length - 1].error}`;
  } catch (e) {
    out.verdict = "ERROR"; out.error = String(e?.message || e).split("\n")[0].slice(0, 300);
  } finally {
    if (shotsDir) { try { await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1200); fs.mkdirSync(shotsDir, { recursive: true }); const f = path.join(shotsDir, `${spec.id}.png`); await page.screenshot({ path: f, fullPage: true }); out.screenshot = f; } catch { /* a screenshot is evidence, not the verdict */ } }
    await context.close();
    out.durationMs = Date.now() - started;
  }
  return out;
}

/**
 * Launch Chromium. CONCORD_WALK_CHROMIUM names a browser binary when the Playwright a
 * project pins differs from the installed browsers; with none set and the pinned build
 * missing, the common preinstalled path is tried before giving up.
 */
export async function launchBrowser({ headless = true, env = process.env } = {}) {
  const { chromium } = await import("playwright");
  const explicit = env.CONCORD_WALK_CHROMIUM;
  if (explicit) return chromium.launch({ headless, executablePath: explicit });
  try { return await chromium.launch({ headless }); }
  catch (e) {
    const fallback = "/opt/pw-browsers/chromium";
    if (/Executable doesn't exist/.test(String(e?.message)) && fs.existsSync(fallback)) return chromium.launch({ headless, executablePath: fallback });
    throw e;
  }
}

export function loadSpecs(p) {
  const st = fs.statSync(p);
  const files = st.isDirectory() ? fs.readdirSync(p).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(p, f)) : [p];
  return files.map((f) => { try { return { file: f, spec: JSON.parse(fs.readFileSync(f, "utf8")) }; } catch (e) { return { file: f, error: `not JSON: ${e.message}` }; } });
}

async function main() {
  const target = process.argv[2];
  if (!target || target.startsWith("--")) { console.error("usage: run-check.mjs <spec.json | dir> [--base URL] [--out file.jsonl] [--shots dir] [--headed]"); process.exit(2); }
  const base = String(arg("--base", process.env.CONCORD_WALK_BASE || "https://concord-os.org")).replace(/\/+$/, "");
  const outFile = arg("--out", null), shots = arg("--shots", null);
  const browser = await launchBrowser({ headless: !process.argv.includes("--headed") });
  let worst = 0;
  try {
    for (const { file, spec, error } of loadSpecs(target)) {
      const r = error ? { type: "check_result", id: path.basename(file), verdict: "ERROR", error } : await runSpec(spec, { browser, base, shotsDir: shots, userAgent: process.env.CONCORD_WALK_UA });
      const line = JSON.stringify(r);
      console.log(line);
      if (outFile) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.appendFileSync(outFile, line + "\n"); }
      worst = Math.max(worst, r.verdict === "PASS" ? 0 : r.verdict === "FAIL" ? 1 : 2);
    }
  } finally { await browser.close(); }
  process.exit(worst);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
