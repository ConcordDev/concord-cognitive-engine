// server/lib/social-publish-youtube.js
//
// Real publishing to YouTube via Google OAuth + YouTube Data API v3.
// Mirrors the Bluesky/Mastodon pattern in social-publish.js: credentials
// are verified live, stored encrypted per user (connector_oauth_tokens),
// and uploads return real video IDs only when YouTube accepts them.
//
// Setup:
//   1. Create a Google Cloud project
//   2. Enable YouTube Data API v3
//   3. Configure OAuth consent screen with these scopes:
//        https://www.googleapis.com/auth/youtube.upload
//        https://www.googleapis.com/auth/youtube.readonly
//   4. Add the same scopes to GOOGLE_CONFIG.scopes (or pass them via
//      a dedicated YouTube consent flow that calls getYouTubeAuthUrl).
//   5. User clicks "Connect YouTube" → OAuth callback stores the refresh
//      token. Future uploads refresh as needed.
//
// Limits: YouTube Data API free quota is 10,000 units/day. A video
// upload costs 1,600 units → 6 uploads/day on the free tier.

import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";
import { persistConnectorToken, getConnectorToken, deleteConnectorToken } from "./connector-tokens.js";

// ── Constants ──────────────────────────────────────────────────────────────

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

export const YOUTUBE_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable";

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export const youtubeConnectorId = (channelId) => `youtube:${channelId || "default"}`;

// Quota costs per YouTube Data API operation
export const YOUTUBE_QUOTA_COSTS = Object.freeze({
  upload: 1600,
  update: 50,
  list: 1,
  channelsList: 1,
});

// ── OAuth flow ─────────────────────────────────────────────────────────────

/**
 * Build a Google OAuth URL that requests YouTube upload permissions.
 * Drop this into your existing OAuth consent flow when the user clicks
 * "Connect YouTube".
 */
export function getYouTubeAuthUrl(state) {
  // Note: oauth-providers.js' getGoogleAuthUrl() uses the login scopes
  // (openid/email/profile). YouTube needs a wider scope set, so we
  // build the URL by hand rather than calling it.
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri:
      process.env.PUBLIC_URL
        ? `${process.env.PUBLIC_URL}/api/auth/google/callback`
        : process.env.GOOGLE_REDIRECT_URI || "",
    response_type: "code",
    scope: [...YOUTUBE_SCOPES, "openid", "email", "profile"].join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange a YouTube-scoped authorization code for tokens.
 * @param {string} code
 * @returns {Promise<{ access_token, refresh_token, expires_in, scope, id_token, token_type }>}
 */
export async function exchangeYouTubeCode(code) {
  const redirectUri =
    process.env.PUBLIC_URL
      ? `${process.env.PUBLIC_URL}/api/auth/google/callback`
      : process.env.GOOGLE_REDIRECT_URI || "";
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube token exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Token refresh ──────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube token refresh failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getValidAccessToken(db, userId) {
  const tok = getConnectorToken(db, userId, youtubeConnectorId("default"));
  if (!tok) return { ok: false, reason: "not_connected" };
  // If we have an expires_at and it's in the future, reuse the token.
  if (tok.expires_at && Date.now() < tok.expires_at - 60_000) {
    return { ok: true, access_token: tok.access_token };
  }
  if (!tok.refresh_token) return { ok: false, reason: "no_refresh_token" };
  const refreshed = await refreshAccessToken(tok.refresh_token);
  const expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
  persistConnectorToken(db, userId, youtubeConnectorId("default"), {
    access_token: refreshed.access_token,
    refresh_token: tok.refresh_token, // Google doesn't rotate refresh tokens
    expires_at,
    scope: tok.scope || refreshed.scope,
  });
  return { ok: true, access_token: refreshed.access_token };
}

// ── Channel info (proves the OAuth user owns a YouTube channel) ────────────

/**
 * Fetch the authenticated user's YouTube channel.
 * Used at connect-time to prove the OAuth user actually owns a channel
 * before we mark them as "connected".
 */
export async function getYouTubeChannel(db, userId) {
  const tok = await getValidAccessToken(db, userId);
  if (!tok.ok) return { ok: false, reason: tok.reason };
  const res = await fetch(
    `${YOUTUBE_API_BASE}/channels?part=snippet&mine=true`,
    { headers: { Authorization: `Bearer ${tok.access_token}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, reason: `channels_list_${res.status}`, detail: body.slice(0, 200) };
  }
  const data = await res.json();
  const channel = data?.items?.[0];
  if (!channel) return { ok: false, reason: "no_channel_found" };
  return {
    ok: true,
    channel: {
      id: channel.id,
      title: channel.snippet?.title,
      description: channel.snippet?.description,
      thumbnail: channel.snippet?.thumbnails?.default?.url,
    },
  };
}

/**
 * Connect YouTube: store tokens after a successful code exchange.
 * Caller is responsible for getting the code via the OAuth redirect.
 */
export function connectYouTube(db, userId, tokens) {
  if (!tokens?.access_token) {
    return { ok: false, reason: "missing_access_token" };
  }
  const expires_at = Date.now() + (tokens.expires_in || 3600) * 1000;
  persistConnectorToken(db, userId, youtubeConnectorId("default"), {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at,
    scope: tokens.scope,
    token_type: tokens.token_type,
  });
  return { ok: true };
}

export function disconnectYouTube(db, userId) {
  deleteConnectorToken(db, userId, youtubeConnectorId("default"));
  return { ok: true };
}

// ── Upload ─────────────────────────────────────────────────────────────────

/**
 * Upload a video to YouTube.
 *
 * @param {object} args
 * @param {string} args.db           - better-sqlite3 instance
 * @param {string} args.userId       - concord user id
 * @param {Buffer|string} args.file  - video file path or in-memory buffer
 * @param {string} args.title        - video title (≤100 chars)
 * @param {string} args.description  - video description (≤5000 chars)
 * @param {string[]} [args.tags]     - up to ~500 chars total
 * @param {string} [args.privacyStatus] - "public" | "unlisted" | "private"
 * @param {string} [args.category]   - YouTube category id (default: 22 = People & Blogs)
 * @returns {Promise<{ ok: boolean, videoId?: string, url?: string, error?: string }>}
 */
export async function uploadYouTubeVideo(db, userId, args) {
  const tok = await getValidAccessToken(db, userId);
  if (!tok.ok) return { ok: false, reason: tok.reason };

  const title = String(args.title || "").slice(0, 100);
  const description = String(args.description || "").slice(0, 5000);
  const tags = Array.isArray(args.tags)
    ? args.tags.slice(0, 30).map((t) => String(t).slice(0, 30))
    : [];
  const privacyStatus = ["public", "unlisted", "private"].includes(args.privacyStatus)
    ? args.privacyStatus
    : "unlisted";
  const categoryId = String(args.category || "22");

  if (!title) return { ok: false, reason: "title_required" };
  if (!args.file) return { ok: false, reason: "file_required" };

  // Read file to buffer if a path was passed
  let buffer;
  if (Buffer.isBuffer(args.file)) {
    buffer = args.file;
  } else {
    try {
      const fs = await import("fs/promises");
      buffer = await fs.readFile(args.file);
    } catch (e) {
      return { ok: false, reason: "file_read_failed", detail: String(e?.message || e) };
    }
  }

  const metadata = {
    snippet: {
      title,
      description,
      tags,
      categoryId,
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };

  // Step 1: initiate resumable upload
  const initRes = await fetch(
    `${YOUTUBE_UPLOAD_URL}&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/*",
        "X-Upload-Content-Length": String(buffer.length),
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!initRes.ok) {
    const err = await initRes.text();
    return { ok: false, reason: `init_${initRes.status}`, detail: err.slice(0, 300) };
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) return { ok: false, reason: "no_upload_url_returned" };

  // Step 2: send the bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/*" },
    body: buffer,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return { ok: false, reason: `upload_${uploadRes.status}`, detail: err.slice(0, 300) };
  }
  const video = await uploadRes.json();
  if (!video?.id) {
    return { ok: false, reason: "no_video_id_returned", data: video };
  }
  return {
    ok: true,
    videoId: video.id,
    url: `https://youtu.be/${video.id}`,
    channelTitle: video.snippet?.channelTitle,
    privacyStatus: video.status?.privacyStatus,
  };
}

/**
 * Update an existing video's metadata (title, description, tags, privacy).
 * Useful after-the-fact for "actually make this public after review".
 */
export async function updateYouTubeVideo(db, userId, videoId, patch) {
  const tok = await getValidAccessToken(db, userId);
  if (!tok.ok) return { ok: false, reason: tok.reason };

  const body = {
    id: videoId,
    snippet: patch.snippet || {},
    status: patch.status || {},
  };

  const res = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,status`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: `update_${res.status}`, detail: err.slice(0, 300) };
  }
  const data = await res.json();
  return { ok: true, videoId: data.id, status: data.status };
}

// ── Constants export for the domain macro ─────────────────────────────────

export const YOUTUBE_PUBLISH_CONSTANTS = Object.freeze({
  scopes: YOUTUBE_SCOPES,
  uploadUrl: YOUTUBE_UPLOAD_URL,
  apiBase: YOUTUBE_API_BASE,
  quotaCosts: YOUTUBE_QUOTA_COSTS,
  dailyFreeQuota: 10000,
  maxTitleLength: 100,
  maxDescriptionLength: 5000,
  maxTags: 30,
  maxTagLength: 30,
});