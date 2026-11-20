// server/domains/film-releases.js
//
// Finished films. A filmmaker releases a film (an uploaded video of theirs)
// from a production, free or priced in Concord Coin, through the shared
// release shop (lib/media-release-shop.js: marketplace money path, preview
// gating at the stream, buyers keep theirs). Film adds credits from the
// production's cast and crew, and screenings of a released film.

import { createReleaseShop, displayName } from "../lib/media-release-shop.js";

export { displayName };

export default function registerFilmReleases(registerLensAction, h) {
  const { getFmState, getFmExtra, saveFmState, fmAid, fmClean, fmId, fmNow, fmProject } = h;

  const shop = createReleaseShop(registerLensAction, {
    domain: "film-studios", prefix: "film-release", noun: "film", makerNoun: "filmmaker",
    ownerField: "filmmakerId", ownerView: "filmmaker",
    dtuType: "film_release", dtuDomain: "film", tag: "film",
    home: () => getFmState(), save: saveFmState, aid: fmAid, makeId: fmId, now: fmNow,
    resolve(s, userId, params) {
      if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
      const media = (getFmExtra().media.get(userId) || []).find((m) => m.id === params.mediaId && m.projectId === String(params.projectId));
      if (!media || !media.platformMediaId) return { ok: false, error: "choose an uploaded video from this production" };
      return { ok: true, platformMediaId: media.platformMediaId, title: media.name, fields: { projectId: String(params.projectId), mediaId: media.id } };
    },
    extraView(s, r) {
      const pick = (map) => (map.get(r.filmmakerId) || []).filter((x) => x.projectId === r.projectId);
      return {
        credits: {
          cast: pick(s.cast).slice(0, 40).map((c) => ({ name: c.name, role: c.characterName || c.role || null })),
          crew: pick(s.crew).slice(0, 40).map((c) => ({ name: c.name, role: c.position || c.department || null })),
        },
      };
    },
    filter: (r, params) => !params.projectId || r.projectId === String(params.projectId),
  });
  const { store, canWatchFull } = shop;
  const me = shop.me;

  globalThis._concordFilmReleaseStream = (releaseId, userId) => {
    const s = store(); const r = s?.releases.get(releaseId);
    return r && canWatchFull(s, r, userId) ? shop.streamOf(r) : null;
  };

  /** Screen a released film for everyone you invite who may watch it. */
  registerLensAction("film-studios", "film-release-party", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx); if (!userId) return { ok: false, error: "sign in to host a screening" };
    const r = s.releases.get(String(params.id || ""));
    if (!r || r.status !== "published") return { ok: false, error: "film not found" };
    if (!canWatchFull(s, r, userId)) return { ok: false, error: "get the film before hosting a screening" };
    const x = getFmExtra();
    const code = `FILM-${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const party = {
      id: fmId("pty"), projectId: null, releaseId: r.id, title: fmClean(params.title, 120) || `Screening: ${r.title}`,
      code, versionId: null, host: userId, playing: false, positionSec: 0, updatedAt: fmNow(),
      participants: [userId], createdAt: fmNow(),
    };
    if (!(x.parties.get(userId) instanceof Array)) x.parties.set(userId, []);
    x.parties.get(userId).push(party);
    x.partyChat.set(party.id, []);
    saveFmState();
    return { ok: true, result: { party } };
  });
}
