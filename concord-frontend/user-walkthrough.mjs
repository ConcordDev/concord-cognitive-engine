import { chromium } from "playwright";
import fs from "fs";

const BASE = process.env.TARGET_BASE || "https://concord-os.org";
const SHOT_DIR = "/tmp/walkthrough-shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const uname = "qa_walkthrough_" + Date.now();
const email = `${uname}@example.com`;
const password = "TestPass!2345678";

const findings = [];
function record(kind, detail) {
  findings.push({ kind, detail, t: new Date().toISOString() });
  console.log(`[${kind}]`, JSON.stringify(detail).slice(0, 400));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") record("CONSOLE_ERROR", { text: msg.text(), url: page.url() });
});
page.on("pageerror", (err) => record("PAGE_ERROR", { message: err.message, url: page.url() }));
page.on("requestfailed", (req) => {
  record("REQUEST_FAILED", { url: req.url(), method: req.method(), failure: req.failure()?.errorText, page: page.url() });
});
page.on("response", (res) => {
  const status = res.status();
  if (status >= 500) record("SERVER_ERROR_RESPONSE", { url: res.url(), status, page: page.url() });
});

async function shot(name) {
  try {
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
  } catch (e) {
    record("SCREENSHOT_FAIL", { name, error: e.message });
  }
}

async function step(name, fn) {
  console.log(`\n=== STEP: ${name} ===`);
  try {
    await fn();
  } catch (e) {
    record("STEP_EXCEPTION", { step: name, error: e.message });
  }
  await shot(name.replace(/[^a-z0-9]+/gi, "_"));
}

await step("01_load_homepage", async () => {
  const resp = await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  record("NAV_STATUS", { url: BASE, status: resp?.status() });
  await page.waitForTimeout(1500);
});

await step("02_navigate_to_register", async () => {
  // try direct nav first since selector discovery on an unknown landing page is fragile
  const resp = await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 30000 });
  record("NAV_STATUS", { url: `${BASE}/register`, status: resp?.status() });
  await page.waitForTimeout(1000);
});

await step("03_fill_signup_form", async () => {
  const bodyText = await page.textContent("body").catch(() => "");
  record("PAGE_TEXT_SNIPPET", { snippet: (bodyText || "").slice(0, 300) });

  // Try a broad set of selector guesses since we don't know the exact form markup
  const usernameSel = 'input[name="username"], input[id="username"], input[placeholder*="username" i]';
  const emailSel = 'input[name="email"], input[id="email"], input[type="email"]';
  const passSel = 'input[name="password"], input[id="password"], input[type="password"]';
  const dobSel = 'input[type="date"]';

  const hasUsername = await page.locator(usernameSel).first().isVisible().catch(() => false);
  const hasEmail = await page.locator(emailSel).first().isVisible().catch(() => false);
  const hasPass = await page.locator(passSel).first().isVisible().catch(() => false);
  const hasDob = await page.locator(dobSel).first().isVisible().catch(() => false);
  record("FORM_FIELDS_DETECTED", { hasUsername, hasEmail, hasPass, hasDob });

  if (hasUsername) await page.locator(usernameSel).first().fill(uname);
  if (hasEmail) await page.locator(emailSel).first().fill(email);
  const passFields = page.locator(passSel);
  const passCount = await passFields.count();
  for (let i = 0; i < passCount; i++) {
    await passFields.nth(i).fill(password);
  }
  if (hasDob) await page.locator(dobSel).first().fill("1995-06-15");

  await page.waitForTimeout(500);
});

await step("04_submit_signup", async () => {
  const submitSel = 'button[type="submit"], button:has-text("Sign up"), button:has-text("Register"), button:has-text("Create account")';
  const btn = page.locator(submitSel).first();
  const visible = await btn.isVisible().catch(() => false);
  record("SUBMIT_BUTTON_VISIBLE", { visible });
  if (visible) {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
      btn.click(),
    ]);
  }
  await page.waitForTimeout(2000);
  record("POST_SUBMIT_URL", { url: page.url() });
});

await step("05_check_landing_after_signup", async () => {
  const bodyText = await page.textContent("body").catch(() => "");
  record("PAGE_TEXT_SNIPPET", { url: page.url(), snippet: (bodyText || "").slice(0, 400) });
});

// try logging in explicitly too, in case signup auto-redirected somewhere odd
await step("06_try_login_flow", async () => {
  const resp = await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null);
  record("NAV_STATUS", { url: `${BASE}/login`, status: resp?.status() });
  const emailSel = 'input[name="email"], input[id="email"], input[type="email"], input[name="username"], input[placeholder*="username" i]';
  const passSel = 'input[name="password"], input[id="password"], input[type="password"]';
  const hasEmail = await page.locator(emailSel).first().isVisible().catch(() => false);
  const hasPass = await page.locator(passSel).first().isVisible().catch(() => false);
  record("LOGIN_FORM_DETECTED", { hasEmail, hasPass });
  if (hasEmail) await page.locator(emailSel).first().fill(email);
  if (hasPass) await page.locator(passSel).first().fill(password);
  const submitSel = 'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")';
  const btn = page.locator(submitSel).first();
  if (await btn.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
      btn.click(),
    ]);
  }
  await page.waitForTimeout(2000);
  record("POST_LOGIN_URL", { url: page.url() });
});

await step("07_dashboard_or_home", async () => {
  const bodyText = await page.textContent("body").catch(() => "");
  record("PAGE_TEXT_SNIPPET", { url: page.url(), snippet: (bodyText || "").slice(0, 400) });
});

// click around: try a handful of common nav links / lens routes
const routesToTry = ["/lenses/world", "/lenses/dtus", "/lenses/chat", "/lenses/marketplace", "/lenses/code"];
for (const route of routesToTry) {
  await step(`08_visit_${route}`, async () => {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 20000 }).catch((e) => {
      record("NAV_EXCEPTION", { route, error: e.message });
      return null;
    });
    record("NAV_STATUS", { url: `${BASE}${route}`, status: resp?.status() });
    await page.waitForTimeout(1500);
    const bodyText = await page.textContent("body").catch(() => "");
    record("PAGE_TEXT_SNIPPET", { route, snippet: (bodyText || "").slice(0, 200) });
  });
}

await browser.close();

fs.writeFileSync("/tmp/walkthrough-findings.json", JSON.stringify(findings, null, 2));

const errorFindings = findings.filter((f) =>
  ["CONSOLE_ERROR", "PAGE_ERROR", "REQUEST_FAILED", "SERVER_ERROR_RESPONSE", "STEP_EXCEPTION"].includes(f.kind)
);
console.log("\n\n=== SUMMARY ===");
console.log("total findings:", findings.length);
console.log("error-class findings:", errorFindings.length);
for (const f of errorFindings) console.log(" -", f.kind, JSON.stringify(f.detail).slice(0, 200));
