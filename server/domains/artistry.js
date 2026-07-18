// server/domains/artistry.js
// Domain actions for artistry: color palette analysis, composition scoring, style classification, media inventory.

// Wave 4 gap-closure — notification feed (docs/lens-specs/artistry-capability-map.md
// item 14: "Notification feed (new follower, new comment, new appreciation)").
// Reuses the existing platform-wide notification substrate instead of inventing
// a parallel one — the exact cross-directory import precedent is
// server/emergent/byo-budget-alert-cycle.js (a non-social domain importing from
// social-layer.js); other domains import freely from ../emergent/*.js too (see
// server/domains/civic-bonds.js -> emergent/microbond-governance.js,
// server/domains/repair.js -> emergent/repair-cortex.js /
// emergent/world-health-monitor.js). Calling createNotification() also fires a
// live `social:notification` socket event (server/emergent/social-layer.js's
// _fireNotificationSocket, wired at boot via setSocialEmitter) which
// concord-frontend/hooks/useSocialNotificationToast.ts (mounted once, globally,
// in AppShell) already renders as a toast with zero new frontend plumbing.
import {
  createNotification, getNotifications, markNotificationRead, markAllNotificationsRead,
} from "../emergent/social-layer.js";

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
      return { ok: true, result: { message: "No palette data provided. Supply artifact.data.palette as an array of hex color strings or objects with { color, weight }.", colors: [], dominantHue: null, harmonyScore: 0, contrastRange: 0 } };
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
      "collections", "profiles", "jobs", "galleries", "analyticsSnapshots",
      "projectImages", "dmThreads",
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

  // Shared project-owner lookup — projectId alone doesn't reveal which
  // per-user bucket of s.projects it lives in (same scan projectView
  // already performs at read time). commentAdd/appreciate both need the
  // owner to resolve who a notification should target, so this is
  // extracted once rather than duplicated in each handler.
  function findProjectOwner(s, projectId) {
    for (const [, list] of s.projects) {
      const proj = list.find((x) => x.id === projectId);
      if (proj) return proj;
    }
    return null;
  }

  // Fire-and-forget wrapper around the platform notification substrate.
  // Never throws, never blocks the caller's own mutation — a notification
  // failure must not turn a successful follow/comment/appreciate into an
  // error response.
  function notifyArtistry(userId, { type, fromUserId, postId, content }) {
    try {
      const STATE = globalThis._concordSTATE;
      if (!STATE || !userId) return;
      createNotification(STATE, { userId, type, fromUserId, postId, content });
    } catch (_e) { /* best effort — never break the artistry action over this */ }
  }

  // ── Native image upload/blob-storage pipeline for project images ────
  // Closes docs/WAVE4_INVENTORY.md line 101 / artistry-capability-map.md
  // item 12: "No native image upload/blob-storage pipeline for project
  // images (URL-only)". Structurally cloned from travel.js's "Travel
  // document binary attachments" trio (travel-doc-attachment-upload/
  // -download/-delete, server/domains/travel.js:945-1016): base64 payload
  // validation (optional `data:` prefix stripped), a per-file size cap,
  // and the heavy `data` blob never returned from anything but the
  // dedicated download macro. Deliberately NOT the misfiled
  // `apiHelpers.artistry.blobs` facility in server.js (~lines 73021-73145)
  // — that is a different, cross-lens DAW (audio) blob system; this store
  // is artistry-native and lives entirely in this file.
  //
  // Stored per-user (s.projectImages, a userId -> array Map) exactly like
  // every other artistryLens sub-state bucket, so ownership isolation
  // falls out of the same per-user Map pattern the rest of this domain
  // relies on. An uploaded image is referenced from `images[].url` (both
  // at projectCreate and projectUpdate) via a stable `artistry-img:<id>`
  // scheme, resolved back to real bytes through project-image-download.
  // External URLs keep working unchanged — the two are additive, not a
  // schema break.
  const ART_MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB cap per image
  const ART_IMG_REF_PREFIX = "artistry-img:";
  // A url is either a plain external URL/string (always valid) or an
  // `artistry-img:<id>` reference, which is only valid when it points at
  // an image the CALLING user actually uploaded — this is what makes the
  // reference scheme "wired" rather than a free-text string that happens
  // to look structured.
  const artImgRefValid = (s, uid, url) => {
    if (!url.startsWith(ART_IMG_REF_PREFIX)) return true;
    const id = url.slice(ART_IMG_REF_PREFIX.length);
    return (s.projectImages.get(uid) || []).some((img) => img.id === id);
  };

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
        })).filter((im) => im.url && artImgRefValid(s, uid, im.url)),
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
        })).filter((im) => im.url && artImgRefValid(s, uid, im.url));
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

  // ── Project image blob storage (native upload pipeline) ─────────────
  // See the ART_MAX_IMAGE_BYTES / artImgRefValid header comment above for
  // context. Upload is intentionally NOT scoped to an existing project —
  // exactly like a real portfolio tool, you select/attach photos before
  // (or independent of) saving the project draft; projectCreate/Update
  // then reference the resulting id via `artistry-img:<id>` in images[].url.
  registerLensAction("artistry", "project-image-upload", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const p = params || {};
      const uid = artAid(ctx);
      const fileName = artClean(p.fileName, 160);
      if (!fileName) return { ok: false, error: "fileName required" };
      const data = String(p.data || "");
      if (!data) return { ok: false, error: "file data required" };
      // base64 payload, optionally with a data: prefix.
      const b64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
      if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { ok: false, error: "data must be base64" };
      const bytes = Math.floor((b64.replace(/\s/g, "").length * 3) / 4);
      if (bytes > ART_MAX_IMAGE_BYTES) return { ok: false, error: "image exceeds 8 MB limit" };
      const image = {
        id: artId("img"),
        userId: uid,
        fileName,
        mimeType: artClean(p.mimeType, 100) || "application/octet-stream",
        bytes,
        data: b64.replace(/\s/g, ""),
        createdAt: artNow(),
      };
      artList(s.projectImages, uid).push(image);
      saveArtState();
      // Return without the heavy data blob, plus the stable reference
      // string projectCreate/Update's images[].url slot accepts.
      const { data: _d, ...meta } = image;
      return { ok: true, result: { image: { ...meta, ref: `${ART_IMG_REF_PREFIX}${image.id}` } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Metadata-only list of the caller's uploaded images (for a "reuse a
  // previously uploaded photo" picker) — never returns the blob.
  registerLensAction("artistry", "project-image-list", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const images = (s.projectImages.get(uid) || [])
        .map(({ data: _d, ...meta }) => ({ ...meta, ref: `${ART_IMG_REF_PREFIX}${meta.id}` }));
      return { ok: true, result: { images, count: images.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Fetch a single uploaded image's real bytes for <img src> display.
  // Ownership-checked implicitly — the lookup is scoped to the caller's
  // own per-user bucket, so another user's image id simply isn't present
  // in the array being searched. Accepts either a raw id or a full
  // `artistry-img:<id>` reference string for caller convenience.
  registerLensAction("artistry", "project-image-download", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const raw = artClean((params || {}).id, 200);
      const id = raw.startsWith(ART_IMG_REF_PREFIX) ? raw.slice(ART_IMG_REF_PREFIX.length) : raw;
      const img = (s.projectImages.get(artAid(ctx)) || []).find((x) => x.id === id);
      if (!img) return { ok: false, error: "image not found" };
      return {
        ok: true,
        result: { id: img.id, fileName: img.fileName, mimeType: img.mimeType, bytes: img.bytes, data: img.data },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "project-image-delete", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const raw = artClean((params || {}).id, 200);
      const id = raw.startsWith(ART_IMG_REF_PREFIX) ? raw.slice(ART_IMG_REF_PREFIX.length) : raw;
      const arr = s.projectImages.get(artAid(ctx)) || [];
      const idx = arr.findIndex((x) => x.id === id);
      if (idx === -1) return { ok: false, error: "image not found" };
      arr.splice(idx, 1);
      saveArtState();
      return { ok: true, result: { deleted: id } };
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
      const isNewFollow = !following.includes(target);
      if (isNewFollow) following.push(target);
      saveArtState();
      // Only the transition into "following" is a notification-worthy
      // event — a repeat follow call (already following) is a no-op and
      // must not re-notify the target on every idempotent retry.
      if (isNewFollow) {
        notifyArtistry(target, {
          type: "follow", fromUserId: uid,
          content: `${uid} started following your artistry portfolio`,
        });
      }
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

  // ── Direct messages between creators ─────────────────────────────────
  // Closes docs/WAVE4_INVENTORY.md line 100 / artistry-capability-map.md
  // item 11: "No direct-messaging system between creators." Structurally
  // cloned from server/domains/alliance.js's cross-org DM primitive
  // (dmThreadKey / dm-send / dm-list / dm-inbox, alliance.js:1130-1239):
  // same sorted-pair `[a,b].sort().join("::")` threadKey so both sides
  // converge on one storage key regardless of who initiated, same
  // Map<threadKey, Array<message>> state shape, same three-macro surface,
  // same honest-fallback displayName resolution for dm-inbox.
  //
  // What's deliberately NOT copied is the message shape and the recipient-
  // validation rule — both correctly diverge from the alliance template:
  //
  // Message shape: alliance's channel messages already carry attachments +
  // emoji reactions + parentId threading, so its DMs inherited that richer
  // shape. This lens's own existing per-project comments (commentAdd,
  // above) are a plain { id, projectId, userId, body, createdAt } with no
  // attachments/reactions/threading — so DMs mirror THAT simpler shape
  // (field named `body` to match, not `content`) rather than importing
  // richness alliance's own domain happens to have and this one doesn't.
  //
  // Recipient validation: alliance has closed membership — every real user
  // on that lens belongs to some alliance, so `findAllianceMember` (scan
  // every alliance's roster) is a complete "is this a real, known person"
  // check. Artistry has NO membership concept at all — anyone with a
  // session can follow/comment/view — so there is no roster to scan. The
  // honest equivalent here is "has this userId left any real, visible
  // trace on this lens": either they've set up a profile (`profileUpdate`
  // → `s.profiles`) or they've published/created at least one project
  // (`projectCreate` → `s.projects`). A wholly fabricated/never-seen userId
  // has neither and is rejected — same discipline as alliance's "reject a
  // fabricated/unknown userId" case, just adapted from a closed-membership
  // check to an open-participation check. This mirrors the existing
  // `follow`/`unfollow` macros' own honest gap (a free-text `targetUserId`
  // with only a self-follow guard, no existence check) by finally adding
  // the existence check follow/unfollow never had — DMs don't get to
  // reach a name nobody has ever actually used on this lens.
  function artDmThreadKey(a, b) { return [a, b].sort().join("::"); }

  function artDmRecipientExists(s, userId) {
    if (s.profiles.has(userId)) return true;
    const projects = s.projects.get(userId);
    return Array.isArray(projects) && projects.length > 0;
  }

  // Real display name if resolvable; otherwise the raw userId — never a
  // fabricated name (honest-by-construction, same as alliance's
  // dmDisplayName: a partner who never set a profile displayName still
  // shows up in the inbox by their real id).
  function artDmDisplayName(s, userId) {
    const profile = s.profiles.get(userId);
    return (profile && profile.displayName) || userId;
  }

  registerLensAction("artistry", "dm-send", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const fromId = artAid(ctx);
      const toId = artClean((params || {}).toId, 80);
      if (!toId) return { ok: false, error: "toId_required" };
      if (!artDmRecipientExists(s, toId)) return { ok: false, error: "recipient_not_found" };
      const body = artClean((params || {}).body, 1200);
      if (!body) return { ok: false, error: "body_required" };
      const key = artDmThreadKey(fromId, toId);
      const thread = artList(s.dmThreads, key);
      const message = {
        id: artId("dm"),
        threadKey: key,
        fromId,
        toId,
        fromName: artDmDisplayName(s, fromId),
        body,
        createdAt: artNow(),
      };
      thread.push(message);
      saveArtState();
      return { ok: true, result: { message, threadKey: key } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Fetch the DM thread between the caller and a specific partner. The
  // thread key is derived from the CALLER's own id + the requested partner,
  // so a third party who is not one of the two real participants can never
  // land on the real thread's key — they only ever see their own (empty,
  // freshly-created) thread with that partner. Privacy is enforced by the
  // key derivation itself, not by a separate ACL check.
  registerLensAction("artistry", "dm-list", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = artAid(ctx);
      const partnerId = artClean((params || {}).partnerId, 80);
      if (!partnerId) return { ok: false, error: "partnerId_required" };
      const key = artDmThreadKey(userId, partnerId);
      // Push order is already chronological ascending (mirrors commentList).
      const messages = artList(s.dmThreads, key).slice();
      return { ok: true, result: { messages, count: messages.length, threadKey: key } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // List every DM thread the caller participates in — inbox view.
  registerLensAction("artistry", "dm-inbox", (ctx, artifact, _params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = artAid(ctx);
      const threads = [];
      for (const [key, msgs] of s.dmThreads.entries()) {
        const parts = key.split("::");
        if (!parts.includes(userId) || msgs.length === 0) continue;
        const partnerId = parts.find((p) => p !== userId) || parts[0];
        const last = msgs[msgs.length - 1];
        threads.push({
          partnerId,
          partnerName: artDmDisplayName(s, partnerId),
          threadKey: key,
          lastMessage: last.body,
          lastFrom: last.fromId,
          lastAt: last.createdAt,
          messageCount: msgs.length,
        });
      }
      threads.sort((a, b) => (b.lastAt > a.lastAt ? 1 : -1));
      return { ok: true, result: { threads, count: threads.length } };
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
      const uid = artAid(ctx);
      const comment = {
        id: artId("cmt"),
        projectId,
        userId: uid,
        body,
        createdAt: artNow(),
      };
      artList(s.comments, projectId).push(comment);
      saveArtState();
      // Never self-notify — commenting on your own project shouldn't
      // page you about yourself.
      const owner = findProjectOwner(s, projectId);
      if (owner && owner.userId !== uid) {
        notifyArtistry(owner.userId, {
          type: "comment", fromUserId: uid, postId: projectId,
          content: `${uid} commented on your project "${owner.title}"`,
        });
      }
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
      // Only the toggle-ON transition (liking) is notification-worthy —
      // un-appreciating must never notify, and self-appreciation must
      // never notify either.
      if (appreciated) {
        const owner = findProjectOwner(s, projectId);
        if (owner && owner.userId !== uid) {
          notifyArtistry(owner.userId, {
            type: "like", fromUserId: uid, postId: projectId,
            content: `${uid} appreciated your project "${owner.title}"`,
          });
        }
      }
      return { ok: true, result: { appreciated, count: list.length, projectId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Notification feed ────────────────────────────────────────────────
  // Durable, in-lens read of the notifications follow/commentAdd/appreciate
  // (above) generate via the platform notification substrate. Filtered to
  // the three types this unit produces (follow/comment/like) — this is
  // deliberately an "your artistry activity" feed, not a mount of the
  // whole platform inbox (mentions/DMs/other-lens alerts surface through
  // their own lenses). Real-time delivery is already handled for free by
  // useSocialNotificationToast's socket subscription; these two macros
  // cover the durable "catch up on what you missed" half.
  const ART_NOTIF_TYPES = new Set(["follow", "comment", "like"]);
  registerLensAction("artistry", "notifications-list", (ctx, artifact, params) => {
    try {
      const STATE = globalThis._concordSTATE;
      if (!STATE) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const p = params || {};
      const unreadOnly = !!p.unreadOnly;
      const limitReq = Number(p.limit);
      const limit = Number.isFinite(limitReq) ? Math.min(Math.max(limitReq, 1), 100) : 30;
      // Pull generously from the shared store, then filter to artistry's
      // own notification types before applying the caller's limit — the
      // underlying store already caps at 500 per user (social-layer.js).
      const raw = getNotifications(STATE, uid, { limit: 500, offset: 0, unreadOnly });
      const notifications = (raw.notifications || [])
        .filter((n) => ART_NOTIF_TYPES.has(n.type))
        .slice(0, limit);
      const unread = notifications.filter((n) => !n.read).length;
      return { ok: true, result: { notifications, count: notifications.length, unread } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("artistry", "notifications-mark-read", (ctx, artifact, params) => {
    try {
      const STATE = globalThis._concordSTATE;
      if (!STATE) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const p = params || {};
      if (p.all) {
        const r = markAllNotificationsRead(STATE, uid);
        return { ok: true, result: { markedRead: r.markedRead } };
      }
      const id = artClean(p.id, 80);
      if (!id) return { ok: false, error: "id_required" };
      const r = markNotificationRead(STATE, { userId: uid, notificationId: id });
      if (!r.ok) return { ok: false, error: r.error || "not_found" };
      return { ok: true, result: { id } };
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

  // computeArtistryStats — the single source of truth for a creator's live
  // aggregate counters. `profileGet` and `analyticsSnapshot` BOTH call this
  // (never a parallel computation) so a trend chart built from stored
  // snapshots always matches what profileGet would show on that day.
  // `projectsOverride` lets profileGet pass its already-visibility-filtered
  // project list (private projects excluded when viewer !== owner); when
  // omitted (the owner-only call sites: analyticsSnapshot, the auto-snapshot
  // below) it reads the owner's full project list, unfiltered — matching
  // profileGet's own isOwner=true branch, which never filters either.
  function computeArtistryStats(s, uid, projectsOverride) {
    const list = projectsOverride || (s.projects.get(uid) || []);
    const totalViews = list.reduce((sum, p) => sum + (p.views || 0), 0);
    const totalAppreciations = list.reduce(
      (sum, p) => sum + (s.appreciations.get(p.id) || []).length, 0);
    const followers = [];
    for (const [u, following] of s.follows) { if (following.includes(uid)) followers.push(u); }
    return {
      projectCount: list.length,
      totalViews,
      totalAppreciations,
      followerCount: followers.length,
      followingCount: (s.follows.get(uid) || []).length,
    };
  }

  // captureAnalyticsSnapshot — records (or refreshes) the CALLER'S OWN
  // timestamped analytics row for today. One row per (userId, calendar day,
  // UTC): a second call on the same UTC date UPDATES the existing row in
  // place instead of pushing a duplicate, because a creator's live counters
  // change continuously through the day — the stored snapshot should reflect
  // the LATEST real state as of the most recent call on that date, not an
  // ever-growing pile of same-day points. Every field is copied straight
  // from `computeArtistryStats` — never estimated, interpolated, or
  // fabricated for a day with no calls (a day with no call simply has no
  // row; analyticsHistory does not backfill gaps).
  function captureAnalyticsSnapshot(s, uid) {
    const stats = computeArtistryStats(s, uid);
    const date = artNow().slice(0, 10); // YYYY-MM-DD, UTC calendar day
    const list = artList(s.analyticsSnapshots, uid);
    const existing = list.find((x) => x.date === date);
    if (existing) {
      existing.totalViews = stats.totalViews;
      existing.totalAppreciations = stats.totalAppreciations;
      existing.followerCount = stats.followerCount;
      existing.followingCount = stats.followingCount;
      existing.projectCount = stats.projectCount;
      existing.updatedAt = artNow();
      return { snapshot: existing, deduped: true };
    }
    const snapshot = {
      id: artId("asnap"),
      userId: uid,
      date,
      totalViews: stats.totalViews,
      totalAppreciations: stats.totalAppreciations,
      followerCount: stats.followerCount,
      followingCount: stats.followingCount,
      projectCount: stats.projectCount,
      createdAt: artNow(),
      updatedAt: artNow(),
    };
    list.push(snapshot);
    return { snapshot, deduped: false };
  }

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
      const isOwner = uid === viewer;
      const stats = computeArtistryStats(s, uid, projects);
      // Auto-snapshot: the owner loading their own profile is the natural
      // moment to refresh today's trend point, so history accumulates
      // without a separate explicit action (matching how real creator-
      // analytics products trend automatically). Gated to isOwner only —
      // another user viewing this profile must never write to the owner's
      // analytics. Same-day de-dup (above) means repeated profileGet calls
      // within one UTC day update the same row rather than spamming new
      // ones. Best-effort: a snapshot failure must never break profileGet.
      if (isOwner) {
        try { captureAnalyticsSnapshot(s, uid); saveArtState(); } catch (_e) { /* best-effort, never break profileGet */ }
      }
      return {
        ok: true,
        result: {
          profile,
          projects: projects.map((p) => ({
            id: p.id, title: p.title, coverUrl: p.coverUrl || (p.images[0]?.url || ""),
            discipline: p.discipline, views: p.views,
            appreciations: (s.appreciations.get(p.id) || []).length,
          })),
          stats,
          isOwner,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * analyticsSnapshot — explicitly record today's real analytics point for
   * the CALLER (not another user; always `artAid(ctx)`). Same source data
   * and same same-day de-dup as the auto-snapshot in profileGet — this
   * exists so a caller (e.g. an admin dashboard, a scheduled job, a test)
   * can force a refresh without going through profileGet.
   */
  registerLensAction("artistry", "analyticsSnapshot", (ctx, _artifact, _params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const { snapshot, deduped } = captureAnalyticsSnapshot(s, uid);
      saveArtState();
      return { ok: true, result: { snapshot, deduped } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * analyticsHistory — the caller's real stored analytics snapshots,
   * chronological, for charting a trend. params: { days? } — how many days
   * back to include (default 30, min 1, capped 365). Always scoped to the
   * caller (`artAid(ctx)`) — creator analytics are private, never another
   * user's trend data, mirroring real portfolio products (Behance/ArtStation
   * don't expose one creator's view-trend to another). Each snapshot after
   * the first carries real deltas against the immediately-preceding real
   * snapshot (`viewsDelta`/`appreciationsDelta`/`followerDelta`); the FIRST
   * snapshot in the returned window has no prior point to diff against, so
   * its deltas are honestly `null` — never a fabricated/interpolated value.
   */
  registerLensAction("artistry", "analyticsHistory", (ctx, artifact, params) => {
    try {
      const s = getArtState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const uid = artAid(ctx);
      const p = params || {};
      const rawDays = Number(p.days);
      const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? Math.round(rawDays) : 30));
      const cutoff = Date.now() - days * 86400000;
      const list = (s.analyticsSnapshots.get(uid) || [])
        .filter((x) => Date.parse(`${x.date}T00:00:00.000Z`) >= cutoff)
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      let prev = null;
      const snapshots = list.map((snap) => {
        const viewsDelta = prev ? snap.totalViews - prev.totalViews : null;
        const appreciationsDelta = prev ? snap.totalAppreciations - prev.totalAppreciations : null;
        const followerDelta = prev ? snap.followerCount - prev.followerCount : null;
        prev = snap;
        return { ...snap, viewsDelta, appreciationsDelta, followerDelta };
      });
      return { ok: true, result: { snapshots, count: snapshots.length, days } };
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
