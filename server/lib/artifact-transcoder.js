import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import logger from '../logger.js';

const execFileAsync = promisify(execFile);

/**
 * Check whether ffmpeg is available on PATH.
 * @returns {Promise<boolean>}
 */
export async function isTranscodingAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run ffprobe on a file and return parsed metadata.
 * @param {string} filePath
 * @returns {Promise<object|null>} { duration, codec, width, height, bitrate }
 */
export async function probeMedia(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const data = JSON.parse(stdout);
    const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
    const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');
    const format = data.format || {};

    return {
      duration: format.duration ? parseFloat(format.duration) : null,
      codec: videoStream?.codec_name || audioStream?.codec_name || null,
      width: videoStream?.width || null,
      height: videoStream?.height || null,
      bitrate: format.bit_rate ? parseInt(format.bit_rate, 10) : null,
    };
  } catch (err) {
    logger.error('probeMedia failed', { filePath, error: err.message });
    return null;
  }
}

/**
 * Transcode a JPEG/PNG image to WebP at quality 80.
 * @param {string} inputPath
 * @param {string} outputDir
 * @returns {Promise<{path: string, mimeType: string, sizeBytes: number}|null>}
 */
export async function transcodeImage(inputPath, outputDir) {
  try {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${baseName}.webp`);

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-quality', '80',
      '-codec:v', 'libwebp',
      outputPath,
    ]);

    const stats = await stat(outputPath);
    return {
      path: outputPath,
      mimeType: 'image/webp',
      sizeBytes: stats.size,
    };
  } catch (err) {
    logger.error('transcodeImage failed', { inputPath, error: err.message });
    return null;
  }
}

/**
 * Transcode MP3/WAV/FLAC audio to Opus at 128k bitrate.
 * Keeps the original file intact.
 * @param {string} inputPath
 * @param {string} outputDir
 * @returns {Promise<{path: string, originalPath: string, mimeType: string, sizeBytes: number}|null>}
 */
export async function transcodeAudio(inputPath, outputDir) {
  try {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${baseName}.opus`);

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-codec:a', 'libopus',
      '-b:a', '128k',
      outputPath,
    ]);

    const stats = await stat(outputPath);
    return {
      path: outputPath,
      originalPath: inputPath,
      mimeType: 'audio/opus',
      sizeBytes: stats.size,
    };
  } catch (err) {
    logger.error('transcodeAudio failed', { inputPath, error: err.message });
    return null;
  }
}

/**
 * Transcode video to H.265 using NVENC (GPU) with CPU fallback.
 * @param {string} inputPath
 * @param {string} outputDir
 * @param {object} [options]
 * @returns {Promise<{path: string, mimeType: string, sizeBytes: number}|null>}
 */
export async function transcodeVideo(inputPath, outputDir, options = {}) {
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${baseName}.mp4`);

  // Try NVENC first (GPU), fall back to libx265 (CPU).
  const codecs = ['hevc_nvenc', 'libx265'];

  for (const codec of codecs) {
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-codec:v', codec,
        '-codec:a', 'aac',
        '-b:a', '128k',
        outputPath,
      ]);

      const stats = await stat(outputPath);
      return {
        path: outputPath,
        mimeType: 'video/mp4',
        sizeBytes: stats.size,
      };
    } catch (err) {
      if (codec === 'hevc_nvenc') {
        logger.warn('NVENC unavailable, falling back to libx265', {
          inputPath,
          error: err.message,
        });
        continue;
      }
      logger.error('transcodeVideo failed', { inputPath, codec, error: err.message });
      return null;
    }
  }

  return null;
}

/**
 * Generate video derivatives: 720p, 480p, thumbnail, and optional HLS segments.
 * @param {string} inputPath
 * @param {string} hash
 * @param {string} outputDir
 * @returns {Promise<{derivatives: {720p: string, 480p: string, thumb: string, hls: string|null}}|null>}
 */
export async function generateVideoDerivatives(inputPath, hash, outputDir) {
  try {
    const probe = await probeMedia(inputPath);
    const duration = probe?.duration ?? 0;

    const p720 = path.join(outputDir, `${hash}_720p.mp4`);
    const p480 = path.join(outputDir, `${hash}_480p.mp4`);
    const thumb = path.join(outputDir, `${hash}_thumb.webp`);

    // 720p variant
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=-2:720',
      '-codec:v', 'libx265',
      '-codec:a', 'aac',
      '-b:a', '128k',
      p720,
    ]);

    // 480p variant
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=-2:480',
      '-codec:v', 'libx265',
      '-codec:a', 'aac',
      '-b:a', '128k',
      p480,
    ]);

    // Thumbnail — first frame at 320px wide as WebP
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vframes', '1',
      '-vf', 'scale=320:-2',
      '-codec:v', 'libwebp',
      thumb,
    ]);

    // HLS segments for videos longer than 60 seconds
    let hlsPath = null;
    if (duration > 60) {
      const hlsDir = path.join(outputDir, `${hash}_hls`);
      // Ensure the HLS directory exists via mkdir
      await execFileAsync('mkdir', ['-p', hlsDir]);

      const hlsPlaylist = path.join(hlsDir, 'playlist.m3u8');
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-codec:v', 'libx265',
        '-codec:a', 'aac',
        '-b:a', '128k',
        '-hls_time', '10',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(hlsDir, 'segment_%03d.ts'),
        hlsPlaylist,
      ]);

      hlsPath = hlsPlaylist;
    }

    return {
      derivatives: {
        '720p': p720,
        '480p': p480,
        thumb,
        hls: hlsPath,
      },
    };
  } catch (err) {
    logger.error('generateVideoDerivatives failed', { inputPath, error: err.message });
    return null;
  }
}

/**
 * Estimate transcoded output size based on MIME type.
 * @param {string} mimeType
 * @param {number} originalSizeBytes
 * @returns {Promise<number|null>}
 */
export async function estimateTranscodedSize(mimeType, originalSizeBytes) {
  try {
    if (!mimeType || !originalSizeBytes || originalSizeBytes <= 0) {
      return null;
    }

    const category = mimeType.split('/')[0];

    switch (category) {
      case 'image':
        // WebP typically saves ~30% over JPEG/PNG
        return Math.round(originalSizeBytes * 0.7);

      case 'audio': {
        // Estimate duration from original size assuming ~256kbps source average
        const estimatedDurationSec = (originalSizeBytes * 8) / (256 * 1000);
        // 128kbps Opus output
        const outputBits = 128 * 1000 * estimatedDurationSec;
        return Math.round(outputBits / 8);
      }

      case 'video':
        // H.265 typically saves ~40% over H.264/source
        return Math.round(originalSizeBytes * 0.6);

      default:
        return null;
    }
  } catch (err) {
    logger.error('estimateTranscodedSize failed', { mimeType, error: err.message });
    return null;
  }
}
