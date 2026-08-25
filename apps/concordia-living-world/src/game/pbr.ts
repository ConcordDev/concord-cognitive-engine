import * as THREE from "three";
import {
  barkTexture,
  brickTexture,
  dirtTexture,
  grassTexture,
  leafTexture,
  plasterTexture,
  roadTexture,
  stoneTexture,
} from "./textures";

export type PbrMaps = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
};

const cache = new Map<string, PbrMaps>();

function texFromCanvas(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function derivePbr(
  albedo: THREE.Texture,
  key: string,
  strength = 3.4,
  roughMin = 0.42,
  roughMax = 0.96,
): PbrMaps {
  const hit = cache.get(key);
  if (hit) return hit;
  const img = albedo.image as HTMLCanvasElement;
  const size = img.width;
  const ctx = img.getContext("2d")!;
  const src = ctx.getImageData(0, 0, size, size);
  const lum = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    lum[i] = (src.data[o]! * 0.3 + src.data[o + 1]! * 0.59 + src.data[o + 2]! * 0.11) / 255;
  }
  const nC = document.createElement("canvas");
  nC.width = nC.height = size;
  const nCtx = nC.getContext("2d")!;
  const nImg = nCtx.createImageData(size, size);
  const rC = document.createElement("canvas");
  rC.width = rC.height = size;
  const rCtx = rC.getContext("2d")!;
  const rImg = rCtx.createImageData(size, size);
  const at = (x: number, y: number) => lum[(((y + size) % size) * size + ((x + size) % size))!]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      nImg.data[i] = (nx * 0.5 + 0.5) * 255;
      nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nImg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      nImg.data[i + 3] = 255;
      const rough = roughMin + (1 - lum[y * size + x]!) * (roughMax - roughMin);
      const g = Math.round(Math.min(1, Math.max(0, rough)) * 255);
      rImg.data[i] = g;
      rImg.data[i + 1] = g;
      rImg.data[i + 2] = g;
      rImg.data[i + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  const maps: PbrMaps = {
    map: albedo,
    normalMap: texFromCanvas(nC, false),
    roughnessMap: texFromCanvas(rC, false),
  };
  cache.set(key, maps);
  return maps;
}

export function tilePbr(maps: PbrMaps, x: number, y: number): PbrMaps {
  const wrap = (t: THREE.Texture) => {
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(x, y);
    c.needsUpdate = true;
    return c;
  };
  return { map: wrap(maps.map), normalMap: wrap(maps.normalMap), roughnessMap: wrap(maps.roughnessMap) };
}

export function pbrBrick(base?: string) {
  return derivePbr(brickTexture(base), `brick:${base ?? ""}`, 5.2, 0.55, 0.98);
}
export function pbrGrass(base?: string) {
  return derivePbr(grassTexture(base), `grass:${base ?? ""}`, 2.4, 0.7, 0.98);
}
export function pbrStone(base?: string) {
  return derivePbr(stoneTexture(base), `stone:${base ?? ""}`, 3.8, 0.48, 0.95);
}
export function pbrDirt(base?: string) {
  return derivePbr(dirtTexture(base), `dirt:${base ?? ""}`, 3.1, 0.72, 0.98);
}
export function pbrPlaster(base?: string) {
  return derivePbr(plasterTexture(base), `plaster:${base ?? ""}`, 1.8, 0.62, 0.92);
}
export function pbrBark(base?: string) {
  return derivePbr(barkTexture(base), `bark:${base ?? ""}`, 4.4, 0.78, 0.99);
}
export function pbrLeaf(base?: string) {
  return derivePbr(leafTexture(base), `leaf:${base ?? ""}`, 2.0, 0.62, 0.95);
}
export function pbrRoad(base?: string) {
  return derivePbr(roadTexture(base), `road:${base ?? ""}`, 2.6, 0.7, 0.96);
}
