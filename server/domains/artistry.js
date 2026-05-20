// server/domains/artistry.js
// Domain actions for artistry: color palette analysis, composition scoring, style classification, media inventory.

export default function registerArtistryActions(registerLensAction) {
  /**
   * colorPaletteAnalysis
   * Analyze artwork colors, calculate harmony scores, and detect dominant hues.
   * artifact.data.palette: [{ color: "#RRGGBB", weight?: number }] or ["#RRGGBB", ...]
   * Returns dominant hues, harmony score, temperature, and contrast analysis.
   */
  registerLensAction("artistry", "colorPaletteAnalysis", (ctx, artifact, _params) => {
    const raw = artifact.data?.palette || [];
    if (raw.length === 0) {
      return { ok: true, result: { message: "No palette data provided. Supply artifact.data.palette as an array of hex color strings or objects with { color, weight }.", colors: [], dominantHue: null, harmonyScore: 0 } };
    }

    const colors = raw.map((entry) => {
      const hex = typeof entry === "string" ? entry : entry.color || "#000000";
      const weight = typeof entry === "object" ? (parseFloat(entry.weight) || 1) : 1;
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
  });

  /**
   * compositionScore
   * Evaluate layout balance using rule-of-thirds grid positioning.
   * artifact.data.elements: [{ x, y, width, height, weight?: number }]
   * artifact.data.canvas: { width, height }
   */
  registerLensAction("artistry", "compositionScore", (ctx, artifact, _params) => {
    const elements = artifact.data?.elements || [];
    const canvas = artifact.data?.canvas || {};
    const canvasW = parseFloat(canvas.width) || 100;
    const canvasH = parseFloat(canvas.height) || 100;

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
      const cx = ((parseFloat(el.x) || 0) + (parseFloat(el.width) || 0) / 2) / canvasW;
      const cy = ((parseFloat(el.y) || 0) + (parseFloat(el.height) || 0) / 2) / canvasH;
      const w = parseFloat(el.weight) || 1;

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

    const totalWeight = elements.reduce((s, el) => s + (parseFloat(el.weight) || 1), 0);
    thirdsScore = totalWeight > 0 ? Math.round((thirdsScore / totalWeight) * 100) / 100 : 0;

    // Visual balance: compare weight distribution across quadrants
    const quadrants = [0, 0, 0, 0]; // TL, TR, BL, BR
    for (const el of elements) {
      const cx = ((parseFloat(el.x) || 0) + (parseFloat(el.width) || 0) / 2) / canvasW;
      const cy = ((parseFloat(el.y) || 0) + (parseFloat(el.height) || 0) / 2) / canvasH;
      const w = parseFloat(el.weight) || 1;
      const area = ((parseFloat(el.width) || 0) * (parseFloat(el.height) || 0)) / (canvasW * canvasH);
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
      const w = parseFloat(el.width) || 0;
      const h = parseFloat(el.height) || 0;
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
  });

  /**
   * styleClassify
   * Classify art style from tags/attributes like medium, era, technique.
   * artifact.data.attributes: { medium, era, technique, subject, colors, texture }
   * artifact.data.tags: [string]
   */
  registerLensAction("artistry", "styleClassify", (ctx, artifact, _params) => {
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
  });

  /**
   * mediaInventory
   * Track art supplies inventory with cost totals and reorder alerts.
   * artifact.data.supplies: [{ name, category, quantity, unit, unitCost, reorderThreshold? }]
   */
  registerLensAction("artistry", "mediaInventory", (ctx, artifact, _params) => {
    const supplies = artifact.data?.supplies || [];

    if (supplies.length === 0) {
      return { ok: true, result: { message: "No supplies data provided. Supply artifact.data.supplies as [{ name, category, quantity, unit, unitCost, reorderThreshold }].", totalItems: 0, totalValue: 0, reorderAlerts: [] } };
    }

    let totalValue = 0;
    let totalItems = 0;
    const categories = {};
    const reorderAlerts = [];

    const items = supplies.map((item) => {
      const qty = parseFloat(item.quantity) || 0;
      const unitCost = parseFloat(item.unitCost) || 0;
      const value = Math.round(qty * unitCost * 100) / 100;
      const threshold = parseFloat(item.reorderThreshold) || 0;
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
  });
}
