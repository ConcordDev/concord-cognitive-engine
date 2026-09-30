#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const btn = document.querySelector("[data-testid=walk-in]");
  return Boolean(btn && !btn.disabled && (btn.textContent || "").includes("Walk in"));
});
await page.screenshot({ path: "/workspace/screenshots/title.png" });
await page.evaluate(() => document.querySelector("[data-testid=walk-in]")?.click());
await page.waitForSelector("[data-testid=play-hud]");
await page.waitForFunction(() => Boolean(window.__controlsTest?.setKeys));
await page.waitForTimeout(400);
await page.screenshot({ path: "/workspace/screenshots/play-hud.png" });

const title0 = await page.locator("[data-testid=world-title]").textContent();

await page.evaluate(() => {
  window.__controlsTest.setKeys(["KeyW"]);
});
await page.waitForTimeout(450);
const fwd = await page.evaluate(() => {
  const t = window.__controlsTest;
  return { speed: t.getSpeed(), pos: t.getPos(), yaw: t.getYaw() };
});
if (!(fwd.speed > 0.2)) {
  console.log(JSON.stringify({ ok: false, error: "W did not move", fwd, errors }, null, 2));
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => window.__controlsTest.setKeys([]));
await page.waitForTimeout(60);

const y0 = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys(["KeyW", "KeyA"]));
await page.waitForTimeout(450);
const yA = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys([]));
await page.waitForTimeout(60);
const y1 = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys(["KeyW", "KeyD"]));
await page.waitForTimeout(450);
const yD = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys([]));

const dA = wrap(yA - y0);
const dD = wrap(yD - y1);
const strafeOk = dA > 0.02 && dD < -0.02;
await page.screenshot({ path: "/workspace/screenshots/play-forward.png" });

const ruins = { x: Math.cos(0) * 20, z: Math.sin(0) * 20 };
await page.evaluate((g) => {
  const t = window.__controlsTest;
  if (t.setPos) t.setPos(g.x, g.z);
}, ruins);
await page.waitForTimeout(250);
await page.evaluate(() => window.__controlsTest.setKeys(["KeyE"]));
await page.waitForTimeout(200);
await page.evaluate(() => window.__controlsTest.setKeys([]));
await page.keyboard.press("KeyE");
await page.waitForTimeout(900);

const title1 = await page.locator("[data-testid=world-title]").textContent();
const hud = await page.locator("[data-testid=play-hud]").innerText();
await page.screenshot({ path: "/workspace/screenshots/play-1.png" });

const crossed = /Sovereign|Ruins|Tunya|Sundering|Crime|Grid|Frontier|Dawn|Crucible/i.test(
  `${title1}\n${hud}`,
);

const result = {
  ok: errors.length === 0 && strafeOk && crossed,
  title0,
  title1,
  fwd,
  dA,
  dD,
  strafeOk,
  crossed,
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.ok ? 0 : 1);
