// server/domains/video-gen.js
//
// Sprint 14 — macro surface for video generation. Mirrors the
// image-gen pattern but async — videos take 30s-5min so the call
// is split into start + poll.

import {
  startVideoGeneration, pollVideoStatus, listPendingJobs,
  VIDEO_GEN_CONSTANTS,
} from "../lib/video-gen.js";

export default function registerVideoGenMacros(register) {
  register("video_gen", "start", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    const { provider = "openai", prompt, duration, size, ratio, aspectRatio, model } = input || {};
    return startVideoGeneration({
      db, userId, provider, prompt,
      opts: { duration, size, ratio, aspectRatio, model },
    });
  }, { note: "Start a video generation job. Provider: openai (Sora) / google (Veo) / runway. Returns jobId for polling." });

  register("video_gen", "poll", async (ctx, input = {}) => {
    if (!input?.jobId) return { ok: false, reason: "missing_jobId" };
    return pollVideoStatus(input.jobId);
  }, { note: "Poll a video generation job. Returns status (pending/completed/failed) + url when done." });

  register("video_gen", "list_pending", async () => {
    return { ok: true, jobs: listPendingJobs() };
  }, { note: "List in-flight video gen jobs across all users (admin/diagnostic)." });

  register("video_gen", "providers", async () => {
    return { ok: true, providers: VIDEO_GEN_CONSTANTS.PROVIDERS };
  }, { note: "List supported video gen providers." });
}
