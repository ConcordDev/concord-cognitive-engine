// server/domains/video.js
//
// Real publishing for the video lens — wraps the YouTube upload pipeline
// (server/lib/social-publish-youtube.js) plus the video generation
// pipeline (server/lib/video-gen.js) under one registerLensAction surface.
//
// Mirrors the honest pattern from thread.js: every claim of "published"
// traces to a real platform response. Generated videos are tracked by jobId
// and polled until terminal state. Uploads return a real videoId.
//
// Wired via server.js as:
//   import registerVideoActions from "./domains/video.js";
//   registerVideoActions(registerLensAction);
// And added to ALL_LENS_DOMAINS as "video".

import {
  uploadYouTubeVideo,
  getYouTubeChannel,
  connectYouTube,
  disconnectYouTube,
  youtubeConnectorId,
} from "../lib/social-publish-youtube.js";
import {
  startVideoGeneration,
  pollVideoStatus,
} from "../lib/video-gen.js";
import { getConnectorToken } from "../lib/connector-tokens.js";

// In-memory state — same shape as thread.js. Real persistence is in DTUs.
const state = {
  videos: new Map(),   // videoId -> { id, userId, title, description, status, videoUrl, youtubeId, ... }
  jobs: new Map(),     // jobId -> { userId, provider, status, videoUrl, prompt, ... }
};

function vNow() { return new Date().toISOString(); }
function vId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

export default function registerVideoActions(registerLensAction) {

  // ── Connect / disconnect YouTube ──────────────────────────────────────

  registerLensAction("video", "youtube-connect-status", (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    const tok = getConnectorToken(ctx?.db, userId, youtubeConnectorId("default"));
    if (!tok) return { ok: true, connected: false };
    return {
      ok: true,
      connected: true,
      expires_at: tok.expires_at,
      scope: tok.scope,
    };
  });

  registerLensAction("video", "youtube-disconnect", (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    disconnectYouTube(ctx.db, userId);
    return { ok: true };
  });

  registerLensAction("video", "youtube-channel-info", async (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    return getYouTubeChannel(ctx.db, userId);
  });

  // ── Generate video (calls Sora / Veo / Runway) ────────────────────────

  registerLensAction("video", "generate", async (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    if (!params.prompt) return { ok: false, error: "prompt_required" };

    const r = await startVideoGeneration({
      db: ctx?.db,
      userId,
      provider: params.provider || "sora",
      prompt: params.prompt,
      opts: {
        duration_seconds: params.duration_seconds || 8,
        aspect_ratio: params.aspect_ratio || "16:9",
        model: params.model,
      },
    });
    if (!r.ok) return r;
    const jobId = r.jobId || vId("job");
    state.jobs.set(jobId, {
      id: jobId,
      userId,
      provider: params.provider || "sora",
      prompt: params.prompt,
      status: "started",
      createdAt: vNow(),
      providerJobId: r.providerJobId || null,
    });
    return { ok: true, jobId, status: "started", provider: params.provider };
  });

  registerLensAction("video", "poll-generation", async (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    const job = state.jobs.get(params.jobId);
    if (!job) return { ok: false, error: "job_not_found" };
    if (job.userId !== userId) return { ok: false, error: "not_your_job" };
    const r = await pollVideoStatus(params.jobId);
    if (!r) return { ok: false, error: "poll_failed" };
    if (r.status === "succeeded" || r.status === "completed" || r.videoUrl) {
      job.status = "completed";
      job.videoUrl = r.videoUrl;
      job.completedAt = vNow();
    } else if (r.status === "failed" || r.status === "error") {
      job.status = "failed";
      job.error = r.error || "unknown";
      job.failedAt = vNow();
    } else {
      job.status = r.status || "running";
    }
    return { ok: true, job };
  });

  // ── Upload existing video file to YouTube ─────────────────────────────

  registerLensAction("video", "upload-to-youtube", async (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    if (!params.file) return { ok: false, error: "file_required" };
    if (!params.title) return { ok: false, error: "title_required" };

    const r = await uploadYouTubeVideo(ctx.db, userId, {
      file: params.file,
      title: params.title,
      description: params.description || "",
      tags: Array.isArray(params.tags) ? params.tags : [],
      privacyStatus: params.privacyStatus || "unlisted",
      category: params.category || "22",
    });
    if (!r.ok) return r;

    const videoId = vId("vid");
    state.videos.set(videoId, {
      id: videoId,
      userId,
      title: params.title,
      description: params.description || "",
      youtubeId: r.videoId,
      youtubeUrl: r.url,
      channelTitle: r.channelTitle,
      privacyStatus: r.privacyStatus,
      uploadedAt: vNow(),
      tags: params.tags || [],
    });
    return {
      ok: true,
      videoId,
      youtubeId: r.videoId,
      url: r.url,
      channelTitle: r.channelTitle,
    };
  });

  // ── List / get / delete ────────────────────────────────────────────────

  registerLensAction("video", "list", (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    const all = [...state.videos.values()].filter((v) => v.userId === userId);
    return {
      ok: true,
      videos: all.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || "")),
    };
  });

  registerLensAction("video", "get", (ctx, _a, params = {}) => {
    const userId = params.userId || ctx?.user?.id || ctx?.actor?.id;
    if (!userId) return { ok: false, error: "user_required" };
    const v = state.videos.get(params.videoId);
    if (!v || v.userId !== userId) return { ok: false, error: "not_found" };
    return { ok: true, video: v };
  });

  // ── Constants ──────────────────────────────────────────────────────────

  registerLensAction("video", "constants", () => ({
    ok: true,
    providers: ["sora", "veo", "runway"],
    privacyStatuses: ["public", "unlisted", "private"],
    youtubeCategories: {
      "1":  "Film & Animation",
      "2":  "Autos & Vehicles",
      "10": "Music",
      "15": "Pets & Animals",
      "17": "Sports",
      "19": "Travel & Events",
      "20": "Gaming",
      "22": "People & Blogs",
      "23": "Comedy",
      "24": "Entertainment",
      "25": "News & Politics",
      "26": "Howto & Style",
      "27": "Education",
      "28": "Science & Technology",
      "29": "Nonprofits & Activism",
    },
    limits: {
      title: 100,
      description: 5000,
      tags: 30,
      tagLength: 30,
    },
    quotaFreePerDay: 10000,
    quotaPerUpload: 1600,
  }));
}