/**
 * Rasterize the existing Concord SVGs into the PNG icons the manifest
 * and apple-touch-icon require. Uses sharp from this package.
 *
 *   node scripts/generate-pwa-icons.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = resolve(root, 'public/icons');
const bg = { r: 10, g: 14, b: 26, alpha: 1 };

async function pngFromSvg(svgPath, size) {
  const svg = await readFile(svgPath);
  return sharp(svg, { density: 192 }).resize(size, size, { fit: 'fill' }).png().toBuffer();
}

async function writeSized(svgName, size, outName) {
  const buf = await pngFromSvg(resolve(icons, svgName), size);
  const out = outName.startsWith('apple')
    ? resolve(root, 'public', outName)
    : resolve(icons, outName);
  await sharp(buf).png().toFile(out);
  const meta = await sharp(out).metadata();
  if (meta.width !== size || meta.height !== size || meta.format !== 'png') {
    throw new Error(`${outName} is ${meta.width}x${meta.height} ${meta.format}`);
  }
  console.log(`${outName} ${meta.width}x${meta.height}`);
}

/** Maskable icons are clipped to a circle. Keep the mark inside the safe zone. */
async function writeMaskable(svgName, size, outName) {
  const inner = Math.round(size * 0.68);
  const mark = await pngFromSvg(resolve(icons, svgName), inner);
  const out = resolve(icons, outName);
  await sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(out);
  const meta = await sharp(out).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${outName} is ${meta.width}x${meta.height}`);
  }
  console.log(`${outName} ${meta.width}x${meta.height} maskable (mark ${inner}px)`);
}

await writeSized('icon-192x192.svg', 192, 'icon-192x192.png');
await writeSized('icon-512x512.svg', 512, 'icon-512x512.png');
await writeMaskable('icon-512x512.svg', 512, 'icon-512x512-maskable.png');
await writeSized('icon-512x512.svg', 180, 'apple-touch-icon.png');
