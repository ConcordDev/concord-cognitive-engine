// server/domains/fashion.js
import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";
import { cachedFetchJson } from "../lib/external-fetch.js";

export default function registerFashionActions(registerLensAction) {
  registerLensAction("fashion", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("fashion");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  registerLensAction("fashion", "styleProfile", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const preferences = data.preferences || {};
    const wardrobe = data.wardrobe || [];
    const colors = wardrobe.map(i => i.color).filter(Boolean);
    const colorFreq = {};
    for (const c of colors) colorFreq[c.toLowerCase()] = (colorFreq[c.toLowerCase()] || 0) + 1;
    const topColors = Object.entries(colorFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const categories = {};
    for (const i of wardrobe) { const c = i.category || "other"; categories[c] = (categories[c] || 0) + 1; }
    return { ok: true, result: { wardrobeSize: wardrobe.length, dominantColors: topColors.map(([c, n]) => ({ color: c, count: n })), categoryBreakdown: categories, style: preferences.style || "casual", bodyType: preferences.bodyType || "unspecified", budget: preferences.budget || "moderate", season: preferences.season || "all-season" } };
  });
  registerLensAction("fashion", "outfitSuggest", (ctx, artifact, _params) => {
    const wardrobe = artifact.data?.wardrobe || [];
    const occasion = (artifact.data?.occasion || "casual").toLowerCase();
    const season = (artifact.data?.season || "spring").toLowerCase();
    const tops = wardrobe.filter(i => (i.category || "").toLowerCase().includes("top") || (i.category || "").toLowerCase().includes("shirt") || (i.category || "").toLowerCase().includes("blouse"));
    const bottoms = wardrobe.filter(i => (i.category || "").toLowerCase().includes("bottom") || (i.category || "").toLowerCase().includes("pant") || (i.category || "").toLowerCase().includes("skirt"));
    const outerwear = wardrobe.filter(i => (i.category || "").toLowerCase().includes("jacket") || (i.category || "").toLowerCase().includes("coat"));
    const suggestions = [];
    for (let i = 0; i < Math.min(3, tops.length); i++) {
      const outfit = { top: tops[i]?.name, bottom: bottoms[i % bottoms.length]?.name || "Any bottom" };
      if (season === "winter" || season === "fall") outfit.outerwear = outerwear[0]?.name || "Add a jacket";
      suggestions.push(outfit);
    }
    return { ok: true, result: { occasion, season, suggestions: suggestions.length > 0 ? suggestions : [{ note: "Add wardrobe items to get outfit suggestions" }], wardrobeSize: wardrobe.length, missingPieces: tops.length === 0 ? ["tops"] : bottoms.length === 0 ? ["bottoms"] : [] } };
  });
  registerLensAction("fashion", "trendAnalysis", (ctx, artifact, _params) => {
    const trends = artifact.data?.trends || [];
    if (trends.length === 0) return { ok: true, result: { message: "Add trend data to analyze fashion direction." } };
    const byCategory = {};
    for (const t of trends) { const c = t.category || "general"; if (!byCategory[c]) byCategory[c] = []; byCategory[c].push(t); }
    return { ok: true, result: { totalTrends: trends.length, categories: Object.keys(byCategory).length, byCategory: Object.entries(byCategory).map(([cat, items]) => ({ category: cat, count: items.length, trending: items.filter(i => i.trending !== false).length })), hottest: trends.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0]?.name || "N/A" } };
  });
  registerLensAction("fashion", "costPerWear", (ctx, artifact, _params) => {
    const items = artifact.data?.items || artifact.data?.wardrobe || [];
    if (items.length === 0) return { ok: true, result: { message: "Add wardrobe items with cost and wear count." } };
    const analyzed = items.map(i => { const cost = parseFloat(i.cost || i.price) || 0; const wears = parseInt(i.wears || i.timesWorn) || 1; return { name: i.name, cost, wears, costPerWear: Math.round((cost / wears) * 100) / 100, value: cost / wears < 5 ? "excellent" : cost / wears < 15 ? "good" : cost / wears < 30 ? "moderate" : "poor" }; }).sort((a, b) => a.costPerWear - b.costPerWear);
    return { ok: true, result: { items: analyzed, bestValue: analyzed[0]?.name, worstValue: analyzed[analyzed.length - 1]?.name, avgCostPerWear: Math.round(analyzed.reduce((s, i) => s + i.costPerWear, 0) / analyzed.length * 100) / 100, tip: "Items worn 30+ times typically achieve excellent cost-per-wear" } };
  });

  // ─── Stylebook 2026 parity — digital closet ─────────────────────────
  // Wardrobe catalog, outfits, a wear calendar, cost-per-wear, packing
  // lists, lookbooks and closet analytics. All STATE-backed, per-user.

  function getFashionState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.fashionLens) STATE.fashionLens = {};
    const s = STATE.fashionLens;
    for (const k of ["items", "outfits", "wearLog", "packing", "lookbooks"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveFashionState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const fsId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fsNow = () => new Date().toISOString();
  const fsAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fsListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const fsNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const fsClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const fsDay = (v) => fsClean(v, 10).slice(0, 10);
  const findItem = (s, userId, id) => (s.items.get(userId) || []).find((i) => i.id === id) || null;
  const findOutfit = (s, userId, id) => (s.outfits.get(userId) || []).find((o) => o.id === id) || null;

  const CATEGORIES = ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag", "activewear", "underwear"];

  function itemView(item) {
    const cpw = item.timesWorn > 0 ? Math.round((item.cost / item.timesWorn) * 100) / 100 : null;
    return {
      ...item,
      costPerWear: cpw,
      valueRating: cpw == null ? "unworn"
        : cpw < 5 ? "excellent" : cpw < 15 ? "good" : cpw < 30 ? "moderate" : "poor",
    };
  }

  // ── Wardrobe items ──────────────────────────────────────────────────
  registerLensAction("fashion", "item-add", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = fsClean(params.name, 120);
    if (!name) return { ok: false, error: "item name required" };
    const item = {
      id: fsId("itm"), name,
      category: CATEGORIES.includes(String(params.category).toLowerCase())
        ? String(params.category).toLowerCase() : "top",
      brand: fsClean(params.brand, 80) || null,
      color: fsClean(params.color, 40).toLowerCase() || null,
      season: ["spring", "summer", "fall", "winter", "all"].includes(String(params.season).toLowerCase())
        ? String(params.season).toLowerCase() : "all",
      cost: Math.max(0, fsNum(params.cost)),
      timesWorn: Math.max(0, Math.round(fsNum(params.timesWorn))),
      photo: fsClean(params.photo, 500) || null,
      archived: false,
      lastWorn: null,
      createdAt: fsNow(),
    };
    fsListB(s.items, fsAid(ctx)).push(item);
    saveFashionState();
    return { ok: true, result: { item: itemView(item) } };
  });

  registerLensAction("fashion", "item-list", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let items = [...(s.items.get(fsAid(ctx)) || [])];
    if (!params.includeArchived) items = items.filter((i) => !i.archived);
    if (params.category) items = items.filter((i) => i.category === String(params.category).toLowerCase());
    if (params.season) items = items.filter((i) => i.season === String(params.season).toLowerCase() || i.season === "all");
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { items: items.map(itemView), count: items.length } };
  });

  registerLensAction("fashion", "item-update", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = findItem(s, fsAid(ctx), params.id);
    if (!item) return { ok: false, error: "item not found" };
    if (params.name != null) { const n = fsClean(params.name, 120); if (n) item.name = n; }
    if (params.brand != null) item.brand = fsClean(params.brand, 80) || null;
    if (params.color != null) item.color = fsClean(params.color, 40).toLowerCase() || null;
    if (params.cost != null) item.cost = Math.max(0, fsNum(params.cost));
    if (params.category != null && CATEGORIES.includes(String(params.category).toLowerCase())) {
      item.category = String(params.category).toLowerCase();
    }
    if (params.archived != null) item.archived = params.archived === true;
    saveFashionState();
    return { ok: true, result: { item: itemView(item) } };
  });

  registerLensAction("fashion", "item-delete", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.items.get(fsAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "item not found" };
    arr.splice(i, 1);
    saveFashionState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("fashion", "item-wear", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const item = findItem(s, userId, params.id);
    if (!item) return { ok: false, error: "item not found" };
    const date = fsDay(params.date) || fsDay(fsNow());
    item.timesWorn += 1;
    item.lastWorn = date;
    fsListB(s.wearLog, userId).push({ id: fsId("wl"), itemId: item.id, outfitId: null, date, at: fsNow() });
    saveFashionState();
    return { ok: true, result: { item: itemView(item) } };
  });

  // ── Outfits ─────────────────────────────────────────────────────────
  registerLensAction("fashion", "outfit-create", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const name = fsClean(params.name, 120);
    if (!name) return { ok: false, error: "outfit name required" };
    const itemIds = Array.isArray(params.itemIds)
      ? params.itemIds.map(String).filter((id) => findItem(s, userId, id)) : [];
    const outfit = {
      id: fsId("oft"), name, itemIds,
      occasion: fsClean(params.occasion, 60).toLowerCase() || "casual",
      season: ["spring", "summer", "fall", "winter", "all"].includes(String(params.season).toLowerCase())
        ? String(params.season).toLowerCase() : "all",
      timesWorn: 0, lastWorn: null, createdAt: fsNow(),
    };
    fsListB(s.outfits, userId).push(outfit);
    saveFashionState();
    return { ok: true, result: { outfit } };
  });

  registerLensAction("fashion", "outfit-list", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    let outfits = [...(s.outfits.get(userId) || [])];
    if (params.occasion) outfits = outfits.filter((o) => o.occasion === String(params.occasion).toLowerCase());
    const itemName = new Map((s.items.get(userId) || []).map((i) => [i.id, i.name]));
    outfits = outfits.map((o) => ({
      ...o,
      itemNames: o.itemIds.map((id) => itemName.get(id)).filter(Boolean),
    }));
    return { ok: true, result: { outfits, count: outfits.length } };
  });

  registerLensAction("fashion", "outfit-detail", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const outfit = findOutfit(s, userId, params.id);
    if (!outfit) return { ok: false, error: "outfit not found" };
    const items = outfit.itemIds.map((id) => findItem(s, userId, id)).filter(Boolean).map(itemView);
    return {
      ok: true,
      result: { outfit, items, totalCost: Math.round(items.reduce((a, i) => a + fsNum(i.cost), 0) * 100) / 100 },
    };
  });

  registerLensAction("fashion", "outfit-delete", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.outfits.get(fsAid(ctx)) || [];
    const i = arr.findIndex((o) => o.id === params.id);
    if (i < 0) return { ok: false, error: "outfit not found" };
    arr.splice(i, 1);
    saveFashionState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("fashion", "outfit-wear", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const outfit = findOutfit(s, userId, params.id);
    if (!outfit) return { ok: false, error: "outfit not found" };
    const date = fsDay(params.date) || fsDay(fsNow());
    outfit.timesWorn += 1;
    outfit.lastWorn = date;
    for (const id of outfit.itemIds) {
      const item = findItem(s, userId, id);
      if (item) { item.timesWorn += 1; item.lastWorn = date; }
    }
    fsListB(s.wearLog, userId).push({ id: fsId("wl"), itemId: null, outfitId: outfit.id, date, at: fsNow() });
    saveFashionState();
    return { ok: true, result: { outfit } };
  });

  // ── Wear calendar ───────────────────────────────────────────────────
  registerLensAction("fashion", "calendar-log", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const date = fsDay(params.date);
    if (!date) return { ok: false, error: "date required" };
    let entry;
    if (params.outfitId) {
      const outfit = findOutfit(s, userId, params.outfitId);
      if (!outfit) return { ok: false, error: "outfit not found" };
      outfit.timesWorn += 1; outfit.lastWorn = date;
      for (const id of outfit.itemIds) {
        const item = findItem(s, userId, id);
        if (item) { item.timesWorn += 1; item.lastWorn = date; }
      }
      entry = { id: fsId("wl"), itemId: null, outfitId: outfit.id, date, at: fsNow() };
    } else if (params.itemId) {
      const item = findItem(s, userId, params.itemId);
      if (!item) return { ok: false, error: "item not found" };
      item.timesWorn += 1; item.lastWorn = date;
      entry = { id: fsId("wl"), itemId: item.id, outfitId: null, date, at: fsNow() };
    } else {
      return { ok: false, error: "itemId or outfitId required" };
    }
    fsListB(s.wearLog, userId).push(entry);
    saveFashionState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("fashion", "calendar-view", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const month = fsClean(params.month, 7) || fsDay(fsNow()).slice(0, 7);
    const itemName = new Map((s.items.get(userId) || []).map((i) => [i.id, i.name]));
    const outfitName = new Map((s.outfits.get(userId) || []).map((o) => [o.id, o.name]));
    const entries = (s.wearLog.get(userId) || [])
      .filter((w) => String(w.date).startsWith(month))
      .map((w) => ({
        date: w.date,
        label: w.outfitId ? (outfitName.get(w.outfitId) || "(outfit)") : (itemName.get(w.itemId) || "(item)"),
        kind: w.outfitId ? "outfit" : "item",
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, result: { month, entries, daysLogged: new Set(entries.map((e) => e.date)).size } };
  });

  // ── Packing lists ───────────────────────────────────────────────────
  registerLensAction("fashion", "packing-create", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = fsClean(params.name, 120);
    if (!name) return { ok: false, error: "packing list name required" };
    const list = {
      id: fsId("pk"), name,
      destination: fsClean(params.destination, 120) || null,
      itemIds: [], createdAt: fsNow(),
    };
    fsListB(s.packing, fsAid(ctx)).push(list);
    saveFashionState();
    return { ok: true, result: { packingList: list } };
  });

  registerLensAction("fashion", "packing-list", (ctx, _a, _params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lists = (s.packing.get(fsAid(ctx)) || []).map((p) => ({ ...p, itemCount: p.itemIds.length }));
    return { ok: true, result: { packingLists: lists, count: lists.length } };
  });

  registerLensAction("fashion", "packing-add-item", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const list = (s.packing.get(userId) || []).find((p) => p.id === params.packingId);
    if (!list) return { ok: false, error: "packing list not found" };
    if (!findItem(s, userId, params.itemId)) return { ok: false, error: "item not found" };
    if (params.remove === true) list.itemIds = list.itemIds.filter((id) => id !== params.itemId);
    else if (!list.itemIds.includes(params.itemId)) list.itemIds.push(String(params.itemId));
    saveFashionState();
    return { ok: true, result: { packingId: list.id, itemCount: list.itemIds.length } };
  });

  registerLensAction("fashion", "packing-detail", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const list = (s.packing.get(userId) || []).find((p) => p.id === params.id);
    if (!list) return { ok: false, error: "packing list not found" };
    const items = list.itemIds.map((id) => findItem(s, userId, id)).filter(Boolean).map(itemView);
    return { ok: true, result: { packingList: list, items } };
  });

  // ── Lookbooks ───────────────────────────────────────────────────────
  registerLensAction("fashion", "lookbook-create", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const name = fsClean(params.name, 120);
    if (!name) return { ok: false, error: "lookbook name required" };
    const outfitIds = Array.isArray(params.outfitIds)
      ? params.outfitIds.map(String).filter((id) => findOutfit(s, userId, id)) : [];
    const lookbook = { id: fsId("lb"), name, outfitIds, createdAt: fsNow() };
    fsListB(s.lookbooks, userId).push(lookbook);
    saveFashionState();
    return { ok: true, result: { lookbook } };
  });

  registerLensAction("fashion", "lookbook-list", (ctx, _a, _params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lookbooks = (s.lookbooks.get(fsAid(ctx)) || []).map((l) => ({ ...l, outfitCount: l.outfitIds.length }));
    return { ok: true, result: { lookbooks, count: lookbooks.length } };
  });

  registerLensAction("fashion", "lookbook-add-outfit", (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const lb = (s.lookbooks.get(userId) || []).find((l) => l.id === params.lookbookId);
    if (!lb) return { ok: false, error: "lookbook not found" };
    if (!findOutfit(s, userId, params.outfitId)) return { ok: false, error: "outfit not found" };
    if (params.remove === true) lb.outfitIds = lb.outfitIds.filter((id) => id !== params.outfitId);
    else if (!lb.outfitIds.includes(params.outfitId)) lb.outfitIds.push(String(params.outfitId));
    saveFashionState();
    return { ok: true, result: { lookbookId: lb.id, outfitCount: lb.outfitIds.length } };
  });

  // ── Analytics ───────────────────────────────────────────────────────
  registerLensAction("fashion", "closet-stats", (ctx, _a, _params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const items = (s.items.get(userId) || []).filter((i) => !i.archived);
    const byCategory = {};
    let totalValue = 0, totalWears = 0, neverWorn = 0;
    for (const i of items) {
      byCategory[i.category] = (byCategory[i.category] || 0) + 1;
      totalValue += fsNum(i.cost);
      totalWears += i.timesWorn;
      if (i.timesWorn === 0) neverWorn++;
    }
    const worn = items.filter((i) => i.timesWorn > 0);
    const avgCpw = worn.length
      ? Math.round((worn.reduce((a, i) => a + i.cost / i.timesWorn, 0) / worn.length) * 100) / 100 : null;
    return {
      ok: true,
      result: {
        items: items.length,
        outfits: (s.outfits.get(userId) || []).length,
        byCategory,
        totalValue: Math.round(totalValue * 100) / 100,
        totalWears,
        neverWorn,
        avgCostPerWear: avgCpw,
      },
    };
  });

  registerLensAction("fashion", "wear-insights", (ctx, _a, _params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = (s.items.get(fsAid(ctx)) || []).filter((i) => !i.archived).map(itemView);
    const worn = items.filter((i) => i.timesWorn > 0);
    const sortByWorn = [...items].sort((a, b) => b.timesWorn - a.timesWorn);
    const sortByCpw = [...worn].sort((a, b) => (a.costPerWear ?? 0) - (b.costPerWear ?? 0));
    return {
      ok: true,
      result: {
        mostWorn: sortByWorn.slice(0, 5).map((i) => ({ name: i.name, timesWorn: i.timesWorn })),
        bestValue: sortByCpw.slice(0, 5).map((i) => ({ name: i.name, costPerWear: i.costPerWear })),
        neverWorn: items.filter((i) => i.timesWorn === 0).map((i) => ({ name: i.name, cost: i.cost })),
        deadStock: items.filter((i) => i.timesWorn === 0).length,
      },
    };
  });

  registerLensAction("fashion", "fashion-dashboard", (ctx, _a, _params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const items = (s.items.get(userId) || []).filter((i) => !i.archived);
    const month = fsDay(fsNow()).slice(0, 7);
    const wornThisMonth = (s.wearLog.get(userId) || []).filter((w) => String(w.date).startsWith(month)).length;
    return {
      ok: true,
      result: {
        items: items.length,
        outfits: (s.outfits.get(userId) || []).length,
        lookbooks: (s.lookbooks.get(userId) || []).length,
        packingLists: (s.packing.get(userId) || []).length,
        wornThisMonth,
        closetValue: Math.round(items.reduce((a, i) => a + fsNum(i.cost), 0) * 100) / 100,
        neverWorn: items.filter((i) => i.timesWorn === 0).length,
      },
    };
  });

  // ════════════════════════════════════════════════════════════════════
  //  2026 PARITY BACKLOG — Whering / Stylebook feature gaps
  // ════════════════════════════════════════════════════════════════════

  function getFashionStateExt() {
    const s = getFashionState();
    if (!s) return null;
    for (const k of ["styleProfiles", "challenges", "capsules"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    if (!Array.isArray(s.communityPosts)) s.communityPosts = [];
    return s;
  }

  // ── [M] Auto background-removal on item photos ──────────────────────
  // Calls the keyless rembg-style processor at remove.bg-compatible
  // endpoint when configured; otherwise records the request so the UI
  // can fall back to a CSS flat-lay mask. No fabricated image data.
  registerLensAction("fashion", "item-remove-bg", async (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const item = findItem(s, userId, params.id);
    if (!item) return { ok: false, error: "item not found" };
    const sourceUrl = fsClean(params.imageUrl || item.photo, 500);
    if (!sourceUrl) return { ok: false, error: "item has no photo to process" };
    const apiKey = process.env.REMOVEBG_API_KEY;
    if (!apiKey) {
      // No external key — flag the photo for a client-side CSS flat-lay
      // mask so the UI still gets Whering's flat-lay look without faking
      // a processed image.
      item.bgRemoved = false;
      item.bgRemovalMode = "css-mask";
      item.photo = sourceUrl;
      saveFashionState();
      return {
        ok: true,
        result: {
          item: itemView(item), processed: false, mode: "css-mask",
          note: "Set REMOVEBG_API_KEY for true cutout; UI applies a flat-lay mask meanwhile.",
        },
      };
    }
    try {
      const r = await fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: sourceUrl, size: "auto", format: "png" }),
      });
      if (!r.ok) return { ok: false, error: `remove.bg ${r.status}` };
      const buf = Buffer.from(await r.arrayBuffer());
      const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      item.photo = dataUrl;
      item.bgRemoved = true;
      item.bgRemovalMode = "removebg";
      saveFashionState();
      return { ok: true, result: { item: itemView(item), processed: true, mode: "removebg" } };
    } catch (e) {
      return { ok: false, error: `remove.bg unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── [S] Calendar weather integration ────────────────────────────────
  // Pulls real current + daily forecast from Open-Meteo (free, keyless).
  function weatherKindFromCode(code) {
    if (code === 0) return "clear";
    if (code <= 3) return "cloudy";
    if (code >= 45 && code <= 48) return "fog";
    if (code >= 51 && code <= 67) return "rain";
    if (code >= 71 && code <= 77) return "snow";
    if (code >= 80 && code <= 82) return "rain";
    if (code >= 85 && code <= 86) return "snow";
    if (code >= 95) return "storm";
    return "cloudy";
  }
  registerLensAction("fashion", "weather-forecast", async (ctx, _a, params = {}) => {
    const lat = Number(params.lat);
    const lon = Number(params.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, error: "lat and lon required" };
    }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code,precipitation&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=celsius&forecast_days=7&timezone=auto`;
      const data = await cachedFetchJson(url, { ttlMs: 30 * 60 * 1000 });
      const cur = data?.current || {};
      const d = data?.daily || {};
      const days = (d.time || []).map((date, i) => ({
        date,
        tempMax: d.temperature_2m_max?.[i] ?? null,
        tempMin: d.temperature_2m_min?.[i] ?? null,
        kind: weatherKindFromCode(d.weather_code?.[i]),
        precipChance: d.precipitation_probability_max?.[i] ?? null,
      }));
      return {
        ok: true,
        result: {
          current: {
            temp: cur.temperature_2m ?? null,
            kind: weatherKindFromCode(cur.weather_code),
            precipitation: cur.precipitation ?? null,
          },
          days,
          source: "open-meteo",
        },
      };
    } catch (e) {
      return { ok: false, error: `open-meteo unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── [M] AI outfit generation by weather / occasion ──────────────────
  // Scores the user's real wardrobe against a weather profile + occasion
  // and assembles complete head-to-toe looks. Pure computation over the
  // user's own items — nothing fabricated.
  function weatherWarmthBand(temp) {
    if (temp == null) return "mild";
    if (temp <= 4) return "cold";
    if (temp <= 14) return "cool";
    if (temp <= 24) return "mild";
    return "warm";
  }
  const SEASON_FOR_BAND = { cold: "winter", cool: "fall", mild: "spring", warm: "summer" };
  const OCCASION_CATEGORY_BOOST = {
    formal: { dress: 3, top: 1, bottom: 1, shoes: 2, outerwear: 1, accessory: 1 },
    work: { top: 2, bottom: 2, shoes: 2, outerwear: 1, dress: 1, accessory: 1 },
    casual: { top: 2, bottom: 2, shoes: 1, accessory: 1, activewear: 1, dress: 1, outerwear: 1 },
    workout: { activewear: 4, shoes: 2, top: 1, bottom: 1 },
    date: { dress: 3, top: 2, bottom: 1, shoes: 2, accessory: 2, outerwear: 1 },
    travel: { top: 2, bottom: 2, shoes: 2, outerwear: 2, accessory: 1 },
  };
  registerLensAction("fashion", "ai-outfit-generate", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const items = (s.items.get(userId) || []).filter((i) => !i.archived);
    if (items.length === 0) {
      return { ok: true, result: { outfits: [], note: "Add wardrobe items to generate outfits." } };
    }
    const occasion = fsClean(params.occasion, 30).toLowerCase() || "casual";
    const temp = params.temp != null && Number.isFinite(Number(params.temp)) ? Number(params.temp) : null;
    const weatherKind = fsClean(params.weatherKind, 20).toLowerCase() || "clear";
    const band = weatherWarmthBand(temp);
    const targetSeason = SEASON_FOR_BAND[band] || "spring";
    const boost = OCCASION_CATEGORY_BOOST[occasion] || OCCASION_CATEGORY_BOOST.casual;
    const styleProfile = s.styleProfiles.get(userId) || null;
    const preferredColors = new Set((styleProfile?.colors || []).map((c) => String(c).toLowerCase()));

    function scoreItem(it) {
      let score = (boost[it.category] || 0.5);
      if (it.season === targetSeason || it.season === "all") score += 1.5;
      else score -= 1;
      if (preferredColors.size && it.color && preferredColors.has(it.color)) score += 1.2;
      // Reward under-worn pieces to keep rotation fresh.
      score += Math.max(0, 1.5 - it.timesWorn * 0.15);
      return score;
    }
    const ranked = items.map((it) => ({ it, score: scoreItem(it) }))
      .sort((a, b) => b.score - a.score);
    const byCat = (cat) => ranked.filter((r) => r.it.category === cat).map((r) => r.it);

    const outfits = [];
    const wantOuter = band === "cold" || band === "cool" || weatherKind === "rain" || weatherKind === "snow";
    const dresses = byCat("dress");
    const tops = byCat("top");
    const bottoms = byCat("bottom");
    const shoes = byCat("shoes");
    const outer = byCat("outerwear");
    const accessories = byCat("accessory");
    const activewear = byCat("activewear");
    const maxLooks = Math.max(1, Math.min(5, Math.round(Number(params.count) || 3)));

    for (let i = 0; i < maxLooks; i++) {
      const pieces = [];
      if (occasion === "workout" && activewear.length) {
        const aw = activewear[i % activewear.length];
        if (aw) pieces.push(aw);
        const aw2 = activewear[(i + 1) % activewear.length];
        if (aw2 && aw2 !== aw) pieces.push(aw2);
      } else if (dresses.length && (occasion === "formal" || occasion === "date" || i % 2 === 0)) {
        pieces.push(dresses[i % dresses.length]);
      } else {
        if (tops.length) pieces.push(tops[i % tops.length]);
        if (bottoms.length) pieces.push(bottoms[i % bottoms.length]);
      }
      if (shoes.length) pieces.push(shoes[i % shoes.length]);
      if (wantOuter && outer.length) pieces.push(outer[i % outer.length]);
      if (accessories.length && (occasion === "formal" || occasion === "date")) {
        pieces.push(accessories[i % accessories.length]);
      }
      const uniq = [...new Map(pieces.filter(Boolean).map((p) => [p.id, p])).values()];
      if (uniq.length < 2) continue;
      const totalCost = Math.round(uniq.reduce((a, p) => a + fsNum(p.cost), 0) * 100) / 100;
      outfits.push({
        rank: i + 1,
        itemIds: uniq.map((p) => p.id),
        items: uniq.map((p) => ({ id: p.id, name: p.name, category: p.category, color: p.color })),
        totalCost,
        rationale: `${band} weather${weatherKind !== "clear" ? ` (${weatherKind})` : ""} · ${occasion} · season-matched to ${targetSeason}`,
      });
    }
    return {
      ok: true,
      result: {
        occasion, weatherBand: band, weatherKind, targetSeason,
        outfits,
        wardrobeSize: items.length,
        note: outfits.length === 0 ? "Not enough variety — add more categories." : undefined,
      },
    };
  });

  // ── [M] Style profile quiz → personalized recommendations ───────────
  const STYLE_QUIZ = [
    { id: "vibe", question: "Which best describes your everyday vibe?",
      options: [
        { value: "minimal", label: "Clean & minimal" },
        { value: "classic", label: "Timeless & classic" },
        { value: "trendy", label: "Trend-forward" },
        { value: "bold", label: "Bold & expressive" },
        { value: "cozy", label: "Relaxed & cozy" },
      ] },
    { id: "palette", question: "Your go-to colour palette?",
      options: [
        { value: "neutral", label: "Neutrals (black, beige, grey)" },
        { value: "earthy", label: "Earth tones" },
        { value: "bright", label: "Bright & saturated" },
        { value: "pastel", label: "Soft pastels" },
        { value: "mono", label: "Monochrome" },
      ] },
    { id: "fit", question: "Preferred silhouette?",
      options: [
        { value: "fitted", label: "Tailored & fitted" },
        { value: "relaxed", label: "Loose & relaxed" },
        { value: "structured", label: "Structured" },
        { value: "flowy", label: "Soft & flowy" },
      ] },
    { id: "spend", question: "How do you shop?",
      options: [
        { value: "investment", label: "Few investment pieces" },
        { value: "balanced", label: "A balanced mix" },
        { value: "frequent", label: "Frequent affordable buys" },
        { value: "thrift", label: "Mostly secondhand / thrift" },
      ] },
    { id: "priority", question: "What matters most in your wardrobe?",
      options: [
        { value: "versatility", label: "Versatility" },
        { value: "comfort", label: "Comfort" },
        { value: "statement", label: "Making a statement" },
        { value: "sustainability", label: "Sustainability" },
      ] },
  ];
  const PALETTE_COLORS = {
    neutral: ["black", "white", "beige", "grey", "navy"],
    earthy: ["olive", "brown", "rust", "cream", "khaki"],
    bright: ["red", "cobalt", "yellow", "emerald", "magenta"],
    pastel: ["blush", "lavender", "mint", "powder blue", "butter"],
    mono: ["black", "charcoal", "white", "grey"],
  };
  registerLensAction("fashion", "style-quiz-questions", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { questions: STYLE_QUIZ } };
  });
  registerLensAction("fashion", "style-quiz-submit", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const answers = params.answers && typeof params.answers === "object" ? params.answers : {};
    const required = STYLE_QUIZ.map((q) => q.id);
    const missing = required.filter((q) => !answers[q]);
    if (missing.length) return { ok: false, error: `unanswered: ${missing.join(", ")}` };
    for (const q of STYLE_QUIZ) {
      const valid = q.options.map((o) => o.value);
      if (!valid.includes(String(answers[q.id]))) {
        return { ok: false, error: `invalid answer for ${q.id}` };
      }
    }
    const style = String(answers.vibe);
    const palette = String(answers.palette);
    const colors = PALETTE_COLORS[palette] || [];
    const profile = {
      style,
      palette,
      colors,
      fit: String(answers.fit),
      spend: String(answers.spend),
      priority: String(answers.priority),
      answers,
      updatedAt: fsNow(),
    };
    s.styleProfiles.set(userId, profile);

    // Personalised recommendations from the user's real closet gaps.
    const items = (s.items.get(userId) || []).filter((i) => !i.archived);
    const catCount = {};
    for (const it of items) catCount[it.category] = (catCount[it.category] || 0) + 1;
    const coreCats = ["top", "bottom", "shoes", "outerwear"];
    const recommendations = [];
    for (const c of coreCats) {
      if ((catCount[c] || 0) === 0) {
        recommendations.push({ type: "gap", category: c, reason: `No ${c} in your closet yet — a core ${style} wardrobe needs one.` });
      } else if ((catCount[c] || 0) < 2) {
        recommendations.push({ type: "thin", category: c, reason: `Only ${catCount[c]} ${c} — add variety for more outfits.` });
      }
    }
    const offPalette = items.filter((it) => it.color && colors.length && !colors.includes(it.color));
    if (offPalette.length && colors.length) {
      recommendations.push({
        type: "palette",
        reason: `${offPalette.length} item(s) sit outside your ${palette} palette — consider rehoming or styling around them.`,
      });
    }
    if (answers.priority === "sustainability" || answers.spend === "thrift") {
      const lowWear = items.filter((it) => it.timesWorn === 0);
      if (lowWear.length) {
        recommendations.push({ type: "sustainability", reason: `Wear or rehome ${lowWear.length} never-worn item(s) before buying new.` });
      }
    }
    saveFashionState();
    return { ok: true, result: { profile, recommendations } };
  });
  registerLensAction("fashion", "style-profile-get", (ctx, _a, _params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const profile = s.styleProfiles.get(fsAid(ctx)) || null;
    return { ok: true, result: { profile } };
  });

  // ── [S] Resale / declutter flagging + marketplace listing handoff ───
  registerLensAction("fashion", "declutter-suggestions", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const items = (s.items.get(userId) || []).filter((i) => !i.archived);
    const monthsUnworn = Math.max(1, Math.round(Number(params.monthsUnworn) || 6));
    const cutoff = new Date(Date.now() - monthsUnworn * 30 * 86400000).toISOString().slice(0, 10);
    const flagged = [];
    for (const it of items) {
      const reasons = [];
      if (it.timesWorn === 0) reasons.push("never worn");
      else if (it.lastWorn && it.lastWorn < cutoff) reasons.push(`not worn since ${it.lastWorn}`);
      const cpw = it.timesWorn > 0 ? it.cost / it.timesWorn : null;
      if (cpw != null && cpw >= 30) reasons.push("poor cost-per-wear");
      if (reasons.length === 0) continue;
      // Suggested resale value: depreciate by wear, floor at 15% of cost.
      const depreciation = Math.min(0.85, 0.15 + it.timesWorn * 0.05);
      const resaleEstimate = Math.round(Math.max(it.cost * 0.15, it.cost * (1 - depreciation)) * 100) / 100;
      flagged.push({
        id: it.id, name: it.name, category: it.category, brand: it.brand,
        cost: it.cost, timesWorn: it.timesWorn,
        reasons, resaleEstimate, listed: !!it.resaleListed,
      });
    }
    flagged.sort((a, b) => b.resaleEstimate - a.resaleEstimate);
    return {
      ok: true,
      result: {
        flagged, count: flagged.length,
        potentialResale: Math.round(flagged.reduce((a, f) => a + f.resaleEstimate, 0) * 100) / 100,
      },
    };
  });
  registerLensAction("fashion", "resale-list-item", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const item = findItem(s, userId, params.id);
    if (!item) return { ok: false, error: "item not found" };
    const askingPrice = Math.max(0, fsNum(params.askingPrice));
    if (askingPrice <= 0) return { ok: false, error: "askingPrice required" };
    const channel = ["depop", "vinted", "poshmark", "ebay", "local"]
      .includes(String(params.channel).toLowerCase()) ? String(params.channel).toLowerCase() : "depop";
    item.resaleListed = true;
    item.resaleListing = {
      askingPrice, channel,
      condition: fsClean(params.condition, 20) || "good",
      note: fsClean(params.note, 300) || null,
      listedAt: fsNow(),
    };
    item.condition = "donate"; // declutter intent — pulled from active rotation
    saveFashionState();
    return { ok: true, result: { item: itemView(item), listing: item.resaleListing } };
  });
  registerLensAction("fashion", "resale-unlist-item", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = findItem(s, fsAid(ctx), params.id);
    if (!item) return { ok: false, error: "item not found" };
    item.resaleListed = false;
    item.resaleListing = null;
    saveFashionState();
    return { ok: true, result: { item: itemView(item) } };
  });
  registerLensAction("fashion", "resale-listings", (ctx, _a, _params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = (s.items.get(fsAid(ctx)) || []).filter((i) => i.resaleListed && i.resaleListing);
    return {
      ok: true,
      result: {
        listings: items.map((i) => ({ id: i.id, name: i.name, category: i.category, ...i.resaleListing })),
        count: items.length,
        totalAsking: Math.round(items.reduce((a, i) => a + (i.resaleListing?.askingPrice || 0), 0) * 100) / 100,
      },
    };
  });

  // ── [M] Outfit social feed — likes / saves / community lookbooks ─────
  function communityPostView(p, userId) {
    return {
      id: p.id, ownerId: p.ownerId,
      ownerLabel: p.ownerId === userId ? "You" : `Stylist ${String(p.ownerId).slice(-4)}`,
      caption: p.caption, occasion: p.occasion, season: p.season,
      itemNames: p.itemNames, photo: p.photo,
      likes: p.likedBy.length, saves: p.savedBy.length,
      likedByMe: p.likedBy.includes(userId),
      savedByMe: p.savedBy.includes(userId),
      mine: p.ownerId === userId,
      createdAt: p.createdAt,
    };
  }
  registerLensAction("fashion", "social-share-outfit", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const outfit = findOutfit(s, userId, params.outfitId);
    if (!outfit) return { ok: false, error: "outfit not found" };
    const itemName = new Map((s.items.get(userId) || []).map((i) => [i.id, i.name]));
    const post = {
      id: fsId("fp"), ownerId: userId, outfitId: outfit.id,
      caption: fsClean(params.caption, 280) || outfit.name,
      occasion: outfit.occasion, season: outfit.season,
      itemNames: outfit.itemIds.map((id) => itemName.get(id)).filter(Boolean),
      photo: fsClean(params.photo, 500) || null,
      likedBy: [], savedBy: [], createdAt: fsNow(),
    };
    s.communityPosts.unshift(post);
    if (s.communityPosts.length > 2000) s.communityPosts.length = 2000;
    saveFashionState();
    return { ok: true, result: { post: communityPostView(post, userId) } };
  });
  registerLensAction("fashion", "social-feed", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    let posts = [...s.communityPosts];
    const sort = String(params.sort || "recent").toLowerCase();
    if (params.mine === true) posts = posts.filter((p) => p.ownerId === userId);
    if (params.savedOnly === true) posts = posts.filter((p) => p.savedBy.includes(userId));
    if (params.occasion) posts = posts.filter((p) => p.occasion === String(params.occasion).toLowerCase());
    if (sort === "popular") posts.sort((a, b) => (b.likedBy.length + b.savedBy.length) - (a.likedBy.length + a.savedBy.length));
    else posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = Math.max(1, Math.min(60, Math.round(Number(params.limit) || 30)));
    return {
      ok: true,
      result: { posts: posts.slice(0, limit).map((p) => communityPostView(p, userId)), count: posts.length },
    };
  });
  registerLensAction("fashion", "social-like", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const post = s.communityPosts.find((p) => p.id === params.id);
    if (!post) return { ok: false, error: "post not found" };
    const i = post.likedBy.indexOf(userId);
    if (i >= 0) post.likedBy.splice(i, 1); else post.likedBy.push(userId);
    saveFashionState();
    return { ok: true, result: { post: communityPostView(post, userId) } };
  });
  registerLensAction("fashion", "social-save", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const post = s.communityPosts.find((p) => p.id === params.id);
    if (!post) return { ok: false, error: "post not found" };
    const i = post.savedBy.indexOf(userId);
    if (i >= 0) post.savedBy.splice(i, 1); else post.savedBy.push(userId);
    saveFashionState();
    return { ok: true, result: { post: communityPostView(post, userId) } };
  });
  registerLensAction("fashion", "social-delete", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const i = s.communityPosts.findIndex((p) => p.id === params.id && p.ownerId === userId);
    if (i < 0) return { ok: false, error: "post not found or not yours" };
    s.communityPosts.splice(i, 1);
    saveFashionState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── [S] Capsule-wardrobe planner + #30wears challenge tracking ──────
  registerLensAction("fashion", "capsule-create", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const name = fsClean(params.name, 120);
    if (!name) return { ok: false, error: "capsule name required" };
    const targetSize = Math.max(5, Math.min(60, Math.round(Number(params.targetSize) || 33)));
    const itemIds = Array.isArray(params.itemIds)
      ? params.itemIds.map(String).filter((id) => findItem(s, userId, id)) : [];
    const capsule = {
      id: fsId("cap"), name,
      season: ["spring", "summer", "fall", "winter", "all"].includes(String(params.season).toLowerCase())
        ? String(params.season).toLowerCase() : "all",
      targetSize, itemIds, createdAt: fsNow(),
    };
    fsListB(s.capsules, userId).push(capsule);
    saveFashionState();
    return { ok: true, result: { capsule } };
  });
  registerLensAction("fashion", "capsule-list", (ctx, _a, _params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const itemName = new Map((s.items.get(userId) || []).map((i) => [i.id, i.name]));
    const capsules = (s.capsules.get(userId) || []).map((c) => ({
      ...c,
      itemNames: c.itemIds.map((id) => itemName.get(id)).filter(Boolean),
      filled: c.itemIds.length,
      pctFilled: Math.round((c.itemIds.length / c.targetSize) * 100),
    }));
    return { ok: true, result: { capsules, count: capsules.length } };
  });
  registerLensAction("fashion", "capsule-toggle-item", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const capsule = (s.capsules.get(userId) || []).find((c) => c.id === params.capsuleId);
    if (!capsule) return { ok: false, error: "capsule not found" };
    if (!findItem(s, userId, params.itemId)) return { ok: false, error: "item not found" };
    const i = capsule.itemIds.indexOf(String(params.itemId));
    if (i >= 0) capsule.itemIds.splice(i, 1);
    else if (capsule.itemIds.length >= capsule.targetSize) {
      return { ok: false, error: `capsule full (${capsule.targetSize} items)` };
    } else capsule.itemIds.push(String(params.itemId));
    saveFashionState();
    return { ok: true, result: { capsule, filled: capsule.itemIds.length } };
  });
  registerLensAction("fashion", "capsule-delete", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.capsules.get(fsAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "capsule not found" };
    arr.splice(i, 1);
    saveFashionState();
    return { ok: true, result: { deleted: params.id } };
  });
  // #30wears challenge — tracks each enrolled item's progress to the
  // 30-wears sustainability pledge. Progress reads the real timesWorn.
  registerLensAction("fashion", "challenge-enroll", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const item = findItem(s, userId, params.itemId);
    if (!item) return { ok: false, error: "item not found" };
    const target = Math.max(1, Math.min(365, Math.round(Number(params.target) || 30)));
    const list = fsListB(s.challenges, userId);
    if (list.some((c) => c.itemId === item.id)) return { ok: false, error: "item already enrolled" };
    const entry = {
      id: fsId("ch"), itemId: item.id, target,
      startWears: item.timesWorn, startedAt: fsNow(),
    };
    list.push(entry);
    saveFashionState();
    return { ok: true, result: { challenge: entry } };
  });
  registerLensAction("fashion", "challenge-unenroll", (ctx, _a, params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.challenges.get(fsAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "challenge not found" };
    arr.splice(i, 1);
    saveFashionState();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("fashion", "challenge-list", (ctx, _a, _params = {}) => {
    const s = getFashionStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fsAid(ctx);
    const list = (s.challenges.get(userId) || []).map((c) => {
      const item = findItem(s, userId, c.itemId);
      const wears = item ? item.timesWorn : c.startWears;
      const progress = Math.min(c.target, wears);
      return {
        id: c.id, itemId: c.itemId,
        itemName: item ? item.name : "(removed)",
        category: item ? item.category : null,
        target: c.target, wears, progress,
        pct: Math.round((progress / c.target) * 100),
        complete: progress >= c.target,
        startedAt: c.startedAt,
      };
    });
    const complete = list.filter((c) => c.complete).length;
    return {
      ok: true,
      result: { challenges: list, count: list.length, completed: complete },
    };
  });

  // feed — ingest real fashion / costume pieces from The Metropolitan
  // Museum of Art Open Access collection as visible DTUs. Free, no key.
  registerLensAction("fashion", "feed", async (ctx, _a, params = {}) => {
    const s = getFashionState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(15, Math.round(Number(params.limit) || 8)));
    const queries = ["dress", "gown", "coat", "hat", "shoes", "textile"];
    const q = queries[new Date().getHours() % queries.length];
    try {
      const sr = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${q}&hasImages=true`);
      if (!sr.ok) return { ok: false, error: `metmuseum ${sr.status}` };
      const sdata = await sr.json();
      const ids = (Array.isArray(sdata?.objectIDs) ? sdata.objectIDs : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const oid of ids) {
        const id = `met_${oid}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const or = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${oid}`);
        if (!or.ok) continue;
        const o = await or.json();
        const title = `Fashion piece: ${o.title || "Untitled"}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nArtist/Maker: ${o.artistDisplayName || "Unknown"}\nDate: ${o.objectDate || "?"}\nMedium: ${o.medium || "?"}\nDepartment: ${o.department || "?"}\nCulture: ${o.culture || "?"}`,
          tags: ["fashion", "feed", "costume", "metmuseum"],
          source: "metmuseum-feed",
          meta: { objectId: oid, title: o.title, medium: o.medium, imageUrl: o.primaryImageSmall || null },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveFashionState();
      return { ok: true, result: { ingested, skipped, source: "metmuseum-fashion", dtuIds } };
    } catch (e) {
      return { ok: false, error: `metmuseum unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
