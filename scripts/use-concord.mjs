// scripts/use-concord.mjs
//
// Drive concord as an authed user. Register → onboarding → explore.

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SHOTS = path.join(ROOT, 'audit', 'use-shots');
const FRONTEND = 'http://127.0.0.1:3000';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push(`[uncaught] ${String(e?.message || e).slice(0, 200)}`));

const log = (msg) => process.stderr.write(`▶ ${msg}\n`);
const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
};
const digest = async () => page.evaluate(() => {
  const txt = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  return {
    url: location.href,
    title: document.title,
    h1: Array.from(document.querySelectorAll('h1')).slice(0, 3).map(txt),
    inputs: Array.from(document.querySelectorAll('input,textarea')).slice(0, 8).map(i => ({
      type: i.getAttribute('type') || i.tagName.toLowerCase(),
      name: i.getAttribute('name'),
      placeholder: i.getAttribute('placeholder'),
      label: i.labels?.[0]?.textContent?.trim().slice(0, 40),
    })),
    buttons: Array.from(document.querySelectorAll('button')).slice(0, 10).map(b => ({ text: txt(b), disabled: b.disabled })),
    sample: (document.body?.innerText || '').slice(0, 400).replace(/\n+/g, ' | '),
  };
});

const trace = [];

// 1. Land + click "Get Started" / register.
log('landing');
await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
await page.waitForTimeout(1500);
await shot('01-landing');
trace.push({ step: 'landing', ...(await digest()) });

// 2. Go to register page.
log('register page');
await page.goto(FRONTEND + '/register', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
await page.waitForTimeout(1500);
await shot('02-register');
trace.push({ step: 'register-page', ...(await digest()) });

// 3. Fill + submit register form.
const username = `explorer-${Date.now().toString(36)}`;
const email = `${username}@example.test`;
const password = 'Concord-Explore-2026!';
log(`filling register: ${username}`);

// Try multiple selector strategies.
const tryFill = async (selectors, value) => {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) { await el.fill(value); return sel; }
  }
  return null;
};
const usernameSel = await tryFill(['input[name="username"]', 'input[placeholder*="ame" i]', 'input[type="text"]:not([name="email"])'], username);
const emailSel    = await tryFill(['input[name="email"]', 'input[type="email"]', 'input[placeholder*="mail" i]'], email);
const passSel     = await tryFill(['input[name="password"]', 'input[type="password"]'], password);
log(`filled: username=${usernameSel} email=${emailSel} password=${passSel}`);
await shot('03-register-filled');

// Submit.
consoleErrors.length = 0;
const submitBtn = await page.$('button[type="submit"]') || await page.$('button:has-text("Create")') || await page.$('button:has-text("Sign up")') || await page.$('button:has-text("Register")') || await page.$('button:has-text("Get Started")');
if (submitBtn) {
  await submitBtn.click();
  log('submitted');
  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
  await page.waitForTimeout(3500);
} else {
  log('NO SUBMIT BUTTON FOUND');
}
await shot('04-post-register');
trace.push({ step: 'post-register', ...(await digest()), consoleErrors: consoleErrors.slice(0, 5) });

// 4. Try going to chat as an authed user.
log('go to chat');
await page.goto(FRONTEND + '/lenses/chat', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
await page.waitForTimeout(2500);
await shot('05-chat-authed');
trace.push({ step: 'chat-authed', ...(await digest()) });

// 5. Try creating a DTU via the chat. Type something + submit.
log('type a message');
const chatInput = await page.$('textarea') || await page.$('input[type="text"]:visible');
if (chatInput) {
  await chatInput.fill('Hello, Concord. Tell me what you are in three sentences.');
  await shot('06-chat-typed');
  // Try Cmd+Enter / Enter to send.
  await page.keyboard.press('Enter');
  log('sent, waiting for response');
  await page.waitForTimeout(8000);
  await shot('07-chat-response');
  trace.push({ step: 'chat-sent', ...(await digest()) });
} else {
  log('NO CHAT INPUT FOUND');
}

// 6. Hit the world lens (3D).
log('world lens');
await page.goto(FRONTEND + '/lenses/world', { waitUntil: 'domcontentloaded' });
try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
await page.waitForTimeout(5000);
await shot('08-world');
trace.push({ step: 'world', ...(await digest()) });

// 7. Hit a few more interesting lenses.
for (const name of ['marketplace', 'music', 'code', 'atlas']) {
  log(name);
  await page.goto(FRONTEND + `/lenses/${name}`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
  await page.waitForTimeout(2500);
  await shot(`09-${name}`);
  trace.push({ step: name, ...(await digest()) });
}

await browser.close();
fs.writeFileSync(path.join(ROOT, 'audit', 'use-concord.json'), JSON.stringify(trace, null, 2));
log(`Wrote audit/use-concord.json + ${trace.length} screenshots`);
