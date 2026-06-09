// server/domains/art.js
// Domain actions for visual art: color harmony analysis, composition scoring,
// palette generation, and style classification.
//
// Content-engine bridge: the `publish-as-texture` macro is the wire from
// the `art` lens into the evo_assets registry. Player-authored textures
// flow through evo-asset → /api/evo-asset/resolve → frontend pbr-loader
// (tier 1) → procedural-buildings material slots. See pbr-loader.ts for
// the 3-tier resolution order.

import fs from "fs";
import * as fsp from "node:fs/promises";
import path from "path";
import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";
import { registerAsset } from "../lib/evo-asset/registry.js";

const PROCEDURAL_KINDS = new Set([
  "stone", "wood", "brick", "cloth", "metal", "leather", "thatch", "dirt",
]);
const TEXTURE_CHANNELS = new Set(["color", "normal", "roughness", "ao"]);

// Match the data-dir resolution convention used by artifact-store.js.
const DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync("/workspace/concord-data") ? "/workspace/concord-data" : path.join(process.cwd(), "data"));
const LENS_ASSET_ROOT = path.join(DATA_DIR, "lens-assets", "art-textures");

// Decode a data URL (data:image/png;base64,...) → raw bytes Buffer.
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  try {
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length || buf.length > 20 * 1024 * 1024) return null;
    return { buf, ext };
  } catch {
    return null;
  }
}

export default function registerArtActions(registerLensAction) {
  registerLensAction("art", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("art");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  // Color theory helpers
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function rgbToLab(r, g, b) {
    // sRGB → XYZ → CIELAB
    let rr = r / 255, gg = g / 255, bb = b / 255;
    rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
    gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
    bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
    let x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
    let y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1.0;
    let z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    x = f(x); y = f(y); z = f(z);
    return { L: Math.round((116 * y - 16) * 100) / 100, a: Math.round((500 * (x - y)) * 100) / 100, b: Math.round((200 * (y - z)) * 100) / 100 };
  }

  function deltaE(lab1, lab2) {
    // CIE76 color difference
    return Math.sqrt(Math.pow(lab1.L - lab2.L, 2) + Math.pow(lab1.a - lab2.a, 2) + Math.pow(lab1.b - lab2.b, 2));
  }

  /**
   * colorHarmony
   * Analyze color palette for harmony relationships (complementary,
   * analogous, triadic, split-complementary, etc.).
   * artifact.data.palette = ["#hex", ...] or [{ hex, name? }, ...]
   */
  registerLensAction("art", "colorHarmony", (ctx, artifact, _params) => {
  try {
    const rawPalette = artifact.data?.palette || [];
    if (rawPalette.length === 0) return { ok: true, result: { message: "No palette provided." } };

    const colors = rawPalette.map(c => {
      const hex = typeof c === "string" ? c : c.hex;
      const rgb = hexToRgb(hex);
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
      return { hex, name: typeof c === "object" ? c.name : undefined, rgb, hsl, lab };
    });

    // Harmony detection based on hue relationships
    const hues = colors.map(c => c.hsl.h);
    const harmonies = [];

    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const diff = Math.abs(hues[i] - hues[j]);
        const hueDist = Math.min(diff, 360 - diff);

        if (hueDist >= 170 && hueDist <= 190) {
          harmonies.push({ type: "complementary", colors: [colors[i].hex, colors[j].hex], hueDistance: hueDist });
        } else if (hueDist <= 30) {
          harmonies.push({ type: "analogous", colors: [colors[i].hex, colors[j].hex], hueDistance: hueDist });
        } else if (hueDist >= 110 && hueDist <= 130) {
          harmonies.push({ type: "triadic", colors: [colors[i].hex, colors[j].hex], hueDistance: hueDist });
        } else if ((hueDist >= 140 && hueDist <= 160) || (hueDist >= 200 && hueDist <= 220)) {
          harmonies.push({ type: "split-complementary", colors: [colors[i].hex, colors[j].hex], hueDistance: hueDist });
        } else if (hueDist >= 80 && hueDist <= 100) {
          harmonies.push({ type: "square", colors: [colors[i].hex, colors[j].hex], hueDistance: hueDist });
        }
      }
    }

    // Color temperature analysis
    const temperatures = colors.map(c => {
      const h = c.hsl.h;
      let temp;
      if (h >= 0 && h <= 60) temp = "warm";
      else if (h > 60 && h <= 150) temp = "neutral-warm";
      else if (h > 150 && h <= 210) temp = "cool";
      else if (h > 210 && h <= 300) temp = "cool";
      else temp = "warm";
      return { hex: c.hex, temperature: temp };
    });
    const warmCount = temperatures.filter(t => t.temperature.includes("warm")).length;
    const coolCount = temperatures.filter(t => t.temperature.includes("cool")).length;
    const overallTemperature = warmCount > coolCount ? "warm" : coolCount > warmCount ? "cool" : "balanced";

    // Contrast matrix (WCAG-style relative luminance)
    const contrastPairs = [];
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const l1 = (0.2126 * colors[i].rgb.r + 0.7152 * colors[i].rgb.g + 0.0722 * colors[i].rgb.b) / 255;
        const l2 = (0.2126 * colors[j].rgb.r + 0.7152 * colors[j].rgb.g + 0.0722 * colors[j].rgb.b) / 255;
        const lighter = Math.max(l1, l2) + 0.05;
        const darker = Math.min(l1, l2) + 0.05;
        const ratio = Math.round((lighter / darker) * 100) / 100;
        const wcagAA = ratio >= 4.5;
        const wcagAAA = ratio >= 7;
        contrastPairs.push({
          pair: [colors[i].hex, colors[j].hex],
          contrastRatio: ratio, wcagAA, wcagAAA,
          deltaE: Math.round(deltaE(colors[i].lab, colors[j].lab) * 100) / 100,
        });
      }
    }

    // Overall palette harmony score
    const harmonyWeight = harmonies.length > 0 ? Math.min(harmonies.length / (colors.length * 0.5), 1) : 0;
    const contrastWeight = contrastPairs.some(p => p.wcagAA) ? 0.3 : 0;
    const saturationSpread = colors.map(c => c.hsl.s);
    const avgSat = saturationSpread.reduce((s, v) => s + v, 0) / saturationSpread.length;
    const satConsistency = 1 - (Math.sqrt(saturationSpread.reduce((s, v) => s + Math.pow(v - avgSat, 2), 0) / saturationSpread.length) / 50);
    const harmonyScore = Math.round(Math.min(1, harmonyWeight * 0.4 + contrastWeight + Math.max(0, satConsistency) * 0.3) * 100);

    return {
      ok: true, result: {
        colors, harmonies, temperature: overallTemperature,
        contrastPairs, harmonyScore,
        paletteSize: colors.length,
        dominantHue: hues.length > 0 ? Math.round(hues.reduce((s, h) => s + h, 0) / hues.length) : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * compositionScore
   * Evaluate visual composition from element positions and sizes.
   * artifact.data.elements = [{ x, y, width, height, weight?, type? }]
   * artifact.data.canvas = { width, height }
   * Scores based on rule of thirds, golden ratio, balance, and visual flow.
   */
  registerLensAction("art", "compositionScore", (ctx, artifact, _params) => {
  try {
    const elements = artifact.data?.elements || [];
    const canvas = artifact.data?.canvas || { width: 1920, height: 1080 };
    if (elements.length === 0) return { ok: true, result: { message: "No elements to analyze." } };

    const cw = canvas.width, ch = canvas.height;
    const scores = {};

    // 1. Rule of thirds: how close elements are to intersection points
    const thirdPoints = [
      { x: cw / 3, y: ch / 3 }, { x: 2 * cw / 3, y: ch / 3 },
      { x: cw / 3, y: 2 * ch / 3 }, { x: 2 * cw / 3, y: 2 * ch / 3 },
    ];

    const elementCenters = elements.map(el => ({
      cx: el.x + (el.width || 0) / 2,
      cy: el.y + (el.height || 0) / 2,
      weight: el.weight || 1,
    }));

    let thirdScore = 0;
    for (const center of elementCenters) {
      const minDist = Math.min(...thirdPoints.map(p =>
        Math.sqrt(Math.pow(center.cx - p.x, 2) + Math.pow(center.cy - p.y, 2))
      ));
      const maxDiag = Math.sqrt(cw * cw + ch * ch);
      const normalizedDist = minDist / maxDiag;
      thirdScore += Math.max(0, 1 - normalizedDist * 5) * center.weight;
    }
    const totalWeight = elementCenters.reduce((s, c) => s + c.weight, 0);
    scores.ruleOfThirds = Math.round((thirdScore / Math.max(totalWeight, 1)) * 100);

    // 2. Golden ratio proximity (φ = 1.618)
    const phi = 1.618;
    const goldenPoints = [
      { x: cw / phi, y: ch / phi }, { x: cw - cw / phi, y: ch / phi },
      { x: cw / phi, y: ch - ch / phi }, { x: cw - cw / phi, y: ch - ch / phi },
    ];
    let goldenScore = 0;
    for (const center of elementCenters) {
      const minDist = Math.min(...goldenPoints.map(p =>
        Math.sqrt(Math.pow(center.cx - p.x, 2) + Math.pow(center.cy - p.y, 2))
      ));
      const maxDiag = Math.sqrt(cw * cw + ch * ch);
      goldenScore += Math.max(0, 1 - minDist / maxDiag * 5) * center.weight;
    }
    scores.goldenRatio = Math.round((goldenScore / Math.max(totalWeight, 1)) * 100);

    // 3. Visual balance: weighted center of mass vs canvas center
    const comX = elementCenters.reduce((s, c) => s + c.cx * c.weight, 0) / totalWeight;
    const comY = elementCenters.reduce((s, c) => s + c.cy * c.weight, 0) / totalWeight;
    const centerOffsetX = Math.abs(comX - cw / 2) / (cw / 2);
    const centerOffsetY = Math.abs(comY - ch / 2) / (ch / 2);
    scores.balance = Math.round((1 - (centerOffsetX + centerOffsetY) / 2) * 100);

    // 4. White space ratio
    const totalElementArea = elements.reduce((s, el) => s + (el.width || 0) * (el.height || 0), 0);
    const canvasArea = cw * ch;
    const coverage = totalElementArea / canvasArea;
    // Ideal coverage is 40-60%
    const coveragePenalty = coverage < 0.2 ? 0.5 : coverage > 0.85 ? 0.3 : 1;
    scores.whitespace = Math.round(coveragePenalty * 100);

    // 5. Visual flow: do elements create a reading path (top-left to bottom-right)?
    const sorted = [...elementCenters].sort((a, b) => {
      const diagA = a.cx / cw + a.cy / ch;
      const diagB = b.cx / cw + b.cy / ch;
      return diagA - diagB;
    });
    let flowScore = 0;
    for (let i = 1; i < sorted.length; i++) {
      const dx = sorted[i].cx - sorted[i - 1].cx;
      const dy = sorted[i].cy - sorted[i - 1].cy;
      if (dx >= 0 || dy >= 0) flowScore++; // progresses rightward or downward
    }
    scores.visualFlow = sorted.length > 1 ? Math.round((flowScore / (sorted.length - 1)) * 100) : 50;

    // Overall weighted score
    const overall = Math.round(
      scores.ruleOfThirds * 0.25 +
      scores.goldenRatio * 0.15 +
      scores.balance * 0.25 +
      scores.whitespace * 0.15 +
      scores.visualFlow * 0.2
    );

    return {
      ok: true, result: {
        overall,
        rating: overall >= 80 ? "excellent" : overall >= 60 ? "good" : overall >= 40 ? "fair" : "needs_work",
        scores,
        centerOfMass: { x: Math.round(comX), y: Math.round(comY) },
        canvasCoverage: Math.round(coverage * 100),
        elementCount: elements.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * generatePalette
   * Generate harmonious color palettes from a base color.
   * params.baseColor = "#hex"
   * params.harmony = "complementary" | "analogous" | "triadic" | "split-complementary" | "monochromatic"
   * params.count = number of colors (default 5)
   */
  registerLensAction("art", "generatePalette", (ctx, artifact, params) => {
  try {
    const baseHex = params.baseColor || artifact.data?.baseColor || "#3498db";
    const harmony = params.harmony || "analogous";
    const count = params.count || 5;

    const rgb = hexToRgb(baseHex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

    function hslToHex(h, s, l) {
      h /= 360; s /= 100; l /= 100;
      let r, g, b;
      if (s === 0) { r = g = b = l; }
      else {
        const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      const toHex = x => Math.round(x * 255).toString(16).padStart(2, "0");
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    const palette = [];
    const addColor = (h, s, l, role) => {
      h = ((h % 360) + 360) % 360;
      s = Math.max(0, Math.min(100, s));
      l = Math.max(0, Math.min(100, l));
      palette.push({ hex: hslToHex(h, s, l), hsl: { h, s, l }, role });
    };

    switch (harmony) {
      case "complementary":
        addColor(hsl.h, hsl.s, hsl.l, "base");
        addColor(hsl.h + 180, hsl.s, hsl.l, "complement");
        // Fill remaining with tints/shades
        for (let i = 2; i < count; i++) {
          const lightness = hsl.l + (i - 2) * 15 - 15;
          addColor(hsl.h + (i % 2 === 0 ? 0 : 180), hsl.s, lightness, i % 2 === 0 ? "base-variant" : "complement-variant");
        }
        break;
      case "triadic":
        addColor(hsl.h, hsl.s, hsl.l, "base");
        addColor(hsl.h + 120, hsl.s, hsl.l, "triadic-1");
        addColor(hsl.h + 240, hsl.s, hsl.l, "triadic-2");
        for (let i = 3; i < count; i++) addColor(hsl.h + (i * 120), hsl.s - 10, hsl.l + 10, "variant");
        break;
      case "split-complementary":
        addColor(hsl.h, hsl.s, hsl.l, "base");
        addColor(hsl.h + 150, hsl.s, hsl.l, "split-1");
        addColor(hsl.h + 210, hsl.s, hsl.l, "split-2");
        for (let i = 3; i < count; i++) addColor(hsl.h, hsl.s - 15, hsl.l + (i - 2) * 12, "tint");
        break;
      case "monochromatic":
        for (let i = 0; i < count; i++) {
          const lightness = 20 + (i / (count - 1)) * 60;
          const saturation = hsl.s + (i % 2 === 0 ? 0 : -10);
          addColor(hsl.h, saturation, lightness, i === Math.floor(count / 2) ? "base" : "shade");
        }
        break;
      case "analogous":
      default: {
        const spread = 30;
        for (let i = 0; i < count; i++) {
          const offset = (i - Math.floor(count / 2)) * spread;
          addColor(hsl.h + offset, hsl.s, hsl.l + (i % 2 === 0 ? 0 : 5), i === Math.floor(count / 2) ? "base" : "analogous");
        }
        break;
      }
    }

    return {
      ok: true, result: {
        baseColor: baseHex, harmony, count: palette.length,
        palette: palette.slice(0, count),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * styleClassify
   * Classify artwork style from metadata attributes.
   * artifact.data.attributes = { brushwork, colorSaturation, contrast,
   *   perspective, detail, abstraction, lineWeight, texture }
   * Values are 0-100 scales.
   */
  registerLensAction("art", "styleClassify", (ctx, artifact, _params) => {
  try {
    const attrs = artifact.data?.attributes || {};
    const brushwork = attrs.brushwork ?? 50;
    const saturation = attrs.colorSaturation ?? 50;
    const contrast = attrs.contrast ?? 50;
    const perspective = attrs.perspective ?? 50;
    const detail = attrs.detail ?? 50;
    const abstraction = attrs.abstraction ?? 50;
    const lineWeight = attrs.lineWeight ?? 50;
    const texture = attrs.texture ?? 50;

    // Style matching via characteristic profiles
    const styles = [
      { name: "Impressionism", profile: { brushwork: 80, saturation: 70, contrast: 40, perspective: 40, detail: 30, abstraction: 40, lineWeight: 20, texture: 70 } },
      { name: "Realism", profile: { brushwork: 30, saturation: 50, contrast: 60, perspective: 80, detail: 90, abstraction: 10, lineWeight: 40, texture: 50 } },
      { name: "Abstract Expressionism", profile: { brushwork: 90, saturation: 60, contrast: 70, perspective: 10, detail: 20, abstraction: 95, lineWeight: 60, texture: 80 } },
      { name: "Minimalism", profile: { brushwork: 10, saturation: 30, contrast: 40, perspective: 30, detail: 20, abstraction: 80, lineWeight: 50, texture: 10 } },
      { name: "Pop Art", profile: { brushwork: 20, saturation: 95, contrast: 90, perspective: 30, detail: 50, abstraction: 50, lineWeight: 80, texture: 20 } },
      { name: "Baroque", profile: { brushwork: 60, saturation: 70, contrast: 85, perspective: 80, detail: 85, abstraction: 10, lineWeight: 40, texture: 60 } },
      { name: "Art Nouveau", profile: { brushwork: 40, saturation: 60, contrast: 50, perspective: 40, detail: 70, abstraction: 30, lineWeight: 90, texture: 50 } },
      { name: "Cubism", profile: { brushwork: 50, saturation: 50, contrast: 60, perspective: 10, detail: 40, abstraction: 80, lineWeight: 70, texture: 40 } },
      { name: "Surrealism", profile: { brushwork: 40, saturation: 55, contrast: 60, perspective: 60, detail: 75, abstraction: 70, lineWeight: 30, texture: 40 } },
      { name: "Watercolor", profile: { brushwork: 70, saturation: 40, contrast: 30, perspective: 50, detail: 40, abstraction: 20, lineWeight: 10, texture: 80 } },
    ];

    const input = { brushwork, saturation, contrast, perspective, detail, abstraction, lineWeight, texture };
    const keys = Object.keys(input);

    const matches = styles.map(style => {
      // Euclidean distance in 8D space, normalized
      const distance = Math.sqrt(
        keys.reduce((s, k) => s + Math.pow((input[k] - style.profile[k]) / 100, 2), 0)
      );
      const similarity = Math.round((1 - distance / Math.sqrt(keys.length)) * 100);
      return { style: style.name, similarity, distance: Math.round(distance * 1000) / 1000 };
    }).sort((a, b) => b.similarity - a.similarity);

    return {
      ok: true, result: {
        topMatch: matches[0],
        allMatches: matches,
        inputAttributes: input,
        confidence: matches[0].similarity > 70 ? "high" : matches[0].similarity > 50 ? "moderate" : "low",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Real museum collection APIs (free, no API key) ──

  /**
   * met-search — Metropolitan Museum of Art Collection. Free, no key.
   * 470,000+ objects.
   */
  registerLensAction("art", "met-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const hasImages = params.hasImages === true ? "&hasImages=true" : "";
    try {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}${hasImages}`);
      if (!r.ok) throw new Error(`met ${r.status}`);
      const data = await r.json();
      return {
        ok: true,
        result: {
          query,
          objectIds: (data.objectIDs || []).slice(0, 50),
          total: data.total || 0,
          source: "metmuseum",
        },
      };
    } catch (e) {
      return { ok: false, error: `met unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * met-object — Full object record by Met objectID.
   */
  registerLensAction("art", "met-object", async (_ctx, _artifact, params = {}) => {
    const objectId = Number(params.objectId);
    if (!Number.isFinite(objectId) || objectId <= 0) return { ok: false, error: "objectId required (Met collection object ID)" };
    try {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`);
      if (r.status === 404) return { ok: false, error: `Met object not found: ${objectId}` };
      if (!r.ok) throw new Error(`met ${r.status}`);
      const o = await r.json();
      return {
        ok: true,
        result: {
          objectId: o.objectID, isHighlight: o.isHighlight,
          accessionNumber: o.accessionNumber, accessionYear: o.accessionYear,
          title: o.title, artist: o.artistDisplayName,
          artistBio: o.artistDisplayBio, artistNationality: o.artistNationality,
          artistRole: o.artistRole,
          dated: o.objectDate, beginDate: o.objectBeginDate, endDate: o.objectEndDate,
          medium: o.medium, dimensions: o.dimensions,
          classification: o.classification, department: o.department,
          culture: o.culture, period: o.period, dynasty: o.dynasty,
          repository: o.repository,
          publicDomain: o.isPublicDomain,
          primaryImage: o.primaryImage, primaryImageSmall: o.primaryImageSmall,
          additionalImages: o.additionalImages || [],
          objectUrl: o.objectURL,
          tags: (o.tags || []).map((t) => t.term),
          source: "metmuseum",
        },
      };
    } catch (e) {
      return { ok: false, error: `met unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * aic-search — Art Institute of Chicago. Free, no key, 113,000+ artworks.
   * Returns full details + IIIF image URLs in one call.
   */
  registerLensAction("art", "aic-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 10));
    const fields = "id,title,artist_title,artist_display,date_display,date_start,date_end,medium_display,dimensions,image_id,classification_title,department_title,place_of_origin,style_title,is_public_domain";
    try {
      const r = await fetch(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`);
      if (!r.ok) throw new Error(`aic ${r.status}`);
      const data = await r.json();
      const artworks = (data.data || []).map((a) => ({
        id: a.id, title: a.title,
        artist: a.artist_title, artistDisplay: a.artist_display,
        dated: a.date_display, beginDate: a.date_start, endDate: a.date_end,
        medium: a.medium_display, dimensions: a.dimensions,
        classification: a.classification_title, department: a.department_title,
        placeOfOrigin: a.place_of_origin, style: a.style_title,
        publicDomain: a.is_public_domain,
        imageUrl: a.image_id ? `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg` : null,
      }));
      return {
        ok: true,
        result: {
          query, artworks, count: artworks.length,
          totalResults: data.pagination?.total,
          source: "art-institute-of-chicago",
        },
      };
    } catch (e) {
      return { ok: false, error: `aic unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Procreate + Krita 2026 parity — a real drawing studio ──────────
  // Layered vector-stroke artworks (replayable on an HTML5 canvas),
  // blend modes, brush presets, palettes with color-theory harmony,
  // reference boards, and rotating art prompts.

  function getArtState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.artLens) STATE.artLens = {};
    const s = STATE.artLens;
    for (const k of ["artworks", "palettes", "refBoards", "brushPresets"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveArtState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const atId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const atNow = () => new Date().toISOString();
  const atAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const atListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const atNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const atClamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, atNum(v, d)));
  const atClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const atHex = (v) => {
    const m = String(v || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(m) ? m : null;
  };

  const ART_TOOLS = ["pencil", "ink", "marker", "airbrush", "eraser", "fill"];
  const ART_BLEND_MODES = [
    "normal", "multiply", "screen", "overlay", "darken", "lighten",
    "color-dodge", "color-burn", "hard-light", "soft-light",
    "difference", "exclusion", "hue", "saturation", "color", "luminosity",
  ];
  const ART_MAX_POINTS = 5000;
  const ART_MAX_STROKES_PER_LAYER = 6000;
  const ART_MAX_LAYERS = 24;

  const ART_BRUSH_PRESETS = [
    { id: "sketch", name: "Sketch Pencil", tool: "pencil", size: 2, opacity: 0.65, hardness: 0.8 },
    { id: "pencil", name: "Pencil", tool: "pencil", size: 4, opacity: 1, hardness: 1 },
    { id: "ink", name: "Studio Ink", tool: "ink", size: 6, opacity: 1, hardness: 0.95 },
    { id: "round", name: "Hard Round", tool: "ink", size: 14, opacity: 1, hardness: 1 },
    { id: "marker", name: "Marker", tool: "marker", size: 20, opacity: 0.4, hardness: 0.7 },
    { id: "airbrush", name: "Soft Airbrush", tool: "airbrush", size: 44, opacity: 0.16, hardness: 0.1 },
    { id: "wash", name: "Wash", tool: "marker", size: 60, opacity: 0.12, hardness: 0.4 },
    { id: "eraser", name: "Eraser", tool: "eraser", size: 24, opacity: 1, hardness: 0.9 },
  ];

  // Real drawing-practice prompts.
  const ART_PROMPTS = [
    { category: "study", text: "A 5-minute gesture drawing of a figure in motion." },
    { category: "study", text: "A still life of three objects lit by a single light source." },
    { category: "study", text: "A value study in greyscale — five tones, no lines." },
    { category: "color", text: "Paint the same scene in a warm and then a cool palette." },
    { category: "color", text: "Use only three colors plus white for an entire piece." },
    { category: "color", text: "A monochromatic painting exploring one hue's full range." },
    { category: "imagination", text: "A creature that is half plant, half animal." },
    { category: "imagination", text: "Your favorite room redrawn 100 years in the future." },
    { category: "imagination", text: "An everyday object reimagined as a piece of architecture." },
    { category: "composition", text: "A landscape using the rule of thirds and a strong horizon." },
    { category: "composition", text: "A portrait where negative space tells half the story." },
    { category: "composition", text: "A scene built entirely from circles and triangles." },
    { category: "observation", text: "Draw your own hand without lifting your eyes from it." },
    { category: "observation", text: "Sketch the view from the nearest window." },
    { category: "expressive", text: "Draw a single emotion using only line weight and direction." },
  ];
  const ART_PROMPT_CATEGORIES = [...new Set(ART_PROMPTS.map((p) => p.category))];

  // ── Color theory helpers (array form — distinct from the {r,g,b}-object
  //    hexToRgb/rgbToHsl defined earlier; these return tuples) ──────────
  function hexToRgbArr(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function rgbToHex(r, g, b) {
    const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function rgbToHslArr(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, sat = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, sat, l];
  }
  function hslToHex(h, sat, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  // ── Stroke sanitisation ─────────────────────────────────────────────
  // An "element" generalises a stroke: polyline (default), fill, rect,
  // ellipse or text. Polyline strokes keep the original shape so legacy
  // data and the existing brush engine are unchanged.
  function sanitizeStroke(raw, art) {
    if (!raw || typeof raw !== "object") return null;
    const kind = ["stroke", "fill", "rect", "ellipse", "text"].includes(String(raw.kind))
      ? String(raw.kind) : "stroke";
    const color = atHex(raw.color) || "#222222";
    const opacity = atClamp(raw.opacity, 0.01, 1, 1);
    const cx = (v) => Math.round(atClamp(v, -art.width, art.width * 2, 0));
    const cy = (v) => Math.round(atClamp(v, -art.height, art.height * 2, 0));
    const base = { id: atId("stk"), kind, color, opacity };
    if (kind === "fill") {
      return { ...base, tool: "fill" };
    }
    if (kind === "text") {
      const content = atClean(raw.content, 500);
      if (!content) return null;
      return {
        ...base, tool: "text", content,
        x: cx(raw.x), y: cy(raw.y),
        fontSize: atClamp(raw.fontSize, 6, 400, 32),
      };
    }
    if (kind === "rect" || kind === "ellipse") {
      return {
        ...base, tool: kind, size: atClamp(raw.size, 0.5, 100, 6),
        x: cx(raw.x), y: cy(raw.y),
        w: Math.round(atClamp(raw.w, 0, art.width * 2, 0)),
        h: Math.round(atClamp(raw.h, 0, art.height * 2, 0)),
        filled: !!raw.filled,
      };
    }
    const tool = ART_TOOLS.includes(String(raw.tool)) ? String(raw.tool) : "ink";
    const size = atClamp(raw.size, 0.5, 400, 6);
    const pts = Array.isArray(raw.points) ? raw.points : [];
    const points = [];
    for (const p of pts.slice(0, ART_MAX_POINTS)) {
      if (Array.isArray(p) && p.length >= 2) points.push([cx(p[0]), cy(p[1])]);
    }
    if (!points.length) return null;
    return { ...base, tool, size, points };
  }
  // Apply a geometry function to every coordinate of an element.
  function transformElement(el, fn) {
    if (el.points) el.points = el.points.map((p) => fn(p[0], p[1]));
    if (typeof el.x === "number" && typeof el.y === "number") {
      const [nx, ny] = fn(el.x, el.y);
      el.x = nx; el.y = ny;
    }
  }

  // ── Artworks ────────────────────────────────────────────────────────
  registerLensAction("art", "artwork-create", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = atClean(params.title, 120) || "Untitled";
    const artwork = {
      id: atId("art"), title,
      width: Math.round(atClamp(params.width, 64, 4096, 1280)),
      height: Math.round(atClamp(params.height, 64, 4096, 800)),
      background: atHex(params.background) || "#ffffff",
      layers: [{ id: atId("lyr"), name: "Layer 1", visible: true, opacity: 1, blendMode: "normal", strokes: [] }],
      thumbnail: null,
      createdAt: atNow(), updatedAt: atNow(),
    };
    atListB(s.artworks, atAid(ctx)).push(artwork);
    saveArtState();
    return { ok: true, result: { artwork } };
  });

  registerLensAction("art", "artwork-list", (ctx, _a, _params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const artworks = (s.artworks.get(atAid(ctx)) || [])
      .map((a) => ({
        id: a.id, title: a.title, width: a.width, height: a.height,
        background: a.background, thumbnail: a.thumbnail,
        layerCount: a.layers.length,
        strokeCount: a.layers.reduce((n, l) => n + l.strokes.length, 0),
        updatedAt: a.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, result: { artworks, count: artworks.length } };
  });

  registerLensAction("art", "artwork-get", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const artwork = (s.artworks.get(atAid(ctx)) || []).find((a) => a.id === params.id);
    if (!artwork) return { ok: false, error: "artwork not found" };
    return { ok: true, result: { artwork } };
  });

  registerLensAction("art", "artwork-rename", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const artwork = (s.artworks.get(atAid(ctx)) || []).find((a) => a.id === params.id);
    if (!artwork) return { ok: false, error: "artwork not found" };
    const title = atClean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    artwork.title = title;
    artwork.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { id: artwork.id, title } };
  });

  registerLensAction("art", "artwork-save-thumbnail", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const artwork = (s.artworks.get(atAid(ctx)) || []).find((a) => a.id === params.id);
    if (!artwork) return { ok: false, error: "artwork not found" };
    const thumb = String(params.thumbnail || "");
    if (!thumb.startsWith("data:image/") || thumb.length > 400000) {
      return { ok: false, error: "thumbnail must be a data URL under 400KB" };
    }
    artwork.thumbnail = thumb;
    artwork.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { id: artwork.id, saved: true } };
  });

  registerLensAction("art", "artwork-resize", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const artwork = (s.artworks.get(atAid(ctx)) || []).find((a) => a.id === params.id);
    if (!artwork) return { ok: false, error: "artwork not found" };
    artwork.width = Math.round(atClamp(params.width, 64, 4096, artwork.width));
    artwork.height = Math.round(atClamp(params.height, 64, 4096, artwork.height));
    artwork.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { id: artwork.id, width: artwork.width, height: artwork.height } };
  });

  registerLensAction("art", "artwork-flip", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const artwork = (s.artworks.get(atAid(ctx)) || []).find((a) => a.id === params.id);
    if (!artwork) return { ok: false, error: "artwork not found" };
    const horizontal = params.axis !== "vertical";
    for (const layer of artwork.layers) {
      for (const el of layer.strokes) {
        transformElement(el, (x, y) => [
          horizontal ? artwork.width - x : x,
          horizontal ? y : artwork.height - y,
        ]);
        if (el.w != null && horizontal) el.x -= el.w;
        if (el.h != null && !horizontal) el.y -= el.h;
      }
    }
    artwork.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { id: artwork.id, axis: horizontal ? "horizontal" : "vertical" } };
  });

  registerLensAction("art", "artwork-delete", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.artworks.get(atAid(ctx)) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "artwork not found" };
    arr.splice(i, 1);
    saveArtState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Content-engine bridge: publish an artwork as a Concordia material texture ──
  //
  // The procedural-hand-authored content engine flow:
  //   1. Player creates an artwork in the `art` lens (canvas strokes)
  //   2. Client rasterises one or more PBR channels to PNG via canvas.toDataURL
  //   3. Client calls art.publish-as-texture per channel
  //   4. The macro writes the PNG to disk + registers an evo_assets row
  //      with source='authored', kind='texture', sourceId='material:<kind>:<seed>:<channel>'
  //   5. Frontend pbr-loader tier-1 resolves the channel at /api/evo-asset/resolve
  //      → procedural-buildings material slots upgrade transparently
  //   6. Marketplace canon votes pick winners; evo-asset scheduler refines on heartbeat
  //   7. Royalty cascade tracks every derivative for 50 generations
  //
  // Auth: requires ctx.actor.userId so the asset has a creator. Anon
  // submissions are rejected.
  registerLensAction("art", "publish-as-texture", async (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!userId || userId === "anon") {
      return { ok: false, error: "authentication required to publish a texture" };
    }

    const materialKind = String(params.materialKind || "").toLowerCase();
    if (!PROCEDURAL_KINDS.has(materialKind)) {
      return { ok: false, error: `materialKind must be one of: ${[...PROCEDURAL_KINDS].join(", ")}` };
    }
    const seed = Math.floor(atClamp(params.seed, 0, 0xffffffff, 1));
    const channel = String(params.channel || "color").toLowerCase();
    if (!TEXTURE_CHANNELS.has(channel)) {
      return { ok: false, error: `channel must be one of: ${[...TEXTURE_CHANNELS].join(", ")}` };
    }

    const decoded = decodeDataUrl(params.imageDataUrl);
    if (!decoded) {
      return { ok: false, error: "imageDataUrl must be a base64 data: URL (png or jpeg, ≤20 MB)" };
    }

    const s = getArtState();
    const artworkId = params.artworkId ? String(params.artworkId).slice(0, 64) : null;
    if (artworkId && s) {
      const arr = s.artworks.get(userId) || [];
      const found = arr.find((a) => a.id === artworkId);
      if (!found) return { ok: false, error: "artwork not found" };
    }

    // Slot key: stable per (kind, seed, channel) so derivative authors
    // converge on the same canonical slot and the marketplace can rank
    // them against each other.
    const sourceId = `material:${materialKind}:${seed}:${channel}`;
    const fileName = `${materialKind}-${seed}-${channel}.${decoded.ext}`;
    const dirPath = path.join(LENS_ASSET_ROOT, materialKind, String(seed));
    const filePath = path.join(dirPath, fileName);

    try {
      // Async fs — a ≤20 MB texture write must not block the event loop.
      await fsp.mkdir(dirPath, { recursive: true });
      await fsp.writeFile(filePath, decoded.buf);
    } catch (err) {
      return { ok: false, error: `failed to write asset file: ${err?.message || err}` };
    }

    let assetResult;
    try {
      assetResult = registerAsset(db, {
        kind: "texture",
        source: "authored",
        sourceId,
        localPath: filePath,
        category: `material:${materialKind}:${channel}`,
        tags: ["art-lens", materialKind, channel, `seed:${seed}`, `creator:${userId}`],
        qualityLevel: 1,
      });
    } catch (err) {
      // Roll back the file write so we don't leave orphans
      await fsp.unlink(filePath).catch(() => { /* idempotent */ });
      return { ok: false, error: `failed to register asset: ${err?.message || err}` };
    }

    return {
      ok: true,
      result: {
        assetId: assetResult.id,
        created: assetResult.created,
        sourceId,
        materialKind,
        seed,
        channel,
        sizeBytes: decoded.buf.length,
        resolveUrl: `/api/evo-asset/resolve?source=authored&sourceId=${encodeURIComponent(sourceId)}`,
      },
    };
  });

  // Convenience: which (kind, seed, channel) sourceIds the player's
  // current authorship covers. Lets the art lens UI render a "you've
  // published 2/4 channels for material:wood:1" indicator.
  registerLensAction("art", "published-texture-coverage", (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const materialKind = String(params.materialKind || "").toLowerCase();
    if (!PROCEDURAL_KINDS.has(materialKind)) {
      return { ok: false, error: `materialKind must be one of: ${[...PROCEDURAL_KINDS].join(", ")}` };
    }
    const seed = Math.floor(atClamp(params.seed, 0, 0xffffffff, 1));
    const channels = {};
    for (const ch of TEXTURE_CHANNELS) {
      const sourceId = `material:${materialKind}:${seed}:${ch}`;
      const row = db
        .prepare("SELECT id, quality_level, evolution_score FROM evo_assets WHERE source = 'authored' AND source_id = ? AND archived_at IS NULL")
        .get(sourceId);
      channels[ch] = row
        ? { assetId: row.id, qualityLevel: row.quality_level, evolutionScore: row.evolution_score }
        : null;
    }
    return { ok: true, result: { materialKind, seed, channels } };
  });

  // ── Layers ──────────────────────────────────────────────────────────
  function findArt(s, userId, artworkId) {
    return (s.artworks.get(userId) || []).find((a) => a.id === artworkId) || null;
  }

  registerLensAction("art", "layer-add", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    if (art.layers.length >= ART_MAX_LAYERS) return { ok: false, error: `layer limit (${ART_MAX_LAYERS}) reached` };
    const layer = {
      id: atId("lyr"),
      name: atClean(params.name, 60) || `Layer ${art.layers.length + 1}`,
      visible: true, opacity: 1, blendMode: "normal", strokes: [],
    };
    art.layers.push(layer);
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layer } };
  });

  registerLensAction("art", "layer-update", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (params.name != null) layer.name = atClean(params.name, 60) || layer.name;
    if (params.visible != null) layer.visible = !!params.visible;
    if (params.opacity != null) layer.opacity = atClamp(params.opacity, 0, 1, layer.opacity);
    if (params.blendMode != null && ART_BLEND_MODES.includes(String(params.blendMode))) {
      layer.blendMode = String(params.blendMode);
    }
    if (params.locked != null) layer.locked = !!params.locked;
    if (params.clipped != null) layer.clipped = !!params.clipped;
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layer: { ...layer, strokes: undefined, strokeCount: layer.strokes.length } } };
  });

  // ── Layer operations — duplicate, merge, transform, adjust ──────────
  registerLensAction("art", "layer-duplicate", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    if (art.layers.length >= ART_MAX_LAYERS) return { ok: false, error: `layer limit (${ART_MAX_LAYERS}) reached` };
    const i = art.layers.findIndex((l) => l.id === params.layerId);
    if (i < 0) return { ok: false, error: "layer not found" };
    const src = art.layers[i];
    const copy = {
      id: atId("lyr"), name: `${src.name} copy`,
      visible: true, opacity: src.opacity, blendMode: src.blendMode,
      locked: false, clipped: src.clipped || false, redo: [],
      strokes: src.strokes.map((st) => ({
        ...st, id: atId("stk"),
        points: st.points ? st.points.map((p) => [...p]) : undefined,
      })),
    };
    art.layers.splice(i + 1, 0, copy);
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layer: { ...copy, strokes: undefined, strokeCount: copy.strokes.length } } };
  });

  registerLensAction("art", "layer-merge-down", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const i = art.layers.findIndex((l) => l.id === params.layerId);
    if (i <= 0) return { ok: false, error: "no layer below to merge into" };
    const below = art.layers[i - 1];
    below.strokes = below.strokes.concat(art.layers[i].strokes).slice(0, ART_MAX_STROKES_PER_LAYER);
    art.layers.splice(i, 1);
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { mergedInto: below.id, strokeCount: below.strokes.length } };
  });

  registerLensAction("art", "layer-transform", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const dx = atNum(params.dx);
    const dy = atNum(params.dy);
    const scale = atClamp(params.scale, 0.05, 20, 1);
    const cxC = art.width / 2;
    const cyC = art.height / 2;
    const ids = Array.isArray(params.ids) && params.ids.length ? new Set(params.ids.map(String)) : null;
    const fn = (x, y) => [
      Math.round(cxC + (x - cxC) * scale + dx),
      Math.round(cyC + (y - cyC) * scale + dy),
    ];
    for (const el of layer.strokes) {
      if (ids && !ids.has(el.id)) continue;
      transformElement(el, fn);
      if (el.w != null) el.w = Math.round(el.w * scale);
      if (el.h != null) el.h = Math.round(el.h * scale);
      if (el.fontSize != null) el.fontSize = Math.max(6, Math.round(el.fontSize * scale));
    }
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layerId: layer.id, transformed: ids ? ids.size : layer.strokes.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("art", "layer-flip", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const horizontal = params.axis !== "vertical";
    for (const el of layer.strokes) {
      transformElement(el, (x, y) => [
        horizontal ? art.width - x : x,
        horizontal ? y : art.height - y,
      ]);
      // anchor rect/text top-left after flip
      if (el.w != null && horizontal) el.x -= el.w;
      if (el.h != null && !horizontal) el.y -= el.h;
    }
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layerId: layer.id, axis: horizontal ? "horizontal" : "vertical" } };
  });

  registerLensAction("art", "layer-rotate90", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const cw = params.direction !== "ccw";
    const cxC = art.width / 2;
    const cyC = art.height / 2;
    for (const el of layer.strokes) {
      transformElement(el, (x, y) => (cw
        ? [Math.round(cxC - (y - cyC)), Math.round(cyC + (x - cxC))]
        : [Math.round(cxC + (y - cyC)), Math.round(cyC - (x - cxC))]));
      if (el.w != null && el.h != null) { const t = el.w; el.w = el.h; el.h = t; }
    }
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layerId: layer.id, direction: cw ? "cw" : "ccw" } };
  });

  registerLensAction("art", "layer-adjust-color", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const hueShift = atNum(params.hueShift);
    const satScale = atClamp(params.satScale, 0, 3, 1);
    const lightScale = atClamp(params.lightScale, 0, 3, 1);
    for (const el of layer.strokes) {
      if (!el.color) continue;
      const [h, sat, l] = rgbToHslArr(...hexToRgbArr(el.color));
      el.color = hslToHex(h + hueShift, Math.max(0, Math.min(1, sat * satScale)), Math.max(0, Math.min(1, l * lightScale)));
    }
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layerId: layer.id, adjusted: layer.strokes.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("art", "layer-delete", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    if (art.layers.length <= 1) return { ok: false, error: "an artwork needs at least one layer" };
    const i = art.layers.findIndex((l) => l.id === params.layerId);
    if (i < 0) return { ok: false, error: "layer not found" };
    art.layers.splice(i, 1);
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { deleted: params.layerId } };
  });

  registerLensAction("art", "layer-reorder", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const i = art.layers.findIndex((l) => l.id === params.layerId);
    if (i < 0) return { ok: false, error: "layer not found" };
    const dir = params.direction === "up" ? 1 : -1;   // up = toward top of stack (end of array)
    const j = i + dir;
    if (j < 0 || j >= art.layers.length) return { ok: true, result: { order: art.layers.map((l) => l.id) } };
    [art.layers[i], art.layers[j]] = [art.layers[j], art.layers[i]];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { order: art.layers.map((l) => l.id) } };
  });

  // ── Strokes — the actual drawing ────────────────────────────────────
  registerLensAction("art", "stroke-commit", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.strokes.length >= ART_MAX_STROKES_PER_LAYER) {
      return { ok: false, error: "layer stroke limit reached" };
    }
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const stroke = sanitizeStroke(params.stroke, art);
    if (!stroke) return { ok: false, error: "invalid stroke" };
    layer.strokes.push(stroke);
    layer.redo = [];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { strokeId: stroke.id, strokeCount: layer.strokes.length } };
  });

  registerLensAction("art", "stroke-batch", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const incoming = Array.isArray(params.strokes) ? params.strokes : [];
    let added = 0;
    for (const raw of incoming) {
      if (layer.strokes.length >= ART_MAX_STROKES_PER_LAYER) break;
      const stroke = sanitizeStroke(raw, art);
      if (stroke) { layer.strokes.push(stroke); added += 1; }
    }
    if (added) layer.redo = [];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { added, strokeCount: layer.strokes.length } };
  });

  registerLensAction("art", "stroke-undo", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (!Array.isArray(layer.redo)) layer.redo = [];
    const removed = layer.strokes.pop() || null;
    if (removed) layer.redo.push(removed);
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { removed: removed?.id || null, strokeCount: layer.strokes.length } };
  });

  registerLensAction("art", "stroke-redo", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (!Array.isArray(layer.redo) || !layer.redo.length) {
      return { ok: true, result: { restored: null, strokeCount: layer.strokes.length } };
    }
    const restored = layer.redo.pop();
    layer.strokes.push(restored);
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { restored: restored.id, strokeCount: layer.strokes.length } };
  });

  registerLensAction("art", "element-delete", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const ids = new Set(Array.isArray(params.ids) ? params.ids.map(String) : []);
    if (!ids.size) return { ok: false, error: "ids required" };
    const before = layer.strokes.length;
    layer.strokes = layer.strokes.filter((el) => !ids.has(el.id));
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { deleted: before - layer.strokes.length } };
  });

  registerLensAction("art", "layer-clear", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    layer.strokes = [];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { cleared: layer.id } };
  });

  // ── Brush presets ───────────────────────────────────────────────────
  registerLensAction("art", "brush-presets", (ctx, _a, _params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userBrushes = s.brushPresets.get(atAid(ctx)) || [];
    return {
      ok: true,
      result: { brushes: [...ART_BRUSH_PRESETS, ...userBrushes], blendModes: ART_BLEND_MODES },
    };
  });

  registerLensAction("art", "brush-preset-save", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = atClean(params.name, 60);
    if (!name) return { ok: false, error: "brush name required" };
    const brush = {
      id: atId("brush"), name,
      tool: ART_TOOLS.includes(String(params.tool)) ? String(params.tool) : "ink",
      size: atClamp(params.size, 0.5, 400, 8),
      opacity: atClamp(params.opacity, 0.01, 1, 1),
      custom: true,
    };
    atListB(s.brushPresets, atAid(ctx)).push(brush);
    saveArtState();
    return { ok: true, result: { brush } };
  });

  registerLensAction("art", "brush-preset-delete", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.brushPresets.get(atAid(ctx)) || [];
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "brush preset not found" };
    arr.splice(i, 1);
    saveArtState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Palettes ────────────────────────────────────────────────────────
  registerLensAction("art", "palette-create", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = atClean(params.name, 80);
    if (!name) return { ok: false, error: "palette name required" };
    const colors = (Array.isArray(params.colors) ? params.colors : [])
      .map(atHex).filter(Boolean).slice(0, 24);
    if (!colors.length) return { ok: false, error: "at least one valid hex color required" };
    const palette = { id: atId("pal"), name, colors, createdAt: atNow() };
    atListB(s.palettes, atAid(ctx)).push(palette);
    saveArtState();
    return { ok: true, result: { palette } };
  });

  registerLensAction("art", "palette-list", (ctx, _a, _params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const palettes = [...(s.palettes.get(atAid(ctx)) || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { palettes, count: palettes.length } };
  });

  registerLensAction("art", "palette-delete", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.palettes.get(atAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "palette not found" };
    arr.splice(i, 1);
    saveArtState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("art", "palette-harmony", (_ctx, _a, params = {}) => {
  try {
    const base = atHex(params.baseColor);
    if (!base) return { ok: false, error: "baseColor must be a #rrggbb hex" };
    const scheme = ["complementary", "analogous", "triadic", "tetradic", "split-complementary", "monochromatic"]
      .includes(String(params.scheme)) ? String(params.scheme) : "analogous";
    const [h, sat, l] = rgbToHslArr(...hexToRgbArr(base));
    let colors;
    if (scheme === "complementary") colors = [base, hslToHex(h + 180, sat, l)];
    else if (scheme === "triadic") colors = [base, hslToHex(h + 120, sat, l), hslToHex(h + 240, sat, l)];
    else if (scheme === "tetradic") colors = [base, hslToHex(h + 90, sat, l), hslToHex(h + 180, sat, l), hslToHex(h + 270, sat, l)];
    else if (scheme === "split-complementary") colors = [base, hslToHex(h + 150, sat, l), hslToHex(h + 210, sat, l)];
    else if (scheme === "monochromatic") {
      colors = [0.25, 0.4, 0.55, 0.7, 0.85].map((ll) => hslToHex(h, sat, ll));
    } else colors = [hslToHex(h - 30, sat, l), base, hslToHex(h + 30, sat, l)];
    return { ok: true, result: { baseColor: base, scheme, colors } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("art", "color-mix", (_ctx, _a, params = {}) => {
    const a = atHex(params.colorA), b = atHex(params.colorB);
    if (!a || !b) return { ok: false, error: "colorA and colorB must be #rrggbb hex" };
    const ratio = atClamp(params.ratio, 0, 1, 0.5);
    const [ar, ag, ab] = hexToRgbArr(a);
    const [br, bg, bb] = hexToRgbArr(b);
    const mixed = rgbToHex(
      ar + (br - ar) * ratio, ag + (bg - ag) * ratio, ab + (bb - ab) * ratio,
    );
    return { ok: true, result: { colorA: a, colorB: b, ratio, mixed } };
  });

  // ── Reference boards ────────────────────────────────────────────────
  registerLensAction("art", "reference-board-create", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = atClean(params.name, 80);
    if (!name) return { ok: false, error: "board name required" };
    const board = { id: atId("ref"), name, refs: [], createdAt: atNow() };
    atListB(s.refBoards, atAid(ctx)).push(board);
    saveArtState();
    return { ok: true, result: { board } };
  });

  registerLensAction("art", "reference-board-list", (ctx, _a, _params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const boards = s.refBoards.get(atAid(ctx)) || [];
    return { ok: true, result: { boards, count: boards.length } };
  });

  registerLensAction("art", "reference-add", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = (s.refBoards.get(atAid(ctx)) || []).find((b) => b.id === params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const imageUrl = atClean(params.imageUrl, 600);
    if (!/^https?:\/\//.test(imageUrl)) return { ok: false, error: "imageUrl must be an http(s) URL" };
    const ref = { id: atId("img"), imageUrl, note: atClean(params.note, 200) || null, addedAt: atNow() };
    board.refs.push(ref);
    saveArtState();
    return { ok: true, result: { ref } };
  });

  registerLensAction("art", "reference-remove", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = (s.refBoards.get(atAid(ctx)) || []).find((b) => b.id === params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const i = board.refs.findIndex((r) => r.id === params.refId);
    if (i < 0) return { ok: false, error: "reference not found" };
    board.refs.splice(i, 1);
    saveArtState();
    return { ok: true, result: { removed: params.refId } };
  });

  registerLensAction("art", "reference-board-delete", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.refBoards.get(atAid(ctx)) || [];
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "board not found" };
    arr.splice(i, 1);
    saveArtState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Art prompts ─────────────────────────────────────────────────────
  registerLensAction("art", "art-prompt", (_ctx, _a, params = {}) => {
    if (params.random) {
      let pool = ART_PROMPTS;
      if (params.category) {
        const c = String(params.category).toLowerCase();
        const filtered = ART_PROMPTS.filter((p) => p.category === c);
        if (filtered.length) pool = filtered;
      }
      return { ok: true, result: { prompt: pool[Math.floor(Math.random() * pool.length)], categories: ART_PROMPT_CATEGORIES } };
    }
    const dayIdx = Math.floor(Date.now() / 86400000) % ART_PROMPTS.length;
    return { ok: true, result: { prompt: ART_PROMPTS[dayIdx], categories: ART_PROMPT_CATEGORIES } };
  });

  // ─── Procreate / Krita parity backlog ───────────────────────────────
  // Raster filters, pressure dynamics, free-angle rotation, selection
  // refinement (lasso / magic-wand / feather), symmetry & perspective
  // guides, timelapse recording and a gradient / pattern fill engine.
  // All operate on the persisted vector element model so they replay
  // deterministically on the client canvas.

  const ART_FILTER_KINDS = ["gaussian-blur", "sharpen", "liquify"];
  const ART_GUIDE_KINDS = ["off", "vertical", "horizontal", "quadrant", "radial", "perspective-1pt", "perspective-2pt"];
  const ART_GRADIENT_KINDS = ["linear", "radial"];
  const ART_PATTERN_KINDS = ["dots", "grid", "diagonal", "checker", "crosshatch"];
  const ART_MAX_TIMELAPSE_FRAMES = 2000;

  // ── 1. Raster filters — Gaussian blur / sharpen / liquify ────────────
  // Filters are recorded as a per-layer effect stack so the canvas can
  // apply a CanvasFilter / pixel-shader pass when rasterising the layer.
  registerLensAction("art", "layer-apply-filter", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const kind = ART_FILTER_KINDS.includes(String(params.kind)) ? String(params.kind) : null;
    if (!kind) return { ok: false, error: `kind must be one of ${ART_FILTER_KINDS.join(", ")}` };
    if (!Array.isArray(layer.filters)) layer.filters = [];
    const filter = {
      id: atId("flt"), kind,
      // amount is the blur radius (px), sharpen strength, or liquify push
      amount: atClamp(params.amount, 0.1, 200, kind === "gaussian-blur" ? 8 : kind === "sharpen" ? 1 : 24),
      createdAt: atNow(),
    };
    if (kind === "liquify") {
      // a liquify pass needs a center + direction the brush pushed
      filter.cx = Math.round(atClamp(params.cx, 0, art.width, art.width / 2));
      filter.cy = Math.round(atClamp(params.cy, 0, art.height, art.height / 2));
      filter.dx = Math.round(atClamp(params.dx, -art.width, art.width, 0));
      filter.dy = Math.round(atClamp(params.dy, -art.height, art.height, 0));
      filter.radius = Math.round(atClamp(params.radius, 4, art.width, 80));
    }
    layer.filters.push(filter);
    if (layer.filters.length > 32) layer.filters.shift();
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layerId: layer.id, filter, filterCount: layer.filters.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("art", "layer-clear-filters", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const before = Array.isArray(layer.filters) ? layer.filters.length : 0;
    layer.filters = [];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layerId: layer.id, cleared: before } };
  });

  // ── 2. Pressure-sensitive stylus dynamics ────────────────────────────
  // Persist a per-artwork dynamics profile that maps stylus pressure to
  // size & opacity, and accept commit of pressure-bearing strokes whose
  // per-point [x,y,pressure] triplets are kept for variable-width replay.
  registerLensAction("art", "dynamics-set", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    art.dynamics = {
      pressureSize: !!params.pressureSize,
      pressureOpacity: !!params.pressureOpacity,
      // minimum fraction of size/opacity at zero pressure
      sizeFloor: atClamp(params.sizeFloor, 0, 1, 0.2),
      opacityFloor: atClamp(params.opacityFloor, 0, 1, 0.3),
      // smoothing pulls jittery input toward the running average
      smoothing: atClamp(params.smoothing, 0, 1, 0.4),
      // velocity-to-size taper (faster stroke → thinner line)
      velocityTaper: atClamp(params.velocityTaper, 0, 1, 0),
    };
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { dynamics: art.dynamics } };
  });

  registerLensAction("art", "dynamics-get", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    return {
      ok: true,
      result: {
        dynamics: art.dynamics || {
          pressureSize: false, pressureOpacity: false,
          sizeFloor: 0.2, opacityFloor: 0.3, smoothing: 0.4, velocityTaper: 0,
        },
      },
    };
  });

  // Commit a stroke that carries per-point pressure. Points are
  // [x, y, pressure] triplets (pressure 0..1). Stored as a pressure
  // stroke so the client renders a variable-width ribbon.
  registerLensAction("art", "stroke-commit-pressure", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    if (layer.strokes.length >= ART_MAX_STROKES_PER_LAYER) {
      return { ok: false, error: "layer stroke limit reached" };
    }
    const raw = params.stroke || {};
    const tool = ART_TOOLS.includes(String(raw.tool)) ? String(raw.tool) : "ink";
    const color = atHex(raw.color) || "#222222";
    const size = atClamp(raw.size, 0.5, 400, 6);
    const opacity = atClamp(raw.opacity, 0.01, 1, 1);
    const cx = (v) => Math.round(atClamp(v, -art.width, art.width * 2, 0));
    const cy = (v) => Math.round(atClamp(v, -art.height, art.height * 2, 0));
    const pts = Array.isArray(raw.points) ? raw.points : [];
    const points = [];
    for (const p of pts.slice(0, ART_MAX_POINTS)) {
      if (Array.isArray(p) && p.length >= 2) {
        const pr = p.length >= 3 ? atClamp(p[2], 0, 1, 1) : 1;
        points.push([cx(p[0]), cy(p[1]), Math.round(pr * 1000) / 1000]);
      }
    }
    if (!points.length) return { ok: false, error: "invalid stroke" };
    const stroke = {
      id: atId("stk"), kind: "stroke", tool, color, size, opacity,
      points, pressure: true,
    };
    layer.strokes.push(stroke);
    layer.redo = [];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { strokeId: stroke.id, strokeCount: layer.strokes.length, pointsKept: points.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 3. Free-angle (non-90°) layer rotation ───────────────────────────
  registerLensAction("art", "layer-rotate", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    let deg = atNum(params.degrees);
    deg = ((deg % 360) + 360) % 360;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // rotate about an explicit pivot, defaulting to the canvas centre
    const px = atClamp(params.pivotX, 0, art.width, art.width / 2);
    const py = atClamp(params.pivotY, 0, art.height, art.height / 2);
    const ids = Array.isArray(params.ids) && params.ids.length ? new Set(params.ids.map(String)) : null;
    const fn = (x, y) => {
      const ox = x - px, oy = y - py;
      return [
        Math.round(px + ox * cos - oy * sin),
        Math.round(py + ox * sin + oy * cos),
      ];
    };
    let rotated = 0;
    for (const el of layer.strokes) {
      if (ids && !ids.has(el.id)) continue;
      transformElement(el, fn);
      // carry the cumulative rotation on rect/text so the client renders
      // a rotated bounding box rather than an axis-aligned one
      if (el.kind === "rect" || el.kind === "ellipse" || el.kind === "text") {
        el.rotation = (((el.rotation || 0) + deg) % 360);
      }
      rotated += 1;
    }
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { layerId: layer.id, degrees: deg, rotated } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 4. Selection refinement — lasso, magic-wand, feathering ──────────
  // A selection is a polygon (lasso) or a tolerance-based color match
  // (magic-wand) with an optional feather radius. Persisted on the
  // artwork so subsequent edits can scope to it.
  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y))
        && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  registerLensAction("art", "selection-lasso", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const raw = Array.isArray(params.polygon) ? params.polygon : [];
    const polygon = [];
    for (const p of raw.slice(0, 400)) {
      if (Array.isArray(p) && p.length >= 2) {
        polygon.push([
          Math.round(atClamp(p[0], 0, art.width, 0)),
          Math.round(atClamp(p[1], 0, art.height, 0)),
        ]);
      }
    }
    if (polygon.length < 3) return { ok: false, error: "lasso needs at least 3 points" };
    const feather = atClamp(params.feather, 0, 200, 0);
    // an element is selected if any of its representative points fall inside
    const matched = [];
    for (const el of layer.strokes) {
      const reps = el.points
        ? el.points
        : (typeof el.x === "number" ? [[el.x, el.y]] : []);
      if (reps.some((p) => pointInPolygon(p[0], p[1], polygon))) matched.push(el.id);
    }
    art.selection = { kind: "lasso", layerId: layer.id, polygon, feather, ids: matched, createdAt: atNow() };
    saveArtState();
    return { ok: true, result: { selection: art.selection, matched: matched.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("art", "selection-magic-wand", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const target = atHex(params.targetColor);
    if (!target) return { ok: false, error: "targetColor must be a #rrggbb hex" };
    // tolerance is a 0..100 perceptual distance in CIELAB ΔE
    const tolerance = atClamp(params.tolerance, 0, 100, 24);
    const feather = atClamp(params.feather, 0, 200, 0);
    const [tr, tg, tb] = hexToRgbArr(target);
    const targetLab = rgbToLab(tr, tg, tb);
    const matched = [];
    for (const el of layer.strokes) {
      if (!el.color) continue;
      const [r, g, b] = hexToRgbArr(el.color);
      const d = deltaE(targetLab, rgbToLab(r, g, b));
      if (d <= tolerance) matched.push(el.id);
    }
    art.selection = {
      kind: "magic-wand", layerId: layer.id,
      targetColor: target, tolerance, feather, ids: matched, createdAt: atNow(),
    };
    saveArtState();
    return { ok: true, result: { selection: art.selection, matched: matched.length } };
  });

  registerLensAction("art", "selection-feather", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    if (!art.selection) return { ok: false, error: "no active selection" };
    art.selection.feather = atClamp(params.feather, 0, 200, art.selection.feather || 0);
    saveArtState();
    return { ok: true, result: { selection: art.selection } };
  });

  registerLensAction("art", "selection-clear", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const had = !!art.selection;
    art.selection = null;
    saveArtState();
    return { ok: true, result: { cleared: had } };
  });

  // ── 5. Symmetry / drawing guides & perspective assist ────────────────
  registerLensAction("art", "guides-set", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const kind = ART_GUIDE_KINDS.includes(String(params.kind)) ? String(params.kind) : "off";
    const cx = Math.round(atClamp(params.cx, 0, art.width, art.width / 2));
    const cy = Math.round(atClamp(params.cy, 0, art.height, art.height / 2));
    const guides = { kind, cx, cy };
    if (kind === "radial") {
      // number of mirrored sectors (mandala mode)
      guides.sectors = Math.round(atClamp(params.sectors, 2, 24, 8));
    }
    if (kind === "perspective-1pt" || kind === "perspective-2pt") {
      guides.vp1 = {
        x: Math.round(atClamp(params.vp1x, -art.width, art.width * 2, art.width / 3)),
        y: Math.round(atClamp(params.vp1y, -art.height, art.height * 2, art.height / 2)),
      };
      if (kind === "perspective-2pt") {
        guides.vp2 = {
          x: Math.round(atClamp(params.vp2x, -art.width, art.width * 2, (2 * art.width) / 3)),
          y: Math.round(atClamp(params.vp2y, -art.height, art.height * 2, art.height / 2)),
        };
      }
    }
    art.guides = guides;
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { guides } };
  });

  registerLensAction("art", "guides-get", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    return { ok: true, result: { guides: art.guides || { kind: "off" }, kinds: ART_GUIDE_KINDS } };
  });

  // Mirror a committed stroke across the active symmetry guide so the
  // client can both render live and persist the mirrored copies.
  registerLensAction("art", "symmetry-mirror-stroke", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const guides = art.guides;
    if (!guides || guides.kind === "off") return { ok: false, error: "no active symmetry guide" };
    const src = layer.strokes.find((st) => st.id === params.strokeId);
    if (!src) return { ok: false, error: "stroke not found" };
    const cx = guides.cx, cy = guides.cy;
    const mirrors = [];
    const cloneWith = (fn) => {
      const copy = {
        ...src, id: atId("stk"),
        points: src.points ? src.points.map((p) => {
          const [nx, ny] = fn(p[0], p[1]);
          return p.length >= 3 ? [nx, ny, p[2]] : [nx, ny];
        }) : undefined,
      };
      if (typeof src.x === "number" && typeof src.y === "number") {
        const [nx, ny] = fn(src.x, src.y);
        copy.x = nx; copy.y = ny;
      }
      return copy;
    };
    if (guides.kind === "vertical") {
      mirrors.push(cloneWith((x, y) => [2 * cx - x, y]));
    } else if (guides.kind === "horizontal") {
      mirrors.push(cloneWith((x, y) => [x, 2 * cy - y]));
    } else if (guides.kind === "quadrant") {
      mirrors.push(cloneWith((x, y) => [2 * cx - x, y]));
      mirrors.push(cloneWith((x, y) => [x, 2 * cy - y]));
      mirrors.push(cloneWith((x, y) => [2 * cx - x, 2 * cy - y]));
    } else if (guides.kind === "radial") {
      const sectors = guides.sectors || 8;
      for (let i = 1; i < sectors; i++) {
        const a = (i * 2 * Math.PI) / sectors;
        const cos = Math.cos(a), sin = Math.sin(a);
        mirrors.push(cloneWith((x, y) => {
          const ox = x - cx, oy = y - cy;
          return [Math.round(cx + ox * cos - oy * sin), Math.round(cy + ox * sin + oy * cos)];
        }));
      }
    } else {
      return { ok: false, error: "active guide is not a symmetry guide" };
    }
    let added = 0;
    for (const m of mirrors) {
      if (layer.strokes.length >= ART_MAX_STROKES_PER_LAYER) break;
      layer.strokes.push(m); added += 1;
    }
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { mirrored: added, strokeCount: layer.strokes.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 6. Timelapse recording of the drawing session ───────────────────
  // A timelapse is an ordered list of compact frames (timestamp + a
  // canvas data-URL or a stroke-count checkpoint) the client can scrub.
  registerLensAction("art", "timelapse-start", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    art.timelapse = { recording: true, frames: [], startedAt: atNow() };
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { recording: true, startedAt: art.timelapse.startedAt } };
  });

  registerLensAction("art", "timelapse-frame", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    if (!art.timelapse || !art.timelapse.recording) {
      return { ok: false, error: "timelapse is not recording" };
    }
    const snapshot = String(params.snapshot || "");
    if (!snapshot.startsWith("data:image/") || snapshot.length > 500000) {
      return { ok: false, error: "snapshot must be a data URL under 500KB" };
    }
    const strokeCount = art.layers.reduce((n, l) => n + l.strokes.length, 0);
    art.timelapse.frames.push({ t: Date.now(), snapshot, strokeCount });
    if (art.timelapse.frames.length > ART_MAX_TIMELAPSE_FRAMES) {
      // keep it scrubbable — drop every other older frame
      art.timelapse.frames = art.timelapse.frames.filter((_, i) => i % 2 === 0);
    }
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { frameCount: art.timelapse.frames.length, strokeCount } };
  });

  registerLensAction("art", "timelapse-stop", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    if (!art.timelapse) return { ok: false, error: "no timelapse to stop" };
    art.timelapse.recording = false;
    art.timelapse.stoppedAt = atNow();
    art.updatedAt = atNow();
    saveArtState();
    return {
      ok: true,
      result: {
        recording: false,
        frameCount: art.timelapse.frames.length,
        durationMs: art.timelapse.frames.length > 1
          ? art.timelapse.frames[art.timelapse.frames.length - 1].t - art.timelapse.frames[0].t
          : 0,
      },
    };
  });

  registerLensAction("art", "timelapse-get", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const tl = art.timelapse;
    if (!tl) return { ok: true, result: { recording: false, frameCount: 0, frames: [] } };
    const includeFrames = params.includeFrames !== false;
    return {
      ok: true,
      result: {
        recording: !!tl.recording,
        startedAt: tl.startedAt || null,
        stoppedAt: tl.stoppedAt || null,
        frameCount: tl.frames.length,
        frames: includeFrames ? tl.frames : [],
      },
    };
  });

  registerLensAction("art", "timelapse-clear", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const had = art.timelapse ? art.timelapse.frames.length : 0;
    art.timelapse = null;
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { cleared: had } };
  });

  // ── 7. Gradient tool + pattern fills ─────────────────────────────────
  // A gradient or pattern is committed as a special element kind the
  // client paints; persisted in the layer stroke list so it composites
  // and undoes like any other element.
  registerLensAction("art", "gradient-commit", (ctx, _a, params = {}) => {
  try {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const gradKind = ART_GRADIENT_KINDS.includes(String(params.gradientKind))
      ? String(params.gradientKind) : "linear";
    const rawStops = Array.isArray(params.stops) ? params.stops : [];
    const stops = [];
    for (const st of rawStops.slice(0, 16)) {
      const color = atHex(st && st.color);
      if (!color) continue;
      stops.push({ color, offset: atClamp(st.offset, 0, 1, 0) });
    }
    if (stops.length < 2) return { ok: false, error: "a gradient needs at least 2 valid color stops" };
    stops.sort((a, b) => a.offset - b.offset);
    const el = {
      id: atId("stk"), kind: "gradient", gradientKind: gradKind,
      stops, opacity: atClamp(params.opacity, 0.01, 1, 1),
      x1: Math.round(atClamp(params.x1, 0, art.width, 0)),
      y1: Math.round(atClamp(params.y1, 0, art.height, 0)),
      x2: Math.round(atClamp(params.x2, 0, art.width, art.width)),
      y2: Math.round(atClamp(params.y2, 0, art.height, art.height)),
    };
    layer.strokes.push(el);
    layer.redo = [];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { elementId: el.id, strokeCount: layer.strokes.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("art", "pattern-fill-commit", (ctx, _a, params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = findArt(s, atAid(ctx), params.artworkId);
    if (!art) return { ok: false, error: "artwork not found" };
    const layer = art.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.locked) return { ok: false, error: "layer is locked" };
    const patternKind = ART_PATTERN_KINDS.includes(String(params.patternKind))
      ? String(params.patternKind) : "dots";
    const fg = atHex(params.foreground) || "#222222";
    const bg = atHex(params.background);
    const el = {
      id: atId("stk"), kind: "pattern", patternKind,
      foreground: fg, background: bg || null,
      scale: atClamp(params.scale, 2, 200, 16),
      opacity: atClamp(params.opacity, 0.01, 1, 1),
      // optional bounding box; absent = fill whole layer
      x: params.x != null ? Math.round(atClamp(params.x, 0, art.width, 0)) : null,
      y: params.y != null ? Math.round(atClamp(params.y, 0, art.height, 0)) : null,
      w: params.w != null ? Math.round(atClamp(params.w, 0, art.width, art.width)) : null,
      h: params.h != null ? Math.round(atClamp(params.h, 0, art.height, art.height)) : null,
    };
    layer.strokes.push(el);
    layer.redo = [];
    art.updatedAt = atNow();
    saveArtState();
    return { ok: true, result: { elementId: el.id, strokeCount: layer.strokes.length, patternKinds: ART_PATTERN_KINDS } };
  });

  registerLensAction("art", "pattern-kinds", (_ctx, _a, _params = {}) => {
    return {
      ok: true,
      result: {
        patternKinds: ART_PATTERN_KINDS,
        gradientKinds: ART_GRADIENT_KINDS,
        filterKinds: ART_FILTER_KINDS,
        guideKinds: ART_GUIDE_KINDS,
      },
    };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("art", "art-dashboard", (ctx, _a, _params = {}) => {
    const s = getArtState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = atAid(ctx);
    const artworks = s.artworks.get(userId) || [];
    const totalStrokes = artworks.reduce(
      (n, a) => n + a.layers.reduce((m, l) => m + l.strokes.length, 0), 0);
    const latest = [...artworks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const dayIdx = Math.floor(Date.now() / 86400000) % ART_PROMPTS.length;
    return {
      ok: true,
      result: {
        artworks: artworks.length,
        totalStrokes,
        palettes: (s.palettes.get(userId) || []).length,
        referenceBoards: (s.refBoards.get(userId) || []).length,
        latestArtwork: latest ? { id: latest.id, title: latest.title } : null,
        promptOfTheDay: ART_PROMPTS[dayIdx],
      },
    };
  });
}
