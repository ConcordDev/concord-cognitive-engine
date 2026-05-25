// scripts/snap-world.mjs — capture Concordia (3D world lens).
//
// Three.js needs WebGL + a settle period for terrain/avatar/buildings
// to load. Headless Chromium uses SwiftShader (software WebGL) which
// IS slow but renders correctly. We wait longer than usual, dismiss
// any UI overlays, and screenshot at multiple settle points.

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const SHOTS = path.join(ROOT, 'audit', 'world-shots');
const FRONTEND = 'http://127.0.0.1:3000';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    // Enable WebGL in headless via SwiftShader (Chromium ships it bundled).
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('pageerror', e => process.stderr.write(`[err] ${String(e?.message || e).slice(0, 200)}\n`));

// Login as an existing test user (re-register hits the daily IP cap).
// world-explorer-mpldouwl was registered earlier in this arc.
const regRes = await fetch('http://127.0.0.1:5050/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  body: JSON.stringify({ username: 'world-explorer-mpldouwl', password: 'Concord-Explore-2026!' }),
});
const reg = await regRes.json();
if (!reg?.ok) { process.stderr.write(`login failed: ${JSON.stringify(reg)}\n`); process.exit(1); }
const token = reg.token;
const userId = reg.user.id;
process.stderr.write(`logged in as ${reg.user.username} → uid ${userId.slice(0,8)}…\n`);

// Cookie name `concord_auth` is what middleware.ts checks AND what
// server.js auth middleware reads (req.cookies?.concord_auth).
await ctx.addCookies([
  { name: 'concord_auth', value: token, url: FRONTEND, httpOnly: false, secure: false, sameSite: 'Lax' },
]);

// Pre-warm localStorage so no first-time-visitor modals block the view.
await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate((tok) => {
  localStorage.setItem('concord-onboarding-completed', 'true');
  localStorage.setItem('concord_onboarding_complete', 'true');
  localStorage.setItem('concord_cookie_consent', 'accepted');
  localStorage.setItem('concord_first_win_dismissed', 'true');
  // The frontend client also stores the JWT in localStorage in many flows.
  localStorage.setItem('concord_token', tok);
  localStorage.setItem('auth_token', tok);
  localStorage.setItem('token', tok);
}, token);
process.stderr.write('pre-auth done\n');

// Hit the world lens.
await page.goto(FRONTEND + '/lenses/world', { waitUntil: 'domcontentloaded' });
process.stderr.write('navigated to /lenses/world\n');
try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { process.stderr.write('networkidle timeout — continuing\n'); }
// Three.js needs scene init + first paint + at least one tick of the
// render loop. Three sequential settles let us see if anything changes
// over time (assets loading, NPCs spawning, weather kicking in).
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(SHOTS, '01-world-with-modals.png') });
process.stderr.write('snap @ 4s (with modals)\n');

// Dismiss every tutorial / onboarding overlay we can find.
const dismissals = [
  'button:has-text("Skip Tutorial")',
  'button:has-text("Skip")',
  'button[aria-label="Close"]',
  'button[aria-label*="Dismiss"]',
  'button[aria-label*="close" i]',
  '[role="dialog"] button:has-text("Skip")',
];
for (let i = 0; i < 4; i++) {
  let clicked = false;
  for (const sel of dismissals) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        process.stderr.write(`dismissed: ${sel}\n`);
        clicked = true;
        break;
      }
    } catch { /* ignore */ }
  }
  if (!clicked) break;
}
// Also dismiss any modal by pressing Escape several times.
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(SHOTS, '02-world-after-dismiss.png') });
process.stderr.write('snap @ post-dismiss\n');

// Click the center of the viewport to trigger pointer-lock / user
// gesture if the scene needs one.
try { await page.mouse.click(720, 450); await page.waitForTimeout(500); } catch {}

await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(SHOTS, '03-pre-concordia-click.png'), fullPage: false });

// Click the "Explore" view-mode toggle — that's the immersive 3D
// scene where ConcordiaScene mounts. The "Concordia" tab is the
// sub-world picker (ConcordiaHub), NOT the rendered scene.
try {
  const exploreBtn = await page.$('button:has-text("Explore")');
  if (exploreBtn) {
    await exploreBtn.click({ timeout: 2000 });
    process.stderr.write('clicked Explore tab\n');
    await page.waitForTimeout(6000);  // Three.js + Rapier need time to init
  }
} catch (e) { process.stderr.write(`explore click failed: ${e?.message}\n`); }

// Scroll up to the top in case the canvas is above the fold.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(SHOTS, '04-world-concordia.png'), fullPage: false });
process.stderr.write('snap @ concordia\n');

// Full-page screenshot in case the WebGL canvas is rendered below the fold.
await page.screenshot({ path: path.join(SHOTS, '05-world-fullpage.png'), fullPage: true });
process.stderr.write('snap @ fullpage\n');

// (Skipped sub-world click — Explore mode auto-renders the active world.)
// Three.js needs settle + WebGL frames.
await page.waitForTimeout(10000);
await page.screenshot({ path: path.join(SHOTS, '06-after-subworld-click.png') });
process.stderr.write('snap @ post-subworld-click\n');

// One more after a longer wait — terrain heightfield / NPCs can take time.
await page.waitForTimeout(8000);
await page.screenshot({ path: path.join(SHOTS, '07-concordia-rendered.png') });
process.stderr.write('snap @ concordia-rendered\n');

// Dim/hide loading overlays so we can see the actual WebGL canvas
// underneath. Loading-screen-only — we keep the HUD visible.
await page.evaluate(() => {
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').slice(0, 200);
    if (/Arriving at\s+\w+|Loading|Unable to connect/i.test(t) && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 400 && rect.height > 200) {
          el.style.display = 'none';
        }
      }
    }
  }
});
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(SHOTS, '08-concordia-no-overlay.png') });
process.stderr.write('snap @ no-overlay\n');

// Find all WebGL canvases + their positions; scroll to the biggest one.
const canvases = await page.$$eval('canvas', els => els.map((c, i) => {
  const r = c.getBoundingClientRect();
  const ctx2d = !!c.getContext('2d');
  const webgl2 = !!c.getContext('webgl2');
  const webgl = !!c.getContext('webgl');
  return {
    i, width: c.width, height: c.height,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    visible: c.offsetWidth > 0 && c.offsetHeight > 0,
    contextType: webgl2 ? 'webgl2' : (webgl ? 'webgl' : (ctx2d ? '2d' : 'none')),
  };
}));
process.stderr.write('canvases: ' + JSON.stringify(canvases, null, 2) + '\n');

// Pick the largest WebGL canvas and scroll it into view.
const wgl = canvases.filter(c => c.contextType.startsWith('webgl')).sort((a, b) => (b.width * b.height) - (a.width * a.height));
if (wgl.length > 0) {
  const target = wgl[0];
  // Scroll to ensure it's in viewport.
  await page.evaluate((idx) => {
    const cs = document.querySelectorAll('canvas');
    cs[idx]?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, target.i);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, '10-concordia-scrolled-to-canvas.png') });
  process.stderr.write(`snap @ canvas idx=${target.i} (${target.width}x${target.height})\n`);
  // Capture the actual WebGL framebuffer pixels via toDataURL. The
  // playwright element.screenshot() only captures the canvas's page
  // RECT — useless if the canvas has z-index 0 behind UI overlays
  // since the overlays mask the pixels in the page screenshot.
  // toDataURL reads the WebGL backbuffer directly.
  //
  // WebGL contexts need `preserveDrawingBuffer: true` to read after
  // a frame is presented. Three.js usually doesn't set that, so we
  // request a fresh frame via the render loop, then sample.
  const dataUrls = await page.evaluate(async () => {
    const out = [];
    const cs = document.querySelectorAll('canvas');
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      // Force a re-render — Three.js drains the framebuffer per frame.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        out.push({ i, dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height });
      } catch (e) {
        out.push({ i, error: String(e?.message || e).slice(0, 100), w: c.width, h: c.height });
      }
    }
    return out;
  });
  for (const d of dataUrls) {
    if (d.dataUrl) {
      const m = d.dataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (m) {
        fs.writeFileSync(path.join(SHOTS, `12-canvas-${d.i}-${d.w}x${d.h}.png`), Buffer.from(m[1], 'base64'));
        process.stderr.write(`saved canvas ${d.i} ${d.w}x${d.h}\n`);
      }
    } else if (d.error) {
      process.stderr.write(`canvas ${d.i} toDataURL error: ${d.error}\n`);
    }
  }
}

// Re-inspect.
const inspect2 = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
    width: c.width, height: c.height,
    displayed: c.offsetWidth > 0 && c.offsetHeight > 0,
    contextType: c.getContext('webgl2') ? 'webgl2' : (c.getContext('webgl') ? 'webgl' : (c.getContext('2d') ? '2d' : 'none')),
  }));
  return { url: location.href, canvasCount: canvases.length, canvases };
});
process.stderr.write('after subworld: ' + JSON.stringify(inspect2) + '\n');

// Inspect the DOM for any visible canvas + diagnostic counts.
const inspect = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
    width: c.width,
    height: c.height,
    displayed: c.offsetWidth > 0 && c.offsetHeight > 0,
    contextType: c.getContext('webgl2') ? 'webgl2' : (c.getContext('webgl') ? 'webgl' : (c.getContext('2d') ? '2d' : 'none')),
  }));
  return {
    title: document.title,
    url: location.href,
    canvasCount: canvases.length,
    canvases,
    hudVisible: !!document.querySelector('[data-hud], [class*="HUD"], [class*="Concordia"]'),
    bodySample: (document.body?.innerText || '').slice(0, 500).replace(/\n+/g, ' | '),
  };
});
fs.writeFileSync(path.join(SHOTS, 'inspect.json'), JSON.stringify(inspect, null, 2));
process.stderr.write(JSON.stringify(inspect, null, 2) + '\n');

await browser.close();
process.stderr.write(`Wrote ${SHOTS}\n`);
