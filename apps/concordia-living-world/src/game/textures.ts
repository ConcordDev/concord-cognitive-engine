import * as THREE from "three";

const cache = new Map<string, THREE.CanvasTexture>();

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function canvasTex(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, n: number) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

export function withRepeat(tex: THREE.Texture, x: number, y: number) {
  const t = tex.clone();
  t.repeat.set(x, y);
  t.needsUpdate = true;
  return t;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function brickTexture(base = "#8a5344") {
  return canvasTex(`brick:${base}`, 512, (g, n) => {
    g.fillStyle = shade(base, -58);
    g.fillRect(0, 0, n, n);
    const bh = 28;
    const bw = 64;
    let k = 0;
    for (let y = 0; y < n; y += bh) {
      const odd = Math.floor(y / bh) % 2 === 1;
      for (let x = odd ? -bw / 2 : 0; x < n; x += bw) {
        k += 1;
        const jitter = (hash(k) - 0.5) * 36;
        g.fillStyle = shade(base, jitter);
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        g.fillStyle = "rgba(255,230,200,0.12)";
        g.fillRect(x + 4, y + 3, bw - 10, 4);
        g.fillStyle = "rgba(20,8,4,0.22)";
        g.fillRect(x + 3, y + bh - 6, bw - 8, 3);
        if (hash(k + 9) > 0.82) {
          g.fillStyle = "rgba(40,20,12,0.28)";
          g.fillRect(x + 10 + hash(k) * 20, y + 8, 8, 6);
        }
      }
    }
    g.fillStyle = "rgba(12,8,6,0.08)";
    for (let i = 0; i < 80; i++) {
      g.fillRect(hash(i * 3) * n, hash(i * 7) * n, 3, 2);
    }
  });
}

export function grassTexture(base = "#5a7a3a") {
  return canvasTex(`grass:${base}`, 512, (g, n) => {
    g.fillStyle = shade(base, -18);
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 48; i++) {
      g.fillStyle = shade(base, (hash(i + 20) - 0.5) * 40);
      g.beginPath();
      g.ellipse(hash(i * 3.3) * n, hash(i * 8.1) * n, 18 + hash(i) * 28, 12 + hash(i + 1) * 18, hash(i) * 6, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 2800; i++) {
      const x = hash(i * 3.1) * n;
      const y = hash(i * 7.7) * n;
      const h = 5 + hash(i * 2.2) * 14;
      g.strokeStyle = shade(base, (hash(i) - 0.42) * 58);
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (hash(i + 4) - 0.5) * 5, y - h);
      g.stroke();
    }
    g.fillStyle = "rgba(40,28,12,0.16)";
    for (let i = 0; i < 36; i++) {
      g.beginPath();
      g.ellipse(hash(i + 90) * n, hash(i + 40) * n, 14, 8, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function stoneTexture(base = "#c8bca8") {
  return canvasTex(`stone:${base}`, 512, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 140; i++) {
      const x = hash(i * 1.7) * n;
      const y = hash(i * 4.1) * n;
      const r = 10 + hash(i * 2) * 42;
      g.fillStyle = shade(base, (hash(i + 3) - 0.5) * 42);
      g.beginPath();
      g.ellipse(x, y, r, r * 0.72, hash(i) * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "rgba(40,30,20,0.22)";
    g.lineWidth = 1.4;
    for (let i = 0; i < 28; i++) {
      g.beginPath();
      g.moveTo(hash(i * 9) * n, hash(i * 5) * n);
      g.lineTo(hash(i * 11) * n, hash(i * 8) * n);
      g.stroke();
    }
    g.fillStyle = "rgba(255,245,220,0.07)";
    for (let i = 0; i < 40; i++) {
      g.fillRect(hash(i * 13) * n, hash(i * 17) * n, 6, 3);
    }
  });
}

export function plasterTexture(base = "#d8cbb0") {
  return canvasTex(`plaster:${base}`, 256, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = shade(base, (hash(i) - 0.5) * 26);
      g.fillRect(hash(i * 2) * n, hash(i * 5) * n, 2, 2);
    }
    g.strokeStyle = "rgba(80,60,40,0.08)";
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.moveTo(hash(i * 4) * n, hash(i * 6) * n);
      g.lineTo(hash(i * 7) * n, hash(i * 9) * n);
      g.stroke();
    }
  });
}

export function dirtTexture(base = "#6a5438") {
  return canvasTex(`dirt:${base}`, 256, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = shade(base, (hash(i) - 0.5) * 48);
      g.fillRect(hash(i * 3) * n, hash(i * 7) * n, 3 + hash(i) * 3, 3);
    }
    g.fillStyle = "rgba(30,20,10,0.18)";
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      g.ellipse(hash(i + 2) * n, hash(i + 5) * n, 10, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function barkTexture(base = "#5a3a22") {
  return canvasTex(`bark:${base}`, 256, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += 6) {
      g.strokeStyle = shade(base, (hash(x) - 0.5) * 34);
      g.lineWidth = 2 + hash(x + 1) * 2.4;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + (hash(x + 2) - 0.5) * 8, n);
      g.stroke();
    }
    g.fillStyle = "rgba(20,10,4,0.2)";
    for (let i = 0; i < 20; i++) {
      g.fillRect(hash(i) * n, hash(i + 3) * n, 4, 10);
    }
  });
}

export function leafTexture(base = "#3f6a32") {
  return canvasTex(`leaf:${base}`, 256, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = shade(base, (hash(i) - 0.4) * 48);
      g.beginPath();
      g.ellipse(hash(i * 2) * n, hash(i * 5) * n, 8 + hash(i) * 12, 5 + hash(i + 1) * 8, hash(i) * 6, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function roadTexture(base = "#5a584e") {
  return canvasTex(`road:${base}`, 256, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = shade(base, (hash(i) - 0.5) * 28);
      g.fillRect(hash(i * 2) * n, hash(i * 6) * n, 4, 3);
    }
    g.fillStyle = "rgba(230,210,150,0.32)";
    g.fillRect(n * 0.48, 0, 3, n);
  });
}
