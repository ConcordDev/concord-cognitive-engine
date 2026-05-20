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

  // ─── Spotify / Apple Podcasts 2026 parity — listening app ───────────
  // Shows + episodes (shared directory), subscriptions, playback
  // progress, up-next queue, downloads, playlists, ratings, stats.

  function getPodState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.podcastLens) STATE.podcastLens = {};
    const s = STATE.podcastLens;
    for (const k of [
      "shows", "episodes", "reviews", "subscriptions", "playback",
      "queue", "downloads", "playlists", "prefs",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function savePodState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const pcid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pcnow = () => new Date().toISOString();
  const pcaid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const pclistB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const pcnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pcclamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pcclean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const findEpisode = (s, episodeId) => {
    for (const list of s.episodes.values()) {
      const e = list.find((x) => x.id === episodeId);
      if (e) return e;
    }
    return null;
  };

  // ── Shows / subscriptions ───────────────────────────────────────────
  registerLensAction("podcast", "show-add", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = pcclean(params.title, 160);
    if (!title) return { ok: false, error: "show title required" };
    const show = {
      id: pcid("show"), title,
      author: pcclean(params.author, 120) || null,
      category: pcclean(params.category, 60).toLowerCase() || "general",
      description: pcclean(params.description, 1000) || null,
      feedUrl: pcclean(params.feedUrl, 400) || null,
      addedBy: pcaid(ctx), createdAt: pcnow(),
    };
    s.shows.set(show.id, show);
    s.episodes.set(show.id, []);
    savePodState();
    return { ok: true, result: { show } };
  });

  function showView(s, userId, show) {
    const subs = s.subscriptions.get(userId) || [];
    return {
      ...show,
      episodeCount: (s.episodes.get(show.id) || []).length,
      subscribed: subs.includes(show.id),
      reviewCount: (s.reviews.get(show.id) || []).length,
      rating: (() => {
        const rs = s.reviews.get(show.id) || [];
        return rs.length ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10 : 0;
      })(),
    };
  }

  registerLensAction("podcast", "show-list", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    let shows = [...s.shows.values()].map((sh) => showView(s, userId, sh));
    if (params.subscribed) shows = shows.filter((sh) => sh.subscribed);
    if (params.category) shows = shows.filter((sh) => sh.category === String(params.category).toLowerCase());
    return { ok: true, result: { shows, count: shows.length } };
  });

  registerLensAction("podcast", "show-detail", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const show = s.shows.get(String(params.id));
    if (!show) return { ok: false, error: "show not found" };
    return {
      ok: true,
      result: {
        show: showView(s, pcaid(ctx), show),
        reviews: (s.reviews.get(show.id) || []).slice().reverse(),
      },
    };
  });

  registerLensAction("podcast", "show-subscribe", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const show = s.shows.get(String(params.id));
    if (!show) return { ok: false, error: "show not found" };
    const userId = pcaid(ctx);
    const subs = pclistB(s.subscriptions, userId);
    const idx = subs.indexOf(show.id);
    const subscribed = idx < 0;
    if (subscribed) subs.push(show.id);
    else subs.splice(idx, 1);
    savePodState();
    return { ok: true, result: { showId: show.id, subscribed } };
  });

  registerLensAction("podcast", "show-delete", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const show = s.shows.get(String(params.id));
    if (!show) return { ok: false, error: "show not found" };
    if (show.addedBy !== pcaid(ctx)) return { ok: false, error: "only the contributor can remove this show" };
    s.shows.delete(show.id);
    s.episodes.delete(show.id);
    s.reviews.delete(show.id);
    savePodState();
    return { ok: true, result: { deleted: show.id } };
  });

  // ── Episodes ────────────────────────────────────────────────────────
  registerLensAction("podcast", "episode-add", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const show = s.shows.get(String(params.showId));
    if (!show) return { ok: false, error: "show not found" };
    const title = pcclean(params.title, 200);
    if (!title) return { ok: false, error: "episode title required" };
    const ep = {
      id: pcid("ep"), showId: show.id, showTitle: show.title, title,
      description: pcclean(params.description, 2000) || null,
      durationSec: Math.max(0, Math.round(pcnum(params.durationSec))),
      publishDate: pcclean(params.publishDate, 10) || pcclean(pcnow(), 10),
      episodeNumber: Math.max(0, Math.round(pcnum(params.episodeNumber))) || null,
      createdAt: pcnow(),
    };
    pclistB(s.episodes, show.id).push(ep);
    savePodState();
    return { ok: true, result: { episode: ep } };
  });

  function episodeView(s, userId, ep) {
    const prog = (s.playback.get(userId) || []).find((p) => p.episodeId === ep.id);
    const queue = s.queue.get(userId) || [];
    const dls = s.downloads.get(userId) || [];
    return {
      ...ep,
      positionSec: prog ? prog.positionSec : 0,
      played: prog ? prog.played : false,
      progressPct: prog && ep.durationSec > 0 ? Math.round((prog.positionSec / ep.durationSec) * 100) : 0,
      inQueue: queue.includes(ep.id),
      downloaded: dls.includes(ep.id),
    };
  }

  registerLensAction("podcast", "episode-list", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.shows.has(String(params.showId))) return { ok: false, error: "show not found" };
    const userId = pcaid(ctx);
    const episodes = (s.episodes.get(String(params.showId)) || [])
      .map((e) => episodeView(s, userId, e))
      .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)));
    return { ok: true, result: { episodes, count: episodes.length } };
  });

  registerLensAction("podcast", "episode-detail", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ep = findEpisode(s, String(params.id));
    if (!ep) return { ok: false, error: "episode not found" };
    return { ok: true, result: { episode: episodeView(s, pcaid(ctx), ep) } };
  });

  // ── Playback / progress ─────────────────────────────────────────────
  registerLensAction("podcast", "playback-update", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ep = findEpisode(s, String(params.episodeId));
    if (!ep) return { ok: false, error: "episode not found" };
    const userId = pcaid(ctx);
    const positionSec = pcclamp(Math.round(pcnum(params.positionSec)), 0, Math.max(0, ep.durationSec));
    const list = pclistB(s.playback, userId);
    let prog = list.find((p) => p.episodeId === ep.id);
    if (!prog) { prog = { episodeId: ep.id, positionSec: 0, played: false }; list.push(prog); }
    prog.positionSec = positionSec;
    if (ep.durationSec > 0 && positionSec >= ep.durationSec * 0.95) prog.played = true;
    prog.updatedAt = pcnow();
    savePodState();
    return { ok: true, result: { episodeId: ep.id, positionSec, played: prog.played } };
  });

  registerLensAction("podcast", "episode-mark-played", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ep = findEpisode(s, String(params.episodeId));
    if (!ep) return { ok: false, error: "episode not found" };
    const userId = pcaid(ctx);
    const list = pclistB(s.playback, userId);
    let prog = list.find((p) => p.episodeId === ep.id);
    if (!prog) { prog = { episodeId: ep.id, positionSec: 0, played: false }; list.push(prog); }
    prog.played = !(params.unplayed === true);
    if (prog.played) prog.positionSec = ep.durationSec;
    else prog.positionSec = 0;
    prog.updatedAt = pcnow();
    savePodState();
    return { ok: true, result: { episodeId: ep.id, played: prog.played } };
  });

  registerLensAction("podcast", "continue-listening", (ctx, _a, _params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const inProgress = (s.playback.get(userId) || [])
      .filter((p) => !p.played && p.positionSec > 0)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((p) => {
        const ep = findEpisode(s, p.episodeId);
        return ep ? episodeView(s, userId, ep) : null;
      })
      .filter(Boolean);
    return { ok: true, result: { episodes: inProgress, count: inProgress.length } };
  });

  registerLensAction("podcast", "playback-speed-set", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const speed = pcclamp(pcnum(params.speed, 1), 0.5, 3.5);
    const prefs = s.prefs.get(userId) || {};
    prefs.playbackSpeed = Math.round(speed * 20) / 20; // snap to 0.05
    s.prefs.set(userId, prefs);
    savePodState();
    return { ok: true, result: { playbackSpeed: prefs.playbackSpeed } };
  });

  // ── Up-next queue ───────────────────────────────────────────────────
  registerLensAction("podcast", "queue-add", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ep = findEpisode(s, String(params.episodeId));
    if (!ep) return { ok: false, error: "episode not found" };
    const q = pclistB(s.queue, pcaid(ctx));
    if (!q.includes(ep.id)) {
      if (params.next === true) q.unshift(ep.id);
      else q.push(ep.id);
    }
    savePodState();
    return { ok: true, result: { queueLength: q.length } };
  });

  registerLensAction("podcast", "queue-list", (ctx, _a, _params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const episodes = (s.queue.get(userId) || [])
      .map((id) => { const e = findEpisode(s, id); return e ? episodeView(s, userId, e) : null; })
      .filter(Boolean);
    return { ok: true, result: { episodes, count: episodes.length } };
  });

  registerLensAction("podcast", "queue-remove", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = s.queue.get(pcaid(ctx)) || [];
    const i = q.indexOf(String(params.episodeId));
    if (i < 0) return { ok: false, error: "episode not in queue" };
    q.splice(i, 1);
    savePodState();
    return { ok: true, result: { queueLength: q.length } };
  });

  registerLensAction("podcast", "queue-reorder", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = s.queue.get(pcaid(ctx)) || [];
    const i = q.indexOf(String(params.episodeId));
    if (i < 0) return { ok: false, error: "episode not in queue" };
    const dir = String(params.direction) === "down" ? 1 : -1;
    const j = pcclamp(i + dir, 0, q.length - 1);
    if (i !== j) { const [m] = q.splice(i, 1); q.splice(j, 0, m); }
    savePodState();
    return { ok: true, result: { queue: q } };
  });

  // ── Downloads ───────────────────────────────────────────────────────
  registerLensAction("podcast", "download-episode", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ep = findEpisode(s, String(params.episodeId));
    if (!ep) return { ok: false, error: "episode not found" };
    const dls = pclistB(s.downloads, pcaid(ctx));
    if (!dls.includes(ep.id)) dls.push(ep.id);
    savePodState();
    return { ok: true, result: { downloaded: dls.length } };
  });

  registerLensAction("podcast", "download-list", (ctx, _a, _params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const episodes = (s.downloads.get(userId) || [])
      .map((id) => { const e = findEpisode(s, id); return e ? episodeView(s, userId, e) : null; })
      .filter(Boolean);
    const totalSec = episodes.reduce((a, e) => a + e.durationSec, 0);
    return { ok: true, result: { episodes, count: episodes.length, totalSec } };
  });

  registerLensAction("podcast", "download-remove", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const dls = s.downloads.get(pcaid(ctx)) || [];
    const i = dls.indexOf(String(params.episodeId));
    if (i < 0) return { ok: false, error: "episode not downloaded" };
    dls.splice(i, 1);
    savePodState();
    return { ok: true, result: { downloaded: dls.length } };
  });

  // ── Playlists ───────────────────────────────────────────────────────
  registerLensAction("podcast", "playlist-create", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = pcclean(params.name, 120);
    if (!name) return { ok: false, error: "playlist name required" };
    const playlist = { id: pcid("pl"), name, episodeIds: [], createdAt: pcnow() };
    pclistB(s.playlists, pcaid(ctx)).push(playlist);
    savePodState();
    return { ok: true, result: { playlist } };
  });

  registerLensAction("podcast", "playlist-list", (ctx, _a, _params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const playlists = (s.playlists.get(pcaid(ctx)) || [])
      .map((p) => ({ ...p, episodeCount: p.episodeIds.length }));
    return { ok: true, result: { playlists, count: playlists.length } };
  });

  registerLensAction("podcast", "playlist-add-episode", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pl = (s.playlists.get(pcaid(ctx)) || []).find((p) => p.id === params.playlistId);
    if (!pl) return { ok: false, error: "playlist not found" };
    if (!findEpisode(s, String(params.episodeId))) return { ok: false, error: "episode not found" };
    if (params.remove === true) pl.episodeIds = pl.episodeIds.filter((x) => x !== params.episodeId);
    else if (!pl.episodeIds.includes(params.episodeId)) pl.episodeIds.push(String(params.episodeId));
    savePodState();
    return { ok: true, result: { playlistId: pl.id, episodeCount: pl.episodeIds.length } };
  });

  registerLensAction("podcast", "playlist-detail", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const pl = (s.playlists.get(userId) || []).find((p) => p.id === params.id);
    if (!pl) return { ok: false, error: "playlist not found" };
    const episodes = pl.episodeIds
      .map((id) => { const e = findEpisode(s, id); return e ? episodeView(s, userId, e) : null; })
      .filter(Boolean);
    return { ok: true, result: { playlist: pl, episodes } };
  });

  // ── Ratings / reviews ───────────────────────────────────────────────
  registerLensAction("podcast", "show-rate", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const show = s.shows.get(String(params.showId));
    if (!show) return { ok: false, error: "show not found" };
    const rating = Math.round(pcnum(params.rating));
    if (rating < 1 || rating > 5) return { ok: false, error: "rating must be 1–5" };
    const userId = pcaid(ctx);
    const reviews = pclistB(s.reviews, show.id);
    let review = reviews.find((r) => r.userId === userId);
    if (review) {
      review.rating = rating;
      review.text = pcclean(params.text, 1000);
      review.updatedAt = pcnow();
    } else {
      review = { id: pcid("rv"), showId: show.id, userId, rating, text: pcclean(params.text, 1000), createdAt: pcnow() };
      reviews.push(review);
    }
    savePodState();
    return { ok: true, result: { review } };
  });

  registerLensAction("podcast", "show-reviews", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.shows.has(String(params.showId))) return { ok: false, error: "show not found" };
    const reviews = (s.reviews.get(String(params.showId)) || []).slice().reverse();
    const avg = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : 0;
    return { ok: true, result: { reviews, averageRating: avg, count: reviews.length } };
  });

  // ── Stats / discovery ───────────────────────────────────────────────
  registerLensAction("podcast", "new-episodes", (ctx, _a, _params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const subs = s.subscriptions.get(userId) || [];
    const played = new Set((s.playback.get(userId) || []).filter((p) => p.played).map((p) => p.episodeId));
    const episodes = [];
    for (const showId of subs) {
      for (const e of s.episodes.get(showId) || []) {
        if (!played.has(e.id)) episodes.push(episodeView(s, userId, e));
      }
    }
    episodes.sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)));
    return { ok: true, result: { episodes: episodes.slice(0, 50), count: episodes.length } };
  });

  registerLensAction("podcast", "listening-stats", (ctx, _a, _params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const progress = s.playback.get(userId) || [];
    let listenedSec = 0;
    for (const p of progress) listenedSec += p.positionSec;
    return {
      ok: true,
      result: {
        listenedSec,
        listenedHours: Math.round((listenedSec / 3600) * 10) / 10,
        episodesCompleted: progress.filter((p) => p.played).length,
        episodesStarted: progress.length,
        subscriptions: (s.subscriptions.get(userId) || []).length,
      },
    };
  });

  registerLensAction("podcast", "podcast-dashboard", (ctx, _a, _params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pcaid(ctx);
    const progress = s.playback.get(userId) || [];
    return {
      ok: true,
      result: {
        subscriptions: (s.subscriptions.get(userId) || []).length,
        queueLength: (s.queue.get(userId) || []).length,
        downloads: (s.downloads.get(userId) || []).length,
        inProgress: progress.filter((p) => !p.played && p.positionSec > 0).length,
        playlists: (s.playlists.get(userId) || []).length,
        listenedHours: Math.round((progress.reduce((a, p) => a + p.positionSec, 0) / 3600) * 10) / 10,
      },
    };
  });
}
