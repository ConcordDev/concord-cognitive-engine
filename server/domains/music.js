// server/domains/music.js
//
// Pure-compute music-theory helpers (BPM, key detect via
// Krumhansl-Schmuckler, chord progression match, setlist planner)
// plus real MusicBrainz metadata (artists, releases, recordings).
//
// MusicBrainz is the authoritative open-source music metadata DB.
// Free, no API key — but ToS REQUIRES a contact User-Agent header.
// Set MUSICBRAINZ_CONTACT to a contact email/URL for production
// usage; we use a fallback identifying Concord OS for dev.

const MB_BASE = "https://musicbrainz.org/ws/2";

function mbUserAgent() {
  const contact = process.env.MUSICBRAINZ_CONTACT || "https://concord-os.org";
  return `Concord-OS/1.0 ( ${contact} )`;
}

async function mbFetch(path) {
  const url = `${MB_BASE}${path}${path.includes("?") ? "&" : "?"}fmt=json`;
  const r = await fetch(url, { headers: { "User-Agent": mbUserAgent(), Accept: "application/json" } });
  if (r.status === 503) throw new Error("musicbrainz rate limited (1 req/sec) — back off and retry");
  if (!r.ok) throw new Error(`musicbrainz ${r.status}`);
  return r.json();
}

export default function registerMusicActions(registerLensAction) {
  registerLensAction("music", "bpmAnalyze", (ctx, artifact, _params) => {
    const beats = artifact.data?.beats || artifact.data?.timestamps || [];
    if (beats.length < 4) return { ok: true, result: { message: "Provide 4+ beat timestamps (in seconds) to analyze BPM." } };
    const times = beats.map(Number).sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
    const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;
    const bpm = avgInterval > 0 ? Math.round(60 / avgInterval) : 0;
    const variance = intervals.reduce((s, i) => s + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const stability = Math.max(0, Math.round((1 - Math.sqrt(variance) / avgInterval) * 100));
    const minBpm = Math.round(60 / Math.max(...intervals));
    const maxBpm = Math.round(60 / Math.min(...intervals));
    return { ok: true, result: { bpm, minBpm, maxBpm, stability, tempoClass: bpm < 70 ? "Largo" : bpm < 90 ? "Andante" : bpm < 120 ? "Moderato" : bpm < 140 ? "Allegro" : bpm < 170 ? "Vivace" : "Presto", beatCount: beats.length, avgIntervalMs: Math.round(avgInterval * 1000), durationSec: Math.round((times[times.length - 1] - times[0]) * 100) / 100 } };
  });

  registerLensAction("music", "keyDetect", (ctx, artifact, _params) => {
    const notes = artifact.data?.notes || [];
    if (notes.length < 4) return { ok: true, result: { message: "Provide 4+ note names (e.g., C, D#, Eb) to detect key." } };
    const noteMap = { "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11 };
    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const pitchClasses = new Array(12).fill(0);
    notes.forEach(n => { const name = typeof n === "string" ? n.replace(/[0-9]/g, "") : ""; if (noteMap[name] !== undefined) pitchClasses[noteMap[name]]++; });
    let bestKey = "C", bestMode = "major", bestScore = -Infinity;
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (let root = 0; root < 12; root++) {
      const rotated = pitchClasses.slice(root).concat(pitchClasses.slice(0, root));
      let majCorr = 0, minCorr = 0;
      const rSum = rotated.reduce((s, v) => s + v, 0);
      const rMean = rSum / 12;
      for (let i = 0; i < 12; i++) {
        majCorr += (rotated[i] - rMean) * (majorProfile[i] - majorProfile.reduce((s, v) => s + v, 0) / 12);
        minCorr += (rotated[i] - rMean) * (minorProfile[i] - minorProfile.reduce((s, v) => s + v, 0) / 12);
      }
      if (majCorr > bestScore) { bestScore = majCorr; bestKey = noteNames[root]; bestMode = "major"; }
      if (minCorr > bestScore) { bestScore = minCorr; bestKey = noteNames[root]; bestMode = "minor"; }
    }
    return { ok: true, result: { key: bestKey, mode: bestMode, fullKey: `${bestKey} ${bestMode}`, confidence: Math.min(100, Math.round(Math.abs(bestScore) * 10)), noteDistribution: Object.fromEntries(noteNames.map((n, i) => [n, pitchClasses[i]])), notesAnalyzed: notes.length } };
  });

  registerLensAction("music", "chordProgress", (ctx, artifact, _params) => {
    const chords = artifact.data?.chords || [];
    if (chords.length < 2) return { ok: true, result: { message: "Provide 2+ chord names to analyze progression." } };
    const names = chords.map(c => typeof c === "string" ? c : c.name || c.chord || "");
    const commonProgressions = {
      "I-V-vi-IV": ["C-G-Am-F", "G-D-Em-C", "D-A-Bm-G", "A-E-F#m-D"],
      "I-IV-V-I": ["C-F-G-C", "G-C-D-G", "D-G-A-D"],
      "ii-V-I": ["Dm-G-C", "Am-D-G", "Em-A-D"],
      "I-vi-IV-V": ["C-Am-F-G", "G-Em-C-D"],
      "vi-IV-I-V": ["Am-F-C-G", "Em-C-G-D"],
      "12-bar-blues": ["A-A-A-A-D-D-A-A-E-D-A-E"],
    };
    const chordStr = names.join("-");
    let matchedProgression = null;
    for (const [name, patterns] of Object.entries(commonProgressions)) {
      if (patterns.some(p => chordStr.includes(p))) { matchedProgression = name; break; }
    }
    const transitions = {};
    for (let i = 0; i < names.length - 1; i++) {
      const key = `${names[i]}→${names[i + 1]}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
    const uniqueChords = [...new Set(names)];
    const majorCount = uniqueChords.filter(c => /^[A-G][#b]?$/.test(c) || c.includes("maj")).length;
    const minorCount = uniqueChords.filter(c => c.includes("m") && !c.includes("maj")).length;
    return { ok: true, result: { chordCount: names.length, uniqueChords: uniqueChords.length, progression: names, matchedPattern: matchedProgression, mood: minorCount > majorCount ? "minor/melancholic" : "major/bright", transitions: Object.entries(transitions).sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ transition: t, count: c })), harmonicDensity: Math.round((uniqueChords.length / names.length) * 100) } };
  });

  registerLensAction("music", "setlistPlan", (ctx, artifact, _params) => {
    const tracks = artifact.data?.tracks || artifact.data?.songs || [];
    if (tracks.length < 2) return { ok: true, result: { message: "Provide 2+ tracks with bpm/energy/key to plan a setlist." } };
    const processed = tracks.map((t, i) => ({
      index: i, title: t.title || t.name || `Track ${i + 1}`, bpm: parseFloat(t.bpm) || 120, energy: parseFloat(t.energy) || 5, key: t.key || "C", duration: parseFloat(t.duration) || 240,
    }));
    // Sort by energy curve: start medium, build to peak, wind down
    const sorted = [...processed].sort((a, b) => a.energy - b.energy);
    const n = sorted.length;
    const opener = sorted[Math.floor(n * 0.6)] || sorted[0];
    const closer = sorted[Math.floor(n * 0.3)] || sorted[0];
    const peak = sorted[n - 1];
    // Build setlist: medium start, gradual build, peak at 2/3, cool down
    const setlist = [...processed].sort((a, b) => {
      const aPeakDist = Math.abs(processed.indexOf(a) / n - 0.66);
      const bPeakDist = Math.abs(processed.indexOf(b) / n - 0.66);
      return (a.energy * (1 - aPeakDist)) - (b.energy * (1 - bPeakDist));
    });
    const totalDuration = processed.reduce((s, t) => s + t.duration, 0);
    const avgBpm = Math.round(processed.reduce((s, t) => s + t.bpm, 0) / n);
    return { ok: true, result: { suggestedOrder: setlist.map(t => t.title), totalDuration: Math.round(totalDuration), totalMinutes: Math.round(totalDuration / 60), trackCount: n, avgBpm, energyCurve: setlist.map(t => ({ title: t.title, energy: t.energy, bpm: t.bpm })), peakMoment: peak.title, opener: opener.title, closer: closer.title } };
  });

  // ── MusicBrainz (real metadata) ──

  /**
   * mb-search-artist — Fuzzy artist search via MusicBrainz.
   * params: { query: string, limit?: 1-100 }
   */
  registerLensAction("music", "mb-search-artist", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query must be ≥ 2 characters" };
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 10));
    try {
      const data = await mbFetch(`/artist?query=${encodeURIComponent(query)}&limit=${limit}`);
      const artists = (data.artists || []).map((a) => ({
        mbid: a.id,
        name: a.name,
        sortName: a["sort-name"],
        type: a.type,
        country: a.country,
        beginArea: a["begin-area"]?.name,
        lifeSpan: a["life-span"] ? { begin: a["life-span"].begin, end: a["life-span"].end, ended: a["life-span"].ended } : null,
        disambiguation: a.disambiguation,
        score: a.score,
        tags: (a.tags || []).map((t) => t.name),
      }));
      return {
        ok: true,
        result: { artists, count: artists.length, totalCount: data.count, source: "musicbrainz" },
      };
    } catch (e) {
      return { ok: false, error: `musicbrainz unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * mb-artist-releases — Lookup an artist's releases (albums/EPs/singles)
   * by their MBID. Returns releases with type, date, country, formats.
   */
  registerLensAction("music", "mb-artist-releases", async (_ctx, _artifact, params = {}) => {
    const mbid = String(params.mbid || "").trim();
    if (!mbid) return { ok: false, error: "mbid required (MusicBrainz artist UUID from mb-search-artist)" };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
      return { ok: false, error: "mbid must be a MusicBrainz UUID" };
    }
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    try {
      const data = await mbFetch(`/release?artist=${mbid}&limit=${limit}&inc=release-groups`);
      const releases = (data.releases || []).map((r) => ({
        mbid: r.id,
        title: r.title,
        date: r.date,
        country: r.country,
        status: r.status,
        primaryType: r["release-group"]?.["primary-type"],
        secondaryTypes: r["release-group"]?.["secondary-types"] || [],
        disambiguation: r.disambiguation,
        barcode: r.barcode,
        packaging: r.packaging,
      }));
      // Newest first
      releases.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return {
        ok: true,
        result: { releases, count: releases.length, totalCount: data["release-count"], source: "musicbrainz" },
      };
    } catch (e) {
      return { ok: false, error: `musicbrainz unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * mb-lookup-by-isrc — Lookup recordings by International Standard
   * Recording Code (ISRC). Useful for radio station integrations,
   * royalty tracking, and disambiguating cover versions.
   */
  registerLensAction("music", "mb-lookup-by-isrc", async (_ctx, _artifact, params = {}) => {
    const isrc = String(params.isrc || "").toUpperCase().replace(/[-\s]/g, "").trim();
    if (!isrc) return { ok: false, error: "isrc required" };
    if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) {
      return { ok: false, error: "isrc must be 12 chars: 2 country + 3 registrant + 2 year + 5 designation (e.g. USRC17607839)" };
    }
    try {
      const data = await mbFetch(`/isrc/${encodeURIComponent(isrc)}?inc=artist-credits+releases`);
      const recordings = (data.recordings || []).map((rec) => ({
        mbid: rec.id,
        title: rec.title,
        lengthMs: rec.length,
        artistCredit: (rec["artist-credit"] || []).map((ac) => ac.name).join(""),
        releases: (rec.releases || []).map((rel) => ({ mbid: rel.id, title: rel.title, date: rel.date })),
        disambiguation: rec.disambiguation,
      }));
      return {
        ok: true,
        result: { isrc, recordings, count: recordings.length, source: "musicbrainz" },
      };
    } catch (e) {
      return { ok: false, error: `musicbrainz unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
