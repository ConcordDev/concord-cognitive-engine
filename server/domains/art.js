// server/domains/art.js
// Domain actions for visual art: color harmony analysis, composition scoring,
// palette generation, and style classification.

import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

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
  });

  /**
   * compositionScore
   * Evaluate visual composition from element positions and sizes.
   * artifact.data.elements = [{ x, y, width, height, weight?, type? }]
   * artifact.data.canvas = { width, height }
   * Scores based on rule of thirds, golden ratio, balance, and visual flow.
   */
  registerLensAction("art", "compositionScore", (ctx, artifact, _params) => {
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
  });

  /**
   * generatePalette
   * Generate harmonious color palettes from a base color.
   * params.baseColor = "#hex"
   * params.harmony = "complementary" | "analogous" | "triadic" | "split-complementary" | "monochromatic"
   * params.count = number of colors (default 5)
   */
  registerLensAction("art", "generatePalette", (ctx, artifact, params) => {
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
  });

  /**
   * styleClassify
   * Classify artwork style from metadata attributes.
   * artifact.data.attributes = { brushwork, colorSaturation, contrast,
   *   perspective, detail, abstraction, lineWeight, texture }
   * Values are 0-100 scales.
   */
  registerLensAction("art", "styleClassify", (ctx, artifact, _params) => {
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
}
