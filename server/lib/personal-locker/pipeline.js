// server/lib/personal-locker/pipeline.js
// Upload → analysis → personal DTU payload pipeline.
// Supports image, audio, document, and video (frame extraction via ffmpeg).

import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { callVision } from "../vision-inference.js";

// Lazy-load ffmpeg to avoid startup failure if binary is missing
let _ffmpeg = null;
async function getFFmpeg() {
  if (_ffmpeg) return _ffmpeg;
  try {
    const ffmpegStatic = (await import("ffmpeg-static")).default;
    const ffmpeg = (await import("fluent-ffmpeg")).default;
    ffmpeg.setFfmpegPath(ffmpegStatic);
    _ffmpeg = ffmpeg;
    return _ffmpeg;
  } catch {
    return null;
  }
}

/**
 * Analyze uploaded content with the appropriate local model.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{summary: string, tags: string[], extractedText: string, lensHint: string}>}
 */
export async function analyzeContent(buffer, mimeType) {
  const type = classifyMime(mimeType);

  if (type === "image") {
    return analyzeImage(buffer, mimeType);
  }
  if (type === "audio") {
    return analyzeAudio(buffer, mimeType);
  }
  if (type === "document") {
    return analyzeDocument(buffer, mimeType);
  }
  if (type === "video") {
    return analyzeVideo(buffer, mimeType);
  }

  // Fallback for unknown types
  return { summary: "Unknown content type", tags: [], extractedText: "", lensHint: "research" };
}

async function analyzeImage(buffer, mimeType) {
  const imageB64 = buffer.toString("base64");
  const result = await callVision(imageB64, "Describe this image in detail. Extract all visible text, key subjects, topics, style, and context. Be thorough.");
  const summary = result.ok ? result.content : "Image uploaded (vision unavailable)";
  return {
    summary,
    tags: extractTags(summary),
    extractedText: extractVisibleText(summary),
    lensHint: guessLensFromSummary(summary, "photography"),
  };
}

async function analyzeAudio(buffer, mimeType) {
  // Write to temp file for whisper.cpp (it reads from disk)
  const tmpFile = path.join(os.tmpdir(), `concord-audio-${crypto.randomBytes(6).toString("hex")}.wav`);
  try {
    await fs.promises.writeFile(tmpFile, buffer, { mode: 0o600 });
    // Call whisper via the existing voice.transcribe path through spawn
    const { spawnSync } = await import("node:child_process");
    const whisperBin = process.env.WHISPER_CPP_BIN || "";
    let transcript = "";
    if (whisperBin) {
      const p = spawnSync(whisperBin, ["-f", tmpFile, "--output-txt"], { encoding: "utf-8", timeout: 60000 });
      transcript = (p.stdout || "").trim();
    }
    const summary = transcript || "Audio uploaded (transcription unavailable)";
    return {
      summary,
      tags: extractTags(summary),
      extractedText: transcript,
      lensHint: guessLensFromSummary(summary, "voice"),
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

async function analyzeDocument(buffer, mimeType) {
  let text = "";
  if (mimeType === "application/pdf") {
    try {
      const { default: pdfParse } = await import("pdf-parse");
      const data = await pdfParse(buffer);
      text = data.text || "";
    } catch {
      // pdf-parse not available — fall back to raw text extraction
      text = buffer.toString("utf-8").replace(/[^\x20-\x7E\n\t]/g, " ").trim();
    }
  } else {
    text = buffer.toString("utf-8");
  }

  // Also run LLaVA on first page if PDF (documents often have visual structure)
  let summary = text.slice(0, 2000);
  try {
    const visionResult = await callVision(
      buffer.toString("base64"),
      "Describe the structure and content of this document. Extract titles, headings, key claims, and overall purpose."
    );
    if (visionResult.ok) summary = visionResult.content;
  } catch { /* use text fallback */ }

  return {
    summary,
    tags: extractTags(summary),
    extractedText: text.slice(0, 10000),
    lensHint: guessLensFromSummary(summary, "research"),
  };
}

async function analyzeVideo(buffer, mimeType) {
  const tmpInput = path.join(os.tmpdir(), `concord-video-${crypto.randomBytes(6).toString("hex")}.mp4`);
  const tmpDir = path.join(os.tmpdir(), `concord-frames-${crypto.randomBytes(6).toString("hex")}`);

  try {
    await fs.promises.writeFile(tmpInput, buffer, { mode: 0o600 });
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

    const ffmpeg = await getFFmpeg();
    if (!ffmpeg) {
      return { summary: "Video uploaded (ffmpeg unavailable for frame analysis)", tags: ["video"], extractedText: "", lensHint: "film" };
    }

    // Extract 5 keyframes evenly distributed through the video
    await new Promise((resolve, reject) => {
      ffmpeg(tmpInput)
        .screenshots({ count: 5, folder: tmpDir, filename: "frame-%i.jpg", size: "640x?" })
        .on("end", resolve)
        .on("error", reject);
    });

    const frameFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith(".jpg")).sort();
    const frameAnalyses = await Promise.all(
      frameFiles.map(async (f) => {
        const frameB64 = await fs.promises.readFile(path.join(tmpDir, f)).toString("base64");
        const r = await callVision(frameB64, "Describe this video frame: subjects, action, setting, mood, cinematography.");
        return r.ok ? r.content : "";
      })
    );

    const combined = frameAnalyses.filter(Boolean).join(" | ");
    const summary = combined || "Video uploaded (no frame analysis)";

    return {
      summary,
      tags: extractTags(summary),
      extractedText: combined,
      lensHint: guessLensFromSummary(summary, "film"),
    };
  } finally {
    try { fs.unlinkSync(tmpInput); } catch { /* best-effort */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Build the personal DTU payload (plaintext JSON, before encryption).
 */
export function buildPersonalDTUPayload(userId, file, analysis) {
  return {
    id: `pdtu_${crypto.randomBytes(10).toString("hex")}`,
    userId,
    createdAt: new Date().toISOString(),
    contentType: classifyMime(file.mimeType),
    mimeType: file.mimeType,
    title: file.title || file.originalname || "Untitled",
    filename: file.originalname,
    fileSize: file.size,
    lensHint: analysis.lensHint,
    analysis: {
      summary: analysis.summary,
      tags: analysis.tags,
      extractedText: analysis.extractedText,
    },
    rawData: file.buffer.toString("base64"),
  };
}

/**
 * Classify a MIME type into a content category.
 */
export function classifyMime(mimeType) {
  if (!mimeType) return "unknown";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf" || mimeType.startsWith("text/")) return "document";
  if (mimeType === "application/epub+zip") return "document";
  return "unknown";
}

function extractTags(text) {
  if (!text) return [];
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  // Object.create(null): no prototype chain, no prototype-pollution surface
  // for keys derived from user-supplied text.
  const freq = Object.create(null);
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .filter(([, n]) => n >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([w]) => w);
}

function extractVisibleText(desc) {
  if (!desc) return "";
  const lower = desc.toLowerCase();
  for (const kw of ["text:", "reads:", "says:", "written:", "caption:"]) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) return desc.slice(idx + kw.length, idx + kw.length + 200).trim().replace(/^["']/, "");
  }
  return "";
}

function guessLensFromSummary(summary, fallback) {
  const lower = (summary || "").toLowerCase();
  const hints = [
    ["music|song|melody|chord|rhythm|album|lyrics", "music"],
    ["film|cinema|movie|scene|shot|director|camera", "film"],
    ["code|function|class|variable|algorithm|software", "code"],
    ["research|study|paper|data|analysis|hypothesis", "research"],
    ["art|painting|artwork|illustration|design", "art"],
    ["food|recipe|ingredient|dish|cuisine|meal", "food"],
    ["health|medical|clinical|patient|anatomy|disease", "healthcare"],
    ["fashion|clothing|garment|style|outfit", "fashion"],
    ["photo|photograph|exposure|composition|lens", "photography"],
  ];
  for (const [pattern, lens] of hints) {
    if (new RegExp(pattern).test(lower)) return lens;
  }
  return fallback;
}
