import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3000';
const creds = Object.fromEntries(
  fs.readFileSync(process.env.HOME + '/.zuko/remaining-work/_audit_user.txt', 'utf8').trim().split('\n').map((l) => l.split('=')),
);

const PAGES = [
  '/',
  '/lenses/world',
  '/lenses/chat',
  '/lenses/art',
  '/lenses/ar',
  '/lenses/music',
  '/lenses/accounting',
  '/lenses/code',
  '/lenses/markets',
  '/lenses/forge',
  '/lenses/creative-writing',
];

const results = [];

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    errors.push({ page: page._currentUrl, type: msg.type(), text: msg.text().slice(0, 300) });
  }
});
page.on('pageerror', (err) => {
  errors.push({ page: page._currentUrl, type: 'pageerror', text: String(err).slice(0, 300) });
});
page.on('requestfailed', (req) => {
  errors.push({ page: page._currentUrl, type: 'requestfailed', text: `${req.method()} ${req.url()} — ${req.failure()?.errorText}`.slice(0, 300) });
});
page.on('response', (res) => {
  if (res.status() >= 400) {
    errors.push({ page: page._currentUrl, type: `http_${res.status()}`, text: res.url().slice(0, 300) });
  }
});

// Login first
page._currentUrl = '/login (setup)';
await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 45000 }).catch((e) => errors.push({ page: '/login', type: 'nav_error', text: String(e).slice(0, 300) }));
try {
  await page.waitForSelector('#email', { timeout: 30000 });
  await page.fill('#email', creds.USER, { timeout: 5000 });
  await page.fill('#password', creds.PASS, { timeout: 5000 });
  await page.click('button[type="submit"]', { timeout: 5000 });
  await page.waitForTimeout(3000);
} catch (e) {
  errors.push({ page: '/login', type: 'login_flow_error', text: String(e).slice(0, 300) });
}

for (const p of PAGES) {
  page._currentUrl = p;
  const before = errors.length;
  try {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    errors.push({ page: p, type: 'nav_error', text: String(e).slice(0, 300) });
  }
  results.push({ page: p, newIssueCount: errors.length - before });
}

await browser.close();

console.log(JSON.stringify({ summary: results, errors }, null, 2));
