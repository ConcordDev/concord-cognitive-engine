// server/domains/artistry.js
// Domain actions for artistry: color palette analysis, composition scoring, style classification, media inventory.

export default function registerArtistryActions(registerLensAction) {
  // Fail-CLOSED numeric coercion for the pure-compute analysis macros.
  // `parseFloat("Infinity")` → Infinity and `Number("1e999")` → Infinity, and
  // `Infinity || fallback` is Infinity — so the naive `parseFloat(x) || d`
  // pattern lets a poisoned magnitude flow straight into a computed total
  // (mediaInventory value, composition canvas size, palette weight) and emit a
  // report containing Infinity/NaN. `finNum` collapses any non-finite (or
  // beyond-1e15) input to the supplied fallback so every computed output stays
  // FINITE by construction. Negative magnitudes are passed through (a negative
  // weight/quantity is a domain choice, not a fail-open hazard).
  const finNum = (v, fallback = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && Math.abs(n) <= 1e15 ? n : fallback;
  };

  /**
   * colorPaletteAnalysis
   * Analyze artwork colors, calculate harmony scores, and detect dominant hues.
   * artifact.data.palette: [{ color: "#RRGGBB", weight?: number }] or ["#RRGGBB", ...]
   * Returns dominant hues, harmony score, temperature, and contrast analysis.
   */
  registerLensAction("artistry", "colorPaletteAnalysis", (ctx, artifact, _params) => {
  try {
    const raw = artifact.data?.palette || [];
    if (raw.length === 0) {
      return { ok: true, result: { message: "No palette data provided. Supply artifact.data.palette as an array of hex color strings or objects with { color, weight }.", colors: [], dominantHue: null, harmonyScore: 0 } };
    }

    const colors = raw.map((entry) => {
      const hex = typeof entry === "string" ? entry : entry.color || "#000000";
      const weight = typeof entry === "object" ? (finNum(entry.weight, 1) || 1) : 1;
      const r = parseInt(hex.slice(1, 3), 16) || 0;
      const g = parseInt(hex.slice(3, 5), 16) || 0;
      const b = parseInt(hex.slice(5, 7), 16) || 0;

      // Convert to HSL
      const rn = r / 255;
      const gn = g / 255;
      const bn = b / 255;
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
      }
      const hue = Math.round(h * 360);
      const saturation = Math.round(s * 100);
      const lightness = Math.round(l * 100);

      // Temperature classification
      const temp = (hue >= 0 && hue < 80) || hue >= 300 ? "warm" : "cool";

      return { hex, r, g, b, hue, saturation, lightness, weight, temperature: temp };
    });

    // Dominant hue by weight
    const totalWeight = colors.reduce((s, c) => s + c.weight, 0);
    const weightedHueSin = colors.reduce((s, c) => s + Math.sin((c.hue * Math.PI) / 180) * c.weight, 0);
    const weightedHueCos = colors.reduce((s, c) => s + Math.cos((c.hue * Math.PI) / 180) * c.weight, 0);
    const avgHue = Math.round(((Math.atan2(weightedHueSin / totalWeight, weightedHueCos / totalWeight) * 180) / Math.PI + 360) % 360);

    const hueToName = (h) => {
      if (h < 15) return "red";
      if (h < 45) return "orange";
      if (h < 75) return "yellow";
      if (h < 150) return "green";
      if (h < 210) return "cyan";
      if (h < 270) return "blue";
      if (h < 330) return "purple";
      return "red";
    };

    // Harmony score: how well-distributed the hues are relative to known harmonies
    // Measure pairwise hue differences and score based on proximity to complementary (180), triadic (120), or analogous (30)
    const harmonyAngles = [0, 30, 60, 120, 150, 180];
    let harmonyTotal = 0;
    let pairCount = 0;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const diff = Math.abs(colors[i].hue - colors[j].hue);
        const angleDiff = Math.min(diff, 360 - diff);
        const closestHarmony = harmonyAngles.reduce((best, a) => Math.abs(angleDiff - a) < Math.abs(angleDiff - best) ? a : best, 0);
        const deviation = Math.abs(angleDiff - closestHarmony);
        harmonyTotal += Math.max(0, 1 - deviation / 30);
        pairCount++;
      }
    }
    const harmonyScore = pairCount > 0 ? Math.round((harmonyTotal / pairCount) * 100) / 100 : 1;

    // Average saturation and lightness
    const avgSat = Math.round(colors.reduce((s, c) => s + c.saturation * c.weight, 0) / totalWeight);
    const avgLight = Math.round(colors.reduce((s, c) => s + c.lightness * c.weight, 0) / totalWeight);

    // Contrast ratio between lightest and darkest
    const lightest = Math.max(...colors.map((c) => c.lightness));
    const darkest = Math.min(...colors.map((c) => c.lightness));
    const contrastRange = lightest - darkest;

    // Temperature balance
    const warmCount = colors.filter((c) => c.temperature === "warm").length;
    const coolCount = colors.filter((c) => c.temperature === "cool").length;
    const temperatureBalance = warmCount > coolCount ? "warm-dominant" : coolCount > warmCount ? "cool-dominant" : "balanced";

    const result = {
      colorCount: colors.length,
      colors: colors.map((c) => ({
        hex: c.hex,
        hue: c.hue,
        hueName: hueToName(c.hue),
        saturation: c.saturation,
        lightness: c.lightness,
        temperature: c.temperature,
        weight: c.weight,
      })),
      dominantHue: avgHue,
      dominantHueName: hueToName(avgHue),
      harmonyScore,
      harmonyLabel: harmonyScore > 0.8 ? "excellent" : harmonyScore > 0.6 ? "good" : harmonyScore > 0.4 ? "moderate" : "weak",
      averageSaturation: avgSat,
      averageLightness: avgLight,
      contrastRange,
      contrastLevel: contrastRange > 60 ? "high" : contrastRange > 30 ? "medium" : "low",
      temperatureBalance,
    };

    artifact.data.colorAnalysis = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * compositionScore
   * Evaluate layout balance using rule-of-thirds grid positioning.
   * artifact.data.elements: [{ x, y, width, height, weight?: number }]
   * artifact.data.canvas: { width, height }
   */
  registerLensAction("artistry", "compositionScore", (ctx, artifact, _params) => {
  try {
    const elements = artifact.data?.elements || [];
    const canvas = artifact.data?.canvas || {};
    const canvasW = finNum(canvas.width, 100) || 100;
    const canvasH = finNum(canvas.height, 100) || 100;

    if (elements.length === 0) {
      return { ok: true, result: { message: "No elements provided. Supply artifact.data.elements as [{ x, y, width, height }] and artifact.data.canvas as { width, height }.", score: 0, breakdown: {} } };
    }

    // Rule of thirds intersection points (normalized 0-1)
    const thirdPoints = [
      { x: 1 / 3, y: 1 / 3 },
      { x: 2 / 3, y: 1 / 3 },
      { x: 1 / 3, y: 2 / 3 },
      { x: 2 / 3, y: 2 / 3 },
    ];

    // Evaluate each element's center proximity to rule-of-thirds points
    let thirdsScore = 0;
    const elementAnalysis = elements.map((el) => {
      const cx = (finNum(el.x, 0) + finNum(el.width, 0) / 2) / canvasW;
      const cy = (finNum(el.y, 0) + finNum(el.height, 0) / 2) / canvasH;
      const w = finNum(el.weight, 1) || 1;

      // Distance to nearest thirds point
      let minDist = Infinity;
      let nearestPoint = null;
      for (const tp of thirdPoints) {
        const dist = Math.sqrt((cx - tp.x) ** 2 + (cy - tp.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          nearestPoint = tp;
        }
      }
      // Max possible distance from a thirds point is about 0.47
      const proximity = Math.max(0, 1 - minDist / 0.47);
      thirdsScore += proximity * w;

      return { centerX: Math.round(cx * 100) / 100, centerY: Math.round(cy * 100) / 100, nearestThird: nearestPoint, proximityScore: Math.round(proximity * 100) / 100 };
    });

    const totalWeight = elements.reduce((s, el) => s + (finNum(el.weight, 1) || 1), 0);
    thirdsScore = totalWeight > 0 ? Math.round((thirdsScore / totalWeight) * 100) / 100 : 0;

    // Visual balance: compare weight distribution across quadrants
    const quadrants = [0, 0, 0, 0]; // TL, TR, BL, BR
    for (const el of elements) {
      const cx = (finNum(el.x, 0) + finNum(el.width, 0) / 2) / canvasW;
      const cy = (finNum(el.y, 0) + finNum(el.height, 0) / 2) / canvasH;
      const w = finNum(el.weight, 1) || 1;
      const area = (finNum(el.width, 0) * finNum(el.height, 0)) / (canvasW * canvasH);
      const mass = w * (area || 0.01);
      const qi = (cy < 0.5 ? 0 : 2) + (cx < 0.5 ? 0 : 1);
      quadrants[qi] += mass;
    }

    const qTotal = quadrants.reduce((s, v) => s + v, 0) || 1;
    const qNorm = quadrants.map((q) => q / qTotal);
    const idealBalance = 0.25;
    const balanceDeviation = qNorm.reduce((s, q) => s + Math.abs(q - idealBalance), 0) / 4;
    const balanceScore = Math.round(Math.max(0, 1 - balanceDeviation * 4) * 100) / 100;

    // Coverage: how much of the canvas is utilized
    let coveredArea = 0;
    for (const el of elements) {
      const w = finNum(el.width, 0);
      const h = finNum(el.height, 0);
      coveredArea += w * h;
    }
    const coverageRatio = Math.min(1, coveredArea / (canvasW * canvasH));
    const coverageScore = coverageRatio > 0.3 && coverageRatio < 0.85 ? Math.round((1 - Math.abs(coverageRatio - 0.55) / 0.55) * 100) / 100 : Math.round(coverageRatio * 50) / 100;

    const overall = Math.round(((thirdsScore * 0.4 + balanceScore * 0.35 + coverageScore * 0.25) * 100)) / 100;

    const result = {
      overallScore: overall,
      ruleOfThirdsScore: thirdsScore,
      balanceScore,
      coverageScore,
      coverageRatio: Math.round(coverageRatio * 100) / 100,
      quadrantDistribution: { topLeft: Math.round(qNorm[0] * 100), topRight: Math.round(qNorm[1] * 100), bottomLeft: Math.round(qNorm[2] * 100), bottomRight: Math.round(qNorm[3] * 100) },
      elementCount: elements.length,
      elements: elementAnalysis,
      suggestion: overall > 0.7 ? "Strong composition" : overall > 0.4 ? "Consider repositioning elements closer to rule-of-thirds intersections" : "Composition needs significant rebalancing; distribute visual weight more evenly",
    };

    artifact.data.compositionScore = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * styleClassify
   * Classify art style from tags/attributes like medium, era, technique.
   * artifact.data.attributes: { medium, era, technique, subject, colors, texture }
   * artifact.data.tags: [string]
   */
  registerLensAction("artistry", "styleClassify", (ctx, artifact, _params) => {
  try {
    const attrs = artifact.data?.attributes || {};
    const tags = (artifact.data?.tags || []).map((t) => (typeof t === "string" ? t.toLowerCase().trim() : ""));

    if (Object.keys(attrs).length === 0 && tags.length === 0) {
      return { ok: true, result: { message: "No attributes or tags provided. Supply artifact.data.attributes (medium, era, technique, subject) and/or artifact.data.tags.", classification: null, confidence: 0 } };
    }

    // Style definitions with weighted keyword matches
    const styles = [
      { name: "Impressionism", keywords: ["impressionist", "plein air", "light", "brushstrokes", "oil", "landscape", "nature", "pastel", "19th century", "1800s", "monet", "renoir", "loose"], era: ["1860-1900", "19th century", "late 1800s"] },
      { name: "Abstract Expressionism", keywords: ["abstract", "expressionist", "gestural", "action painting", "drip", "spontaneous", "large scale", "emotion", "pollock", "de kooning"], era: ["1940-1960", "mid 20th century", "20th century"] },
      { name: "Cubism", keywords: ["cubist", "geometric", "fragmented", "multiple perspectives", "angular", "picasso", "braque", "collage"], era: ["1907-1920", "early 20th century"] },
      { name: "Surrealism", keywords: ["surreal", "dreamlike", "unconscious", "bizarre", "fantasy", "dali", "magritte", "automatic"], era: ["1920-1950", "early 20th century"] },
      { name: "Realism", keywords: ["realistic", "realist", "detailed", "photorealistic", "accurate", "representational", "figurative", "portrait", "still life"], era: ["1840-1900", "19th century"] },
      { name: "Pop Art", keywords: ["pop", "commercial", "bold colors", "consumer", "warhol", "lichtenstein", "mass media", "comic", "bright"], era: ["1950-1970", "mid 20th century"] },
      { name: "Minimalism", keywords: ["minimal", "minimalist", "simple", "geometric", "clean", "monochrome", "sparse", "reduction"], era: ["1960-1975", "mid 20th century"] },
      { name: "Renaissance", keywords: ["renaissance", "classical", "perspective", "humanism", "fresco", "oil", "religious", "mythological", "davinci", "michelangelo"], era: ["1400-1600", "15th century", "16th century"] },
      { name: "Baroque", keywords: ["baroque", "dramatic", "ornate", "contrast", "chiaroscuro", "grandeur", "caravaggio", "rembrandt", "rich"], era: ["1600-1750", "17th century"] },
      { name: "Contemporary", keywords: ["contemporary", "modern", "mixed media", "installation", "digital", "conceptual", "multimedia", "experimental"], era: ["2000-present", "21st century"] },
    ];

    const allInput = [...tags, attrs.medium, attrs.era, attrs.technique, attrs.subject, attrs.texture, attrs.colors].filter(Boolean).map((s) => s.toLowerCase());
    const inputStr = allInput.join(" ");

    const scored = styles.map((style) => {
      let score = 0;
      const matchedKeywords = [];

      for (const kw of style.keywords) {
        if (inputStr.includes(kw)) {
          score += 2;
          matchedKeywords.push(kw);
        }
        for (const tag of allInput) {
          if (tag.includes(kw) || kw.includes(tag)) {
            if (!matchedKeywords.includes(kw)) {
              score += 1;
              matchedKeywords.push(kw);
            }
          }
        }
      }

      // Era match bonus
      if (attrs.era) {
        const eraLower = attrs.era.toLowerCase();
        for (const e of style.era) {
          if (eraLower.includes(e) || e.includes(eraLower)) {
            score += 3;
            break;
          }
        }
      }

      const maxPossible = style.keywords.length * 2 + 3;
      const confidence = Math.round(Math.min(1, score / Math.max(maxPossible * 0.4, 1)) * 100) / 100;

      return { name: style.name, score, confidence, matchedKeywords: [...new Set(matchedKeywords)] };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const runner = scored[1];

    const result = {
      classification: top.score > 0 ? top.name : "Unclassified",
      confidence: top.confidence,
      matchedKeywords: top.matchedKeywords,
      runnerUp: runner && runner.score > 0 ? { style: runner.name, confidence: runner.confidence } : null,
      allScores: scored.filter((s) => s.score > 0).map((s) => ({ style: s.name, confidence: s.confidence, matchCount: s.matchedKeywords.length })),
      inputSummary: { medium: attrs.medium || null, era: attrs.era || null, technique: attrs.technique || null, tagCount: tags.length },
    };

    artifact.data.styleClassification = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * mediaInventory
   * Track art supplies inventory with cost totals and reorder alerts.
   * artifact.data.supplies: [{ name, category, quantity, unit, unitCost, reorderThreshold? }]
   */
  registerLensAction("artistry", "mediaInventory", (ctx, artifact, _params) => {
  try {
    const supplies = artifact.data?.supplies || [];

    if (supplies.length === 0) {
      return { ok: true, result: { message: "No supplies data provided. Supply artifact.data.supplies as [{ name, category, quantity, unit, unitCost, reorderThreshold }].", totalItems: 0, totalValue: 0, reorderAlerts: [] } };
    }

    let totalValue = 0;
    let totalItems = 0;
    const categories = {};
    const reorderAlerts = [];

    const items = supplies.map((item) => {
      const qty = finNum(item.quantity, 0);
      const unitCost = finNum(item.unitCost, 0);
      const value = Math.round(qty * unitCost * 100) / 100;
      const threshold = finNum(item.reorderThreshold, 0);
      const category = item.category || "uncategorized";

      totalValue += value;
      totalItems += qty;

      if (!categories[category]) {
        categories[category] = { count: 0, totalQuantity: 0, totalValue: 0, items: [] };
      }
      categories[category].count++;
      categories[category].totalQuantity += qty;
      categories[category].totalValue = Math.round((categories[category].totalValue + value) * 100) / 100;
      categories[category].items.push(item.name || "unnamed");

      const needsReorder = threshold > 0 && qty <= threshold;
      if (needsReorder) {
        const deficit = threshold - qty;
        const reorderCost = Math.round(deficit * unitCost * 100) / 100;
        reorderAlerts.push({
          name: item.name,
          category,
          currentQuantity: qty,
          threshold,
          deficit: Math.round(deficit * 100) / 100,
          estimatedReorderCost: reorderCost,
          urgency: qty === 0 ? "critical" : qty <= threshold * 0.5 ? "high" : "medium",
        });
      }

      return {
        name: item.name || "unnamed",
        category,
        quantity: qty,
        unit: item.unit || "pcs",
        unitCost,
        totalValue: value,
        needsReorder,
        stockLevel: threshold > 0 ? (qty > threshold * 2 ? "well-stocked" : qty > threshold ? "adequate" : qty > 0 ? "low" : "out-of-stock") : "no-threshold-set",
      };
    });

    reorderAlerts.sort((a, b) => {
      const urgencyOrder = { critical: 0, high: 1, medium: 2 };
      return (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3);
    });

    const totalReorderCost = Math.round(reorderAlerts.reduce((s, a) => s + a.estimatedReorderCost, 0) * 100) / 100;

    const categoryBreakdown = Object.entries(categories).map(([name, data]) => ({
      category: name,
      itemCount: data.count,
      totalQuantity: data.totalQuantity,
      totalValue: data.totalValue,
      percentOfValue: totalValue > 0 ? Math.round((data.totalValue / totalValue) * 10000) / 100 : 0,
    })).sort((a, b) => b.totalValue - a.totalValue);

    const result = {
      totalItems: supplies.length,
      totalQuantity: Math.round(totalItems * 100) / 100,
      totalInventoryValue: Math.round(totalValue * 100) / 100,
      categoryBreakdown,
      reorderAlerts,
      reorderCount: reorderAlerts.length,
      estimatedReorderCost: totalReorderCost,
      items,
    };

    artifact.data.mediaInventory = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Behance / ArtStation parity — social-portfolio core ────────────
  // Project case studies, follow graph + personalized feed, comments /
  // appreciations / collections, portfolio profile, tag search, job board,
  // curated galleries. Persistent per-user state on globalThis._concordSTATE.

  function getArtState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.artistryLens) STATE.artistryLens = {};
    const s = STATE.artistryLens;
    for (const k of [
      "projects", "follows", "comments", "appreciations",
      "collections", "profiles", "jobs", "galleries",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveArtState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const artId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const artNow = () => new Date().toISOString();
  const artAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const artClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const artArr = (v) => (Array.isArray(v) ? v : []);
  const artList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };

  // ── Project pages — multi-image case studies ────────────────────────
  registerLensAction("artistry", "projectCreate", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const uid = artAid(ctx);
      const project = {
        id: artId("proj"),
        userId: uid,
        title: artClean(p.title, 160) || "Untitled Project",
        description: artClean(p.description, 4000),
        discipline: artClean(p.discipline, 60) || "illustration",
        tools: artArr(p.tools).map((t) => artClean(t, 60)).filter(Boolean),
        tags: artArr(p.tags).map((t) => artClean(t, 40).toLowerCase()).filter(Boolean),
        images: artArr(p.images).map((im, i) => ({
          url: artClean(typeof im === "string" ? im : im.url, 600),
          caption: artClean(typeof im === "object" ? im.caption : "", 280),
          order: typeof im === "object" && Number.isFinite(Number(im.order)) ? Number(im.order) : i,
        })).filter((im) => im.url),
        processSteps: artArr(p.processSteps).map((st) => ({
          title: artClean(typeof st === "string" ? st : st.title, 120),
          detail: artClean(typeof st === "object" ? st.detail : "", 1000),
        })).filter((st) => st.title),
        coverUrl: artClean(p.coverUrl, 600),
        published: p.published !== false,
        views: 0,
        createdAt: artNow(),
        updatedAt: artNow(),
      };
      artList(s.projects, uid).unshift(project);
      saveArtState();
      return { ok: true, result: { project } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "projectUpdate", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const uid = artAid(ctx);
      const list = artList(s.projects, uid);
      const proj = list.find((x) => x.id === p.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      if (p.title !== undefined) proj.title = artClean(p.title, 160) || proj.title;
      if (p.description !== undefined) proj.description = artClean(p.description, 4000);
      if (p.discipline !== undefined) proj.discipline = artClean(p.discipline, 60) || proj.discipline;
      if (p.tools !== undefined) proj.tools = artArr(p.tools).map((t) => artClean(t, 60)).filter(Boolean);
      if (p.tags !== undefined) proj.tags = artArr(p.tags).map((t) => artClean(t, 40).toLowerCase()).filter(Boolean);
      if (p.coverUrl !== undefined) proj.coverUrl = artClean(p.coverUrl, 600);
      if (p.published !== undefined) proj.published = !!p.published;
      if (p.images !== undefined) {
        proj.images = artArr(p.images).map((im, i) => ({
          url: artClean(typeof im === "string" ? im : im.url, 600),
          caption: artClean(typeof im === "object" ? im.caption : "", 280),
          order: typeof im === "object" && Number.isFinite(Number(im.order)) ? Number(im.order) : i,
        })).filter((im) => im.url);
      }
      if (p.processSteps !== undefined) {
        proj.processSteps = artArr(p.processSteps).map((st) => ({
          title: artClean(typeof st === "string" ? st : st.title, 120),
          detail: artClean(typeof st === "object" ? st.detail : "", 1000),
        })).filter((st) => st.title);
      }
      proj.updatedAt = artNow();
      saveArtState();
      return { ok: true, result: { project: proj } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "projectDelete", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const list = artList(s.projects, uid);
      const idx = list.findIndex((x) => x.id === (params || {}).projectId);
      if (idx === -1) return { ok: false, error: "project_not_found" };
      list.splice(idx, 1);
      saveArtState();
      return { ok: true, result: { deleted: true } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "projectList", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const ownerId = artClean(p.userId, 80) || artAid(ctx);
      const viewerId = artAid(ctx);
      let list = (s.projects.get(ownerId) || []).slice();
      if (ownerId !== viewerId) list = list.filter((x) => x.published);
      list = list.map((proj) => ({
        ...proj,
        appreciations: (s.appreciations.get(proj.id) || []).length,
        commentCount: (s.comments.get(proj.id) || []).length,
      }));
      return { ok: true, result: { projects: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "projectView", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      let found = null;
      for (const [, list] of s.projects) {
        const proj = list.find((x) => x.id === p.projectId);
        if (proj) { found = proj; break; }
      }
      if (!found) return { ok: false, error: "project_not_found" };
      if (found.userId !== artAid(ctx)) found.views += 1;
      saveArtState();
      const comments = (s.comments.get(found.id) || []).slice();
      const appreciations = (s.appreciations.get(found.id) || []);
      return {
        ok: true,
        result: {
          project: found,
          comments,
          appreciations: appreciations.length,
          appreciated: appreciations.some((a) => a.userId === artAid(ctx)),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Follow / followers graph + personalized feed ────────────────────
  registerLensAction("artistry", "follow", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const target = artClean((params || {}).targetUserId, 80);
      if (!target) return { ok: false, error: "targetUserId_required" };
      if (target === uid) return { ok: false, error: "cannot_follow_self" };
      const following = artList(s.follows, uid);
      if (!following.includes(target)) following.push(target);
      saveArtState();
      return { ok: true, result: { following: target, followingCount: following.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "unfollow", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const target = artClean((params || {}).targetUserId, 80);
      const following = artList(s.follows, uid);
      const idx = following.indexOf(target);
      if (idx !== -1) following.splice(idx, 1);
      saveArtState();
      return { ok: true, result: { unfollowed: target, followingCount: following.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "followGraph", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artClean((params || {}).userId, 80) || artAid(ctx);
      const following = (s.follows.get(uid) || []).slice();
      const followers = [];
      for (const [u, list] of s.follows) {
        if (list.includes(uid)) followers.push(u);
      }
      const mutuals = following.filter((f) => followers.includes(f));
      return {
        ok: true,
        result: {
          userId: uid,
          following, followers, mutuals,
          followingCount: following.length,
          followerCount: followers.length,
          mutualCount: mutuals.length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "personalizedFeed", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const following = (s.follows.get(uid) || []);
      const limit = Math.min(60, Math.max(1, Number((params || {}).limit) || 24));
      let feed = [];
      for (const followed of following) {
        for (const proj of (s.projects.get(followed) || [])) {
          if (proj.published) {
            feed.push({
              ...proj,
              appreciations: (s.appreciations.get(proj.id) || []).length,
              commentCount: (s.comments.get(proj.id) || []).length,
            });
          }
        }
      }
      feed.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const fromFollows = feed.length;
      // If empty, fall back to discovery (most-appreciated published projects).
      let mode = "follows";
      if (feed.length === 0) {
        mode = "discovery";
        for (const [owner, list] of s.projects) {
          if (owner === uid) continue;
          for (const proj of list) {
            if (proj.published) {
              feed.push({
                ...proj,
                appreciations: (s.appreciations.get(proj.id) || []).length,
                commentCount: (s.comments.get(proj.id) || []).length,
              });
            }
          }
        }
        feed.sort((a, b) => (b.appreciations - a.appreciations) || (b.views - a.views));
      }
      return {
        ok: true,
        result: { mode, fromFollowsCount: fromFollows, items: feed.slice(0, limit), count: Math.min(feed.length, limit) },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Comments + appreciations ────────────────────────────────────────
  registerLensAction("artistry", "commentAdd", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const projectId = artClean(p.projectId, 80);
      const body = artClean(p.body, 1200);
      if (!projectId) return { ok: false, error: "projectId_required" };
      if (!body) return { ok: false, error: "body_required" };
      const comment = {
        id: artId("cmt"),
        projectId,
        userId: artAid(ctx),
        body,
        createdAt: artNow(),
      };
      artList(s.comments, projectId).push(comment);
      saveArtState();
      return { ok: true, result: { comment, commentCount: s.comments.get(projectId).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "commentList", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const projectId = artClean((params || {}).projectId, 80);
      const comments = (s.comments.get(projectId) || []).slice();
      return { ok: true, result: { comments, count: comments.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "commentDelete", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const list = s.comments.get(artClean(p.projectId, 80)) || [];
      const idx = list.findIndex((c) => c.id === p.commentId && c.userId === artAid(ctx));
      if (idx === -1) return { ok: false, error: "comment_not_found" };
      list.splice(idx, 1);
      saveArtState();
      return { ok: true, result: { deleted: true, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "appreciate", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const projectId = artClean((params || {}).projectId, 80);
      if (!projectId) return { ok: false, error: "projectId_required" };
      const list = artList(s.appreciations, projectId);
      const existing = list.findIndex((a) => a.userId === uid);
      let appreciated;
      if (existing === -1) {
        list.push({ userId: uid, createdAt: artNow() });
        appreciated = true;
      } else {
        list.splice(existing, 1);
        appreciated = false;
      }
      saveArtState();
      return { ok: true, result: { appreciated, count: list.length, projectId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Collections — save-to-board ─────────────────────────────────────
  registerLensAction("artistry", "collectionCreate", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const p = params || {};
      const collection = {
        id: artId("coll"),
        userId: uid,
        name: artClean(p.name, 120) || "New Collection",
        description: artClean(p.description, 600),
        isPrivate: !!p.isPrivate,
        projectIds: [],
        createdAt: artNow(),
      };
      artList(s.collections, uid).push(collection);
      saveArtState();
      return { ok: true, result: { collection } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "collectionList", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const owner = artClean((params || {}).userId, 80) || artAid(ctx);
      const viewer = artAid(ctx);
      let list = (s.collections.get(owner) || []).slice();
      if (owner !== viewer) list = list.filter((c) => !c.isPrivate);
      list = list.map((c) => ({ ...c, itemCount: c.projectIds.length }));
      return { ok: true, result: { collections: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "collectionSave", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const p = params || {};
      const list = s.collections.get(uid) || [];
      const coll = list.find((c) => c.id === p.collectionId);
      if (!coll) return { ok: false, error: "collection_not_found" };
      const projectId = artClean(p.projectId, 80);
      if (!projectId) return { ok: false, error: "projectId_required" };
      let saved;
      const idx = coll.projectIds.indexOf(projectId);
      if (idx === -1) { coll.projectIds.push(projectId); saved = true; }
      else { coll.projectIds.splice(idx, 1); saved = false; }
      saveArtState();
      return { ok: true, result: { saved, collectionId: coll.id, itemCount: coll.projectIds.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "collectionItems", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      let coll = null;
      for (const [, list] of s.collections) {
        const c = list.find((x) => x.id === p.collectionId);
        if (c) { coll = c; break; }
      }
      if (!coll) return { ok: false, error: "collection_not_found" };
      if (coll.isPrivate && coll.userId !== artAid(ctx)) return { ok: false, error: "collection_private" };
      const items = [];
      for (const pid of coll.projectIds) {
        for (const [, list] of s.projects) {
          const proj = list.find((x) => x.id === pid);
          if (proj) { items.push(proj); break; }
        }
      }
      return { ok: true, result: { collection: coll, items, count: items.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Portfolio profile page ──────────────────────────────────────────
  registerLensAction("artistry", "profileUpdate", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const p = params || {};
      const prev = s.profiles.get(uid) || {};
      const profile = {
        userId: uid,
        displayName: artClean(p.displayName, 80) || prev.displayName || uid,
        headline: artClean(p.headline, 160) ?? prev.headline ?? "",
        bio: artClean(p.bio, 2000) ?? prev.bio ?? "",
        location: artClean(p.location, 120) ?? prev.location ?? "",
        avatarUrl: artClean(p.avatarUrl, 600) ?? prev.avatarUrl ?? "",
        bannerUrl: artClean(p.bannerUrl, 600) ?? prev.bannerUrl ?? "",
        disciplines: p.disciplines !== undefined
          ? artArr(p.disciplines).map((d) => artClean(d, 60)).filter(Boolean)
          : (prev.disciplines || []),
        availableForHire: p.availableForHire !== undefined ? !!p.availableForHire : !!prev.availableForHire,
        links: p.links !== undefined
          ? artArr(p.links).map((l) => ({
            label: artClean(typeof l === "object" ? l.label : "", 40),
            url: artClean(typeof l === "string" ? l : l.url, 400),
          })).filter((l) => l.url)
          : (prev.links || []),
        layout: artClean(p.layout, 30) || prev.layout || "grid",
        updatedAt: artNow(),
        createdAt: prev.createdAt || artNow(),
      };
      s.profiles.set(uid, profile);
      saveArtState();
      return { ok: true, result: { profile } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "profileGet", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artClean((params || {}).userId, 80) || artAid(ctx);
      const viewer = artAid(ctx);
      const profile = s.profiles.get(uid) || {
        userId: uid, displayName: uid, headline: "", bio: "", location: "",
        avatarUrl: "", bannerUrl: "", disciplines: [], availableForHire: false,
        links: [], layout: "grid",
      };
      let projects = (s.projects.get(uid) || []);
      if (uid !== viewer) projects = projects.filter((x) => x.published);
      const totalViews = projects.reduce((sum, p) => sum + (p.views || 0), 0);
      const totalAppreciations = projects.reduce(
        (sum, p) => sum + (s.appreciations.get(p.id) || []).length, 0);
      const followers = [];
      for (const [u, list] of s.follows) { if (list.includes(uid)) followers.push(u); }
      return {
        ok: true,
        result: {
          profile,
          projects: projects.map((p) => ({
            id: p.id, title: p.title, coverUrl: p.coverUrl || (p.images[0]?.url || ""),
            discipline: p.discipline, views: p.views,
            appreciations: (s.appreciations.get(p.id) || []).length,
          })),
          stats: {
            projectCount: projects.length,
            totalViews,
            totalAppreciations,
            followerCount: followers.length,
            followingCount: (s.follows.get(uid) || []).length,
          },
          isOwner: uid === viewer,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Tags / categories / search-by-discipline ────────────────────────
  registerLensAction("artistry", "search", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const q = artClean(p.query, 120).toLowerCase();
      const discipline = artClean(p.discipline, 60).toLowerCase();
      const tag = artClean(p.tag, 40).toLowerCase();
      const sort = artClean(p.sort, 20) || "recent";
      const viewer = artAid(ctx);
      let results = [];
      for (const [owner, list] of s.projects) {
        for (const proj of list) {
          if (!proj.published && owner !== viewer) continue;
          if (discipline && proj.discipline.toLowerCase() !== discipline) continue;
          if (tag && !proj.tags.includes(tag)) continue;
          if (q) {
            const hay = `${proj.title} ${proj.description} ${proj.tags.join(" ")} ${proj.discipline}`.toLowerCase();
            if (!hay.includes(q)) continue;
          }
          results.push({
            ...proj,
            appreciations: (s.appreciations.get(proj.id) || []).length,
            commentCount: (s.comments.get(proj.id) || []).length,
          });
        }
      }
      if (sort === "appreciated") results.sort((a, b) => b.appreciations - a.appreciations);
      else if (sort === "viewed") results.sort((a, b) => b.views - a.views);
      else results.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return { ok: true, result: { results, count: results.length, query: q, discipline, tag, sort } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "tagCloud", (ctx, artifact, _params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const viewer = artAid(ctx);
      const tagCounts = {};
      const disciplineCounts = {};
      for (const [owner, list] of s.projects) {
        for (const proj of list) {
          if (!proj.published && owner !== viewer) continue;
          for (const t of proj.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
          const d = proj.discipline || "other";
          disciplineCounts[d] = (disciplineCounts[d] || 0) + 1;
        }
      }
      const tags = Object.entries(tagCounts).map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
      const disciplines = Object.entries(disciplineCounts).map(([discipline, count]) => ({ discipline, count }))
        .sort((a, b) => b.count - a.count);
      return { ok: true, result: { tags, disciplines, tagCount: tags.length, disciplineCount: disciplines.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Job board / commission requests ─────────────────────────────────
  registerLensAction("artistry", "jobPost", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const title = artClean(p.title, 160);
      if (!title) return { ok: false, error: "title_required" };
      const job = {
        id: artId("job"),
        posterId: artAid(ctx),
        title,
        description: artClean(p.description, 3000),
        discipline: artClean(p.discipline, 60) || "illustration",
        kind: ["full-time", "contract", "commission", "freelance"].includes(p.kind) ? p.kind : "commission",
        budgetMin: Number.isFinite(Number(p.budgetMin)) ? Math.max(0, Number(p.budgetMin)) : 0,
        budgetMax: Number.isFinite(Number(p.budgetMax)) ? Math.max(0, Number(p.budgetMax)) : 0,
        remote: p.remote !== false,
        location: artClean(p.location, 120),
        tags: artArr(p.tags).map((t) => artClean(t, 40).toLowerCase()).filter(Boolean),
        status: "open",
        applications: [],
        createdAt: artNow(),
      };
      // jobs Map is keyed by a single "board" bucket for global discovery.
      artList(s.jobs, "board").unshift(job);
      saveArtState();
      return { ok: true, result: { job } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "jobList", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const discipline = artClean(p.discipline, 60).toLowerCase();
      const kind = artClean(p.kind, 30).toLowerCase();
      const mine = !!p.mine;
      const uid = artAid(ctx);
      let jobs = (s.jobs.get("board") || []).slice();
      if (discipline) jobs = jobs.filter((j) => j.discipline.toLowerCase() === discipline);
      if (kind) jobs = jobs.filter((j) => j.kind === kind);
      if (mine) jobs = jobs.filter((j) => j.posterId === uid);
      if (!mine && !p.includeClosed) jobs = jobs.filter((j) => j.status === "open");
      jobs = jobs.map((j) => ({
        ...j,
        applicationCount: j.applications.length,
        applied: j.applications.some((a) => a.userId === uid),
      }));
      return { ok: true, result: { jobs, count: jobs.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "jobApply", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const uid = artAid(ctx);
      const jobs = s.jobs.get("board") || [];
      const job = jobs.find((j) => j.id === p.jobId);
      if (!job) return { ok: false, error: "job_not_found" };
      if (job.posterId === uid) return { ok: false, error: "cannot_apply_own_job" };
      if (job.status !== "open") return { ok: false, error: "job_closed" };
      if (job.applications.some((a) => a.userId === uid)) return { ok: false, error: "already_applied" };
      job.applications.push({
        userId: uid,
        message: artClean(p.message, 1500),
        portfolioProjectId: artClean(p.portfolioProjectId, 80),
        quote: Number.isFinite(Number(p.quote)) ? Math.max(0, Number(p.quote)) : null,
        createdAt: artNow(),
      });
      saveArtState();
      return { ok: true, result: { applied: true, jobId: job.id, applicationCount: job.applications.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "jobClose", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const jobs = s.jobs.get("board") || [];
      const job = jobs.find((j) => j.id === (params || {}).jobId);
      if (!job) return { ok: false, error: "job_not_found" };
      if (job.posterId !== uid) return { ok: false, error: "not_job_owner" };
      job.status = "closed";
      saveArtState();
      return { ok: true, result: { closed: true, jobId: job.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Behance-style "served sites" / curated galleries ────────────────
  registerLensAction("artistry", "galleryCreate", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const title = artClean(p.title, 140);
      if (!title) return { ok: false, error: "title_required" };
      const gallery = {
        id: artId("gal"),
        curatorId: artAid(ctx),
        title,
        theme: artClean(p.theme, 80) || "Featured",
        description: artClean(p.description, 1000),
        projectIds: artArr(p.projectIds).map((x) => artClean(x, 80)).filter(Boolean),
        featured: !!p.featured,
        createdAt: artNow(),
      };
      artList(s.galleries, "curated").unshift(gallery);
      saveArtState();
      return { ok: true, result: { gallery } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "galleryList", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const theme = artClean((params || {}).theme, 80).toLowerCase();
      let galleries = (s.galleries.get("curated") || []).slice();
      if (theme) galleries = galleries.filter((g) => g.theme.toLowerCase() === theme);
      galleries = galleries.map((g) => ({ ...g, projectCount: g.projectIds.length }));
      galleries.sort((a, b) => (Number(b.featured) - Number(a.featured))
        || (Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      return { ok: true, result: { galleries, count: galleries.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "galleryItems", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const gallery = (s.galleries.get("curated") || []).find((g) => g.id === (params || {}).galleryId);
      if (!gallery) return { ok: false, error: "gallery_not_found" };
      const items = [];
      for (const pid of gallery.projectIds) {
        for (const [, list] of s.projects) {
          const proj = list.find((x) => x.id === pid && x.published);
          if (proj) {
            items.push({
              ...proj,
              appreciations: (s.appreciations.get(proj.id) || []).length,
            });
            break;
          }
        }
      }
      return { ok: true, result: { gallery, items, count: items.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
