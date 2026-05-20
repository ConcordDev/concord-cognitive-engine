// server/domains/fashion.js
import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

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
}
