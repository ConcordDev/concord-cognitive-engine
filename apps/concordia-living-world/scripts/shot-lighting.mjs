#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 400)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 400));
});

const shot = async (name) => {
  const data = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? c.toDataURL("image/jpeg", 0.82) : "";
  });
  if (!data || data.length < 20000) throw new Error(`empty canvas for ${name} len=${data.length}`);
  writeFileSync(`/workspace/screenshots/${name}.png`, Buffer.from(data.split(",")[1], "base64"));
  return data.length;
};

await page.goto("http://127.0.0.1:8080/", { waitUntil: "commit" });
await page.waitForFunction(() => {
  const btn = document.querySelector("[data-testid=walk-in]");
  return Boolean(btn && !btn.disabled && (btn.textContent || "").includes("Walk in"));
});
await page.evaluate(() => document.querySelector("[data-testid=walk-in]")?.click());
await page.waitForFunction(() => Boolean(window.__controlsTest?.setKeys));
await page.waitForTimeout(900);
const s1 = await shot("play-hud");

await page.evaluate(() => window.__controlsTest.setKeys(["KeyW"]));
await page.waitForTimeout(900);
const s2 = await shot("play-forward");
await page.evaluate(() => window.__controlsTest.setKeys([]));

await page.evaluate(() => window.__controlsTest.setPos(Math.cos(0) * 20, Math.sin(0) * 20));
await page.waitForTimeout(250);
await page.keyboard.press("KeyE");
await page.waitForTimeout(1200);
const s3 = await shot("ruins-gate");

await page.evaluate(() => {
  window.__controlsTest.setPos(22, 8);
  window.__controlsTest.setKeys(["KeyW"]);
});
await page.waitForTimeout(1100);
const s4 = await shot("ruins-terrain");
await page.evaluate(() => window.__controlsTest.setKeys([]));

console.log(JSON.stringify({
  errors,
  shots: { hud: s1, fwd: s2, gate: s3, terrain: s4 },
  world: await page.evaluate(() => document.querySelector("[data-testid=world-title]")?.textContent),
}, null, 2));
await browser.close();
