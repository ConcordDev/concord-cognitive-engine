#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const t0 = Date.now();
const log = (m) => console.log(`${Date.now() - t0}ms ${m}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(40000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const btn = document.querySelector("[data-testid=walk-in]");
  return Boolean(btn && !btn.disabled && (btn.textContent || "").includes("Walk in"));
});
await page.evaluate(() => document.querySelector("[data-testid=walk-in]")?.click());
await page.waitForSelector("[data-testid=play-hud]");
await page.waitForFunction(() => Boolean(window.__controlsTest?.setKeys));
await page.waitForTimeout(500);
await page.screenshot({ path: "/workspace/screenshots/play-hud.png" });
log("idle");

await page.evaluate(() => {
  if (window.__controlsTest.freeze) {
    /* hitstop will decay; just move */
  }
  window.__controlsTest.setKeys(["KeyW"]);
});
await page.waitForTimeout(500);
const fwd = await page.evaluate(() => ({ speed: window.__controlsTest.getSpeed(), yaw: window.__controlsTest.getYaw() }));
await page.screenshot({ path: "/workspace/screenshots/play-forward.png" });
log("walk " + fwd.speed);

await page.evaluate(() => window.__controlsTest.setKeys([]));
await page.waitForTimeout(450);
const stopped = await page.evaluate(() => window.__controlsTest.getSpeed());
log("stop " + stopped);

const y0 = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys(["KeyW", "KeyA"]));
await page.waitForTimeout(400);
const yA = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys([]));
await page.waitForTimeout(80);
const y1 = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys(["KeyW", "KeyD"]));
await page.waitForTimeout(400);
const yD = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setKeys([]));
const dA = wrap(yA - y0);
const dD = wrap(yD - y1);
log("turn A=" + dA.toFixed(3) + " D=" + dD.toFixed(3));

await page.evaluate((g) => window.__controlsTest.setPos(g.x, g.z), { x: 20, z: 0 });
await page.waitForTimeout(120);
await page.keyboard.press("KeyE");
await page.waitForTimeout(800);
const title = await page.locator("[data-testid=world-title]").textContent();
log("world " + title);
await page.evaluate((g) => {
  window.__controlsTest.setPos(g.x, g.z);
  window.__controlsTest.setCamYaw?.(g.yaw);
}, { x: 8.2, z: 0.2, yaw: -Math.PI / 2 });
await page.waitForTimeout(200);
await page.screenshot({ path: "/workspace/screenshots/ruins-gate.png" });
log("ruins");

if (typeof (await page.evaluate(() => typeof window.__controlsTest.attack)) === "string") {
  await page.evaluate(() => window.__controlsTest.attack());
  await page.waitForTimeout(90);
  await page.evaluate(() => window.__controlsTest.freeze?.());
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/workspace/screenshots/play-swing.png" });
  const kind = await page.evaluate(() => window.__controlsTest.getAttack?.() ?? null);
  log("swing " + kind);
}

const ok = errors.length === 0 && fwd.speed > 0.2 && stopped < 0.35 && dA > 0.02 && dD < -0.02;
console.log(JSON.stringify({ ok, title, fwd, stopped, dA, dD, errors }, null, 2));
await browser.close();
if (!ok) process.exit(1);
