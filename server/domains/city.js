// server/domains/city.js
//
// Smoking-gun fix I6 — these macros were inline in server.js
// (~32053-32092) instead of in a dedicated domain file like every
// other lens. Extracted here for consistency + maintainability.
// The realtimeEmit + cityStreaming dependencies are passed in by
// the wire-in site (server.js) so this module stays import-clean.

export default function registerCityMacros(register, { cityStreaming, realtimeEmit }) {

  register("city", "startStream", (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, error: "auth required" };
    const stream = cityStreaming.startStream(userId, { cityId: input.cityId, title: input.title });
    realtimeEmit("city:stream-started", { streamId: stream.id, creatorId: userId, cityId: stream.cityId, title: stream.title });
    return { ok: true, stream };
  });

  register("city", "endStream", (ctx) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, error: "auth required" };
    try {
      const summary = cityStreaming.endStream(userId);
      realtimeEmit("city:stream-ended", { streamId: summary.streamId, creatorId: userId, duration: summary.duration, dtusCreated: summary.dtusCreated, salesMade: summary.salesMade });
      return { ok: true, summary };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  register("city", "followStream", (ctx, input = {}) => {
    const viewerId = ctx?.actor?.userId || "anon";
    cityStreaming.followStream(input.streamId, viewerId);
    return { ok: true };
  });

  register("city", "unfollowStream", (ctx, input = {}) => {
    const viewerId = ctx?.actor?.userId || "anon";
    cityStreaming.unfollowStream(input.streamId, viewerId);
    return { ok: true };
  });

  register("city", "listStreams", (ctx, input = {}) => {
    const streams = cityStreaming.listActiveStreams(input.cityId);
    return { ok: true, streams, count: streams.length };
  });

  register("city", "getStream", (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    const stream = cityStreaming.getActiveStream(userId || input.userId);
    return { ok: true, stream: stream || null };
  });
}
