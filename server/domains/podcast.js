// server/domains/podcast.js
//
// Pure-compute podcast helpers (episode analytics, guest research,
// production checklist, monetization calc) plus real iTunes Search
// API for the Apple Podcasts directory. Free, no API key.

const ITUNES_SEARCH = "https://itunes.apple.com/search";
const ITUNES_LOOKUP = "https://itunes.apple.com/lookup";

export default function registerPodcastActions(registerLensAction) {
  registerLensAction("podcast", "episodeAnalytics", (ctx, artifact, _params) => { const episodes = artifact.data?.episodes || []; if (episodes.length === 0) return { ok: true, result: { message: "Add episodes with listen counts to analyze." } }; const totalListens = episodes.reduce((s,e) => s + (parseInt(e.listens || e.plays) || 0), 0); const avgListens = Math.round(totalListens / episodes.length); const totalDuration = episodes.reduce((s,e) => s + (parseInt(e.durationMinutes || e.duration) || 30), 0); const completionRate = episodes.reduce((s,e) => s + (parseFloat(e.completionRate) || 0.65), 0) / episodes.length; return { ok: true, result: { episodes: episodes.length, totalListens, avgListensPerEpisode: avgListens, totalDurationMinutes: totalDuration, avgDurationMinutes: Math.round(totalDuration / episodes.length), completionRate: Math.round(completionRate * 100), topEpisode: episodes.sort((a,b) => (parseInt(b.listens || b.plays) || 0) - (parseInt(a.listens || a.plays) || 0))[0]?.title || "N/A", growth: episodes.length > 5 ? "established" : "growing" } }; });
  registerLensAction("podcast", "guestResearch", (ctx, artifact, _params) => { const guest = artifact.data || {}; const topics = guest.topics || guest.expertise || []; const platforms = guest.platforms || []; return { ok: true, result: { name: guest.name || artifact.title, bio: guest.bio || "", topics, platforms, audienceOverlap: platforms.length > 0 ? "likely" : "unknown", questionSuggestions: topics.map(t => `Tell us about your experience with ${t}`), prepChecklist: ["Research guest background", "Prepare 5-7 questions", "Test audio setup", "Send guest prep sheet", "Confirm recording time"] } }; });
  registerLensAction("podcast", "productionChecklist", (ctx, artifact, _params) => { const data = artifact.data || {}; const preProduction = ["Topic research", "Outline/script", "Guest coordination", "Equipment check"]; const production = ["Audio recording", "Backup recording", "Room tone capture", "Marker/chapter points"]; const postProduction = ["Edit audio", "Add intro/outro", "Level audio", "Export final", "Write show notes", "Create artwork", "Publish to host", "Promote on social"]; const completed = data.completedSteps || []; const allSteps = [...preProduction, ...production, ...postProduction]; const done = allSteps.filter(s => completed.includes(s)).length; return { ok: true, result: { preProduction, production, postProduction, totalSteps: allSteps.length, completed: done, progress: Math.round((done / allSteps.length) * 100), nextStep: allSteps.find(s => !completed.includes(s)) || "All done!" } }; });
  registerLensAction("podcast", "monetizationCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const downloads = parseInt(data.monthlyDownloads) || 0; const cpm = parseFloat(data.cpmRate) || 25; const sponsors = parseInt(data.sponsorSlots) || 2; const premium = parseInt(data.premiumSubscribers) || 0; const premiumPrice = parseFloat(data.premiumPrice) || 5; const adRevenue = Math.round(downloads / 1000 * cpm * sponsors); const premiumRevenue = premium * premiumPrice; return { ok: true, result: { monthlyDownloads: downloads, adRevenue, premiumRevenue, totalMonthlyRevenue: adRevenue + premiumRevenue, annualProjection: (adRevenue + premiumRevenue) * 12, cpmRate: cpm, tier: downloads > 50000 ? "top-10%" : downloads > 10000 ? "established" : downloads > 1000 ? "growing" : "emerging", nextMilestone: downloads < 1000 ? "1,000 downloads — attracts first sponsors" : downloads < 10000 ? "10,000 downloads — mid-tier sponsorships" : "50,000+ — premium sponsorship rates" } }; });

  /**
   * itunes-search — Apple Podcasts directory search via iTunes Search API.
   * Free, no API key. Returns top podcasts matching the query with
   * artwork, RSS feed URL, genre, episode count.
   * params: { query: string, limit?: 1-50, country?: ISO-2 (default US) }
   */
  registerLensAction("podcast", "itunes-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    const country = String(params.country || "US").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return { ok: false, error: "country must be 2-letter code" };
    try {
      const url = `${ITUNES_SEARCH}?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=${limit}&country=${country}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`itunes ${r.status}`);
      const data = await r.json();
      const podcasts = (data.results || []).map((p) => ({
        collectionId: p.collectionId,
        trackId: p.trackId,
        title: p.collectionName || p.trackName,
        artist: p.artistName,
        genre: p.primaryGenreName,
        genres: p.genres,
        artwork: p.artworkUrl600 || p.artworkUrl100 || p.artworkUrl60,
        feedUrl: p.feedUrl,
        episodeCount: p.trackCount,
        country: p.country,
        contentAdvisory: p.contentAdvisoryRating,
        releaseDate: p.releaseDate,
        collectionUrl: p.collectionViewUrl,
      }));
      return {
        ok: true,
        result: { query, podcasts, count: podcasts.length, totalResults: data.resultCount, source: "itunes-search" },
      };
    } catch (e) {
      return { ok: false, error: `itunes unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * itunes-podcast — Lookup a specific podcast by its iTunes
   * collectionId (returned by itunes-search). Returns full metadata.
   */
  registerLensAction("podcast", "itunes-podcast", async (_ctx, _artifact, params = {}) => {
    const collectionId = Number(params.collectionId);
    if (!Number.isFinite(collectionId) || collectionId <= 0) return { ok: false, error: "collectionId required" };
    try {
      const r = await fetch(`${ITUNES_LOOKUP}?id=${collectionId}&entity=podcast`);
      if (!r.ok) throw new Error(`itunes ${r.status}`);
      const data = await r.json();
      if (!data.results || data.results.length === 0) {
        return { ok: false, error: `podcast not found: ${collectionId}` };
      }
      const p = data.results[0];
      return {
        ok: true,
        result: {
          collectionId: p.collectionId,
          title: p.collectionName,
          artist: p.artistName,
          genre: p.primaryGenreName,
          genres: p.genres,
          artwork: p.artworkUrl600,
          feedUrl: p.feedUrl,
          episodeCount: p.trackCount,
          country: p.country,
          releaseDate: p.releaseDate,
          collectionUrl: p.collectionViewUrl,
          source: "itunes-lookup",
        },
      };
    } catch (e) {
      return { ok: false, error: `itunes unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
