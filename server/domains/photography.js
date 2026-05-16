// server/domains/photography.js
//
// Pure-compute photography helpers (exposure calc, composition score,
// gear recommendation, print size, vision via LLaVA) plus real Pexels
// stock photo search (free with API key from pexels.com/api).

import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

const PEXELS_BASE = "https://api.pexels.com/v1";

export default function registerPhotographyActions(registerLensAction) {
  registerLensAction("photography", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("photography");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  registerLensAction("photography", "exposureCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const iso = parseInt(data.iso) || 100; const aperture = parseFloat(data.aperture) || 5.6; const ev = parseFloat(data.ev) || 12; const shutterSpeed = 1 / (Math.pow(2, ev) * Math.pow(aperture, 2) / (iso * 0.297)); const readable = shutterSpeed >= 1 ? `${Math.round(shutterSpeed)}s` : `1/${Math.round(1/shutterSpeed)}s`; return { ok: true, result: { iso, aperture: `f/${aperture}`, ev, shutterSpeed: readable, depthOfField: aperture <= 2.8 ? "shallow" : aperture <= 8 ? "moderate" : "deep", motionBlur: shutterSpeed > 0.033 ? "likely" : "frozen", handheld: shutterSpeed < 1/(aperture*2) ? "ok" : "use-tripod" } }; });
  registerLensAction("photography", "compositionAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; const rules = ["rule-of-thirds","leading-lines","symmetry","framing","depth","negative-space","golden-ratio","patterns"]; const applied = (data.compositionRules || []).filter(r => rules.includes(r.toLowerCase())); return { ok: true, result: { rulesApplied: applied, score: Math.round((applied.length / rules.length) * 100), allRules: rules, suggestions: rules.filter(r => !applied.includes(r)).slice(0,3), strength: applied.length >= 3 ? "strong-composition" : applied.length >= 1 ? "basic-composition" : "no-rules-applied" } }; });
  registerLensAction("photography", "gearRecommend", (ctx, artifact, _params) => { const data = artifact.data || {}; const genre = (data.genre || data.style || "general").toLowerCase(); const budget = (data.budget || "medium").toLowerCase(); const recs = { portrait: { lens: "85mm f/1.8", lighting: "Softbox or natural window light", accessory: "Reflector" }, landscape: { lens: "16-35mm f/4", lighting: "Golden hour", accessory: "Tripod + filters" }, street: { lens: "35mm f/2", lighting: "Available light", accessory: "Small bag" }, macro: { lens: "100mm f/2.8 Macro", lighting: "Ring light", accessory: "Focus rail" }, sports: { lens: "70-200mm f/2.8", lighting: "High ISO capability", accessory: "Monopod" }, general: { lens: "24-70mm f/2.8", lighting: "Speedlight", accessory: "Camera bag" } }; const rec = recs[genre] || recs.general; return { ok: true, result: { genre, budget, recommendation: rec, tip: genre === "portrait" ? "Shoot wide open for creamy bokeh" : genre === "landscape" ? "Use f/8-f/11 for maximum sharpness" : "Practice with what you have" } }; });
  registerLensAction("photography", "printSize", (ctx, artifact, _params) => { const data = artifact.data || {}; const widthPx = parseInt(data.widthPixels) || 4000; const heightPx = parseInt(data.heightPixels) || 3000; const dpi = parseInt(data.dpi) || 300; const widthIn = Math.round(widthPx / dpi * 10) / 10; const heightIn = Math.round(heightPx / dpi * 10) / 10; const megapixels = Math.round(widthPx * heightPx / 1000000 * 10) / 10; const maxPrint = { at300dpi: `${widthIn}" x ${heightIn}"`, at150dpi: `${Math.round(widthPx/150*10)/10}" x ${Math.round(heightPx/150*10)/10}"` }; return { ok: true, result: { resolution: `${widthPx} x ${heightPx}`, megapixels, maxPrintAt300DPI: maxPrint.at300dpi, maxPrintAt150DPI: maxPrint.at150dpi, quality: widthPx >= 4000 ? "professional" : widthPx >= 2000 ? "good" : "web-only" } }; });

  /**
   * pexels-search — Real Pexels stock photo search. Requires
   * PEXELS_API_KEY env (free at pexels.com/api).
   * params: { query, perPage?: 1-80, orientation?: "landscape"|"portrait"|"square" }
   */
  registerLensAction("photography", "pexels-search", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return { ok: false, error: "PEXELS_API_KEY env required (free at pexels.com/api)" };
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const perPage = Math.max(1, Math.min(80, Number(params.perPage) || 15));
    const orientation = ["landscape", "portrait", "square"].includes(params.orientation) ? `&orientation=${params.orientation}` : "";
    try {
      const r = await fetch(`${PEXELS_BASE}/search?query=${encodeURIComponent(query)}&per_page=${perPage}${orientation}`, {
        headers: { Authorization: apiKey },
      });
      if (r.status === 401) return { ok: false, error: "PEXELS_API_KEY invalid" };
      if (!r.ok) throw new Error(`pexels ${r.status}`);
      const data = await r.json();
      const photos = (data.photos || []).map((p) => ({
        id: p.id,
        photographer: p.photographer,
        photographerUrl: p.photographer_url,
        width: p.width,
        height: p.height,
        avgColor: p.avg_color,
        originalUrl: p.src?.original,
        largeUrl: p.src?.large,
        mediumUrl: p.src?.medium,
        smallUrl: p.src?.small,
        portraitUrl: p.src?.portrait,
        landscapeUrl: p.src?.landscape,
        tinyUrl: p.src?.tiny,
        pexelsUrl: p.url,
        alt: p.alt,
      }));
      return {
        ok: true,
        result: {
          query, photos, count: photos.length,
          totalResults: data.total_results,
          nextPage: data.next_page,
          source: "pexels",
        },
      };
    } catch (e) {
      return { ok: false, error: `pexels unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
