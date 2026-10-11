// Headless studio render of the parametric assembly (the loft, not a photo).
// Writes PNGs next to the script's --out directory. Uses system Chrome + the
// three.js build already installed for the frontend.

import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { assemblyFromIr } from "../lib/conkay/assembly/build.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..", "..");
const outDir = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : join(root, "show");
const targetPath = join(root, "show", "car-visual-target.png");
const brief = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

const built = buildCarFromLibrary(brief);
if (built.error) throw new Error(built.error);
const assembly = assemblyFromIr(built.ir);
mkdirSync(outDir, { recursive: true });
const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<script type="importmap">{ "imports": { "three": "/three/build/three.module.js" } }</script>
<style>html,body,canvas{margin:0;width:100%;height:100%;display:block;background:#3c3e42}</style>
</head><body>
<script type="module">
import * as THREE from "three";
import { RoomEnvironment } from "/three/examples/jsm/environments/RoomEnvironment.js";

const params = new URLSearchParams(location.search);
const view = params.get("view") || "studio";
const assembly = await (await fetch("/assembly.json")).json();
const toThree = (x, y, z) => [x, z, -y];
const shift = (part, t) => {
  const e = part.explode || { axis: "z", sign: 1, rank: 0 };
  const d = Math.max(0, Math.min(1, t)) * e.rank * e.sign * 0.22;
  const v = { x: part.placement.x, y: part.placement.y, z: part.placement.z };
  v[e.axis] += d;
  return [v.x, v.y, v.z];
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(1.5);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = view === "engineering" ? 1.05 : 0.86;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

function studioBackdrop() {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#8d9096");
  grd.addColorStop(0.42, "#5e6166");
  grd.addColorStop(1, "#3c3e42");
  g.fillStyle = grd;
  g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const scene = new THREE.Scene();
scene.background = view === "engineering" ? new THREE.Color(0xececec) : studioBackdrop();
const pmrem = new THREE.PMREMGenerator(renderer);
if (view !== "engineering") scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const bounds = assembly.surface.mesh.bounds;
const cx = (bounds.min[0] + bounds.max[0]) / 2;
const nose = bounds.min[0] - cx;
const group = new THREE.Group();
group.position.x = -cx;
scene.add(group);

function vehiclePositions(src, normals) {
  const positions = [];
  const outN = [];
  const hasN = normals && normals.length === src.length;
  for (let i = 0; i < src.length; i += 3) {
    positions.push(src[i], src[i + 2], -src[i + 1]);
    if (hasN) outN.push(normals[i], normals[i + 2], -normals[i + 1]);
  }
  return { positions, normals: hasN ? outN : null };
}
function geo(mesh, index) {
  const v = vehiclePositions(mesh.positions, mesh.normals);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v.positions, 3));
  if (v.normals) g.setAttribute("normal", new THREE.Float32BufferAttribute(v.normals, 3));
  g.setIndex(index || mesh.indices);
  if (!v.normals) g.computeVertexNormals();
  return g;
}

const explode = view === "exploded" ? 0.72 : 0;
const engineering = view === "engineering";
const showInterior = engineering || explode > 0.02 || view === "section";
let clip = [];
if (view === "section") {
  const y = 0.05;
  clip = [new THREE.Plane(new THREE.Vector3(0, 0, 1), y)];
}

const paintMat = engineering
  ? new THREE.MeshLambertMaterial({ color: 0x9aa3ad, flatShading: true, transparent: true, opacity: 0.45, clippingPlanes: clip })
  : new THREE.MeshPhysicalMaterial({
    color: 0x8b9098, metalness: 0.9, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.62, clippingPlanes: clip,
    // Explode keeps the hierarchy shift. The shell is also translucent so the
    // skateboard pack, which only moves a rank-2 step, is still visible inside it.
    transparent: explode > 0, opacity: explode > 0 ? 0.34 : 1, depthWrite: explode === 0,
  });
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x07090c, metalness: 0, roughness: 0.08, transmission: engineering ? 0.12 : 0.22,
  thickness: 0.8, transparent: true, opacity: engineering ? 0.55 : 0.92, clippingPlanes: clip,
});
const trimMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide, clippingPlanes: clip });
const body = new THREE.Mesh(geo(assembly.surface.mesh, assembly.surface.mesh.paint), paintMat);
body.castShadow = body.receiveShadow = true;
group.add(body);
const glassSrc = assembly.surface.mesh.glass;
const glassMesh = glassSrc && glassSrc.positions
  ? geo(glassSrc)
  : geo(assembly.surface.mesh, glassSrc);
group.add(new THREE.Mesh(glassMesh, glassMat));
if (assembly.surface.mesh.trim && assembly.surface.mesh.trim.positions) {
  group.add(new THREE.Mesh(geo(assembly.surface.mesh.trim), trimMat));
}
if (assembly.surface.mesh.arch && assembly.surface.mesh.arch.positions) {
  group.add(new THREE.Mesh(geo(assembly.surface.mesh.arch), new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide, clippingPlanes: clip })));
}

const wheels = assembly.components.filter((c) => c.role === "wheel");
const parts = [
  ["tire", new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.94, side: THREE.DoubleSide, clippingPlanes: clip })],
  ["rim", new THREE.MeshPhysicalMaterial({ color: 0x8a8e94, metalness: 1, roughness: 0.22, clearcoat: 0.45, clearcoatRoughness: 0.12, side: THREE.DoubleSide, clippingPlanes: clip })],
  ["disc", new THREE.MeshStandardMaterial({ color: 0x3e4248, metalness: 0.9, roughness: 0.32, side: THREE.DoubleSide, clippingPlanes: clip })],
  ["caliper", new THREE.MeshStandardMaterial({ color: 0xc45c26, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide, clippingPlanes: clip })],
];
const dummy = new THREE.Object3D();
for (const [name, mat] of parts) {
  const mesh = new THREE.InstancedMesh(geo(assembly.wheel[name]), mat, wheels.length);
  mesh.castShadow = true;
  wheels.forEach((w, i) => {
    const [x, y, z] = shift(w, explode);
    const [tx, ty, tz] = toThree(x, y, z);
    dummy.position.set(tx, ty, tz);
    dummy.scale.set(1, 1, w.placement.y < 0 ? -1 : 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(mesh);
}

const groupColor = { exterior: 0x9aa3ad, wheels: 0x2a2a2a, chassis: 0x8d6a45, powertrain: 0xc45c26, interior: 0x4c6b8a, storage: 0x6b7c5a };
const outside = new Set((assembly.checks.find((c) => c.id === "containment" && c.status === "fail") || {}).outside || []);
for (const c of assembly.components) {
  if (c.role === "wheel" || c.role === "body" || c.role === "glass" || c.role === "opening" || c.role === "axle" || c.id === "SPARE") continue;
  if (!engineering && outside.has(c.id)) continue;
  const studioDetail = c.role === "lamp" || c.role === "intake" || c.role === "mirror" || c.role === "handle" || c.role === "trim";
  if (!showInterior && !studioDetail) continue;
  if (!c.half && !(c.mesh && c.mesh.positions)) continue;
  const [x, y, z] = shift(c, explode);
  const [tx, ty, tz] = toThree(x, y, z);
  let g;
  if (c.mesh && c.mesh.positions && c.mesh.indices) g = geo(c.mesh);
  else if (c.role === "lamp" && assembly.detail?.lamp) g = geo(assembly.detail.lamp);
  else if (c.role === "intake" && assembly.detail?.grille) g = geo(assembly.detail.grille);
  else if (!c.half) continue;
  else g = new THREE.BoxGeometry(c.half[0] * 2, c.half[2] * 2, c.half[1] * 2);
  let mat;
  const tail = String(c.id).startsWith("TAIL");
  if (c.role === "lamp") mat = new THREE.MeshPhysicalMaterial({ color: tail ? 0xffd0d4 : 0xe7eef8, emissive: tail ? 0xff2a3a : 0xf7fbff, emissiveIntensity: engineering ? 0.4 : 1.6, roughness: 0.08, clearcoat: 1, clippingPlanes: clip });
  else if (c.role === "intake") mat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.72, metalness: 0.4, clippingPlanes: clip });
  else if (c.role === "mirror") mat = new THREE.MeshPhysicalMaterial({ color: 0xe6e8ee, metalness: 0.9, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05, clippingPlanes: clip });
  else if (c.id === "DUCKTAIL") mat = new THREE.MeshPhysicalMaterial({ color: 0x8b9098, metalness: 0.9, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.62, clippingPlanes: clip });
  else if (c.role === "handle" || c.role === "trim") mat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide, clippingPlanes: clip });
  else mat = new THREE.MeshLambertMaterial({ color: groupColor[c.group] || 0x888888, flatShading: engineering, transparent: true, opacity: engineering ? 0.85 : 0.55, clippingPlanes: clip });
  const m = new THREE.Mesh(g, mat);
  m.position.set(tx, ty, tz);
  group.add(m);
}
if (engineering) for (const c of assembly.components.filter((d) => d.role === "opening" && d.mesh?.outline)) {
  const [x, y, z] = shift(c, explode);
  const side = c.mesh.side === "L" ? -0.004 : 0.004;
  const pts = c.mesh.outline.map(([ox, oz]) => new THREE.Vector3(...toThree(ox, y + side, oz)));
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: engineering ? 0x333333 : 0x1c1c1c })));
  void x; void z;
}

scene.add(new THREE.AmbientLight(0xffffff, engineering ? 0.7 : 0.1));
const key = new THREE.DirectionalLight(0xfff6ee, engineering ? 1 : 1.85);
key.position.set(2.4, 5.2, 3.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.4;
key.shadow.camera.far = 24;
key.shadow.camera.left = -6;
key.shadow.camera.right = 6;
key.shadow.camera.top = 6;
key.shadow.camera.bottom = -6;
key.shadow.bias = -0.0004;
key.shadow.radius = 8;
scene.add(key);
const fill = new THREE.DirectionalLight(0xc5ced8, engineering ? 0.42 : 0.16);
fill.position.set(-3.2, 2.4, 1.6);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xe7eeff, engineering ? 0.15 : 1.35);
rim.position.set(-3.6, 2.8, -4.2);
scene.add(rim);
const kicker = new THREE.DirectionalLight(0xfff1e0, engineering ? 0 : 0.55);
kicker.position.set(4.8, 1.6, -1.2);
scene.add(kicker);

const ground = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: engineering ? 0xececec : 0x3e4044, roughness: 0.96 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
if (!engineering) {
  const blob = document.createElement("canvas");
  blob.width = 128; blob.height = 128;
  const gtx = blob.getContext("2d");
  const grd = gtx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grd.addColorStop(0, "rgba(0,0,0,0.38)");
  grd.addColorStop(0.55, "rgba(0,0,0,0.16)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  gtx.fillStyle = grd;
  gtx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry((bounds.max[0] - bounds.min[0]) * 0.86, (bounds.max[1] - bounds.min[1]) * 1.15),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blob), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  scene.add(shadow);
}

const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.05, 80);
// Section camera sits on the clipped side (negative three Z, +vehicle Y) so the cut face is what we look at.
if (view === "section") camera.position.set(nose + 0.6, 0.72, -2.6);
else if (view === "exploded") camera.position.set(nose - 0.4, 1.7, 4.2);
else if (view === "side") camera.position.set(0.2, 0.72, 7.2);
else camera.position.set(nose - 1.8, 0.92, 2.6);
camera.lookAt(view === "side" ? 0 : nose * 0.2, view === "side" ? 0.58 : 0.5, 0);
renderer.render(scene, camera);
requestAnimationFrame(() => { renderer.render(scene, camera); window.__ready = true; });
</script></body></html>`;

writeFileSync(join(outDir, "assembly.json"), JSON.stringify(assembly));
writeFileSync(join(outDir, "studio.html"), html);

const threeRoot = join(root, "concord-frontend", "node_modules", "three");
const types = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png",
};
const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  let file = join(outDir, "studio.html");
  if (url === "/assembly.json") file = join(outDir, "assembly.json");
  else if (url.startsWith("/three/")) file = join(threeRoot, url.slice("/three/".length));
  else if (url !== "/" && url !== "/studio.html") { res.writeHead(404); res.end(); return; }
  if (!existsSync(file)) { res.writeHead(404); res.end(url); return; }
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const require = createRequire(join(root, "concord-frontend", "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const shots = {};
for (const view of ["studio", "exploded", "section", "engineering", "side"]) {
  await page.goto(`http://127.0.0.1:${port}/studio.html?view=${view}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  const file = join(outDir, `car-${view}.png`);
  await page.screenshot({ path: file });
  shots[view] = file;
  console.log("shot", file);
}
await browser.close();
server.close();

const note = [];
note.push(`studio ${shots.studio}`);
note.push(`bounds ${JSON.stringify(assembly.surface.mesh.bounds)}`);
note.push(`capped ${JSON.stringify(assembly.surface.mesh.capped)}`);
note.push(`fit ${assembly.checks.map((c) => c.status + " " + c.id).join("; ")}`);
note.push(existsSync(targetPath) ? `target ${targetPath}` : "target image was not on disk");
writeFileSync(join(outDir, "render-notes.txt"), note.join("\n"));
console.log(note.join("\n"));
