/** Query string for POST /api/media/upload-raw — a real image upload (F2). */
export function rawPhotoUploadQuery(args: { title: string; filename: string }): string {
  const q = new URLSearchParams({
    title: args.title,
    filename: args.filename,
    mediaType: 'image',
    privacy: 'private',
  });
  return q.toString();
}

const MB = 1024 * 1024;

/** A readable, specific message for a failed upload (never a bare status code). */
export function describePhotoUploadError(err: unknown, file?: { name: string; type: string; size: number }): string {
  const e = err as {
    response?: { status?: number; data?: { error?: string; message?: string } | string };
    message?: string;
  };
  const status = e?.response?.status;
  const data = e?.response?.data;
  const body = typeof data === 'object' && data ? data : undefined;
  const server = body?.message || body?.error;
  if (status === 413) {
    const size = file ? ` (${(file.size / MB).toFixed(1)} MB)` : '';
    return `File too large${size}. ${server && server !== 'payload_too_large' ? server : 'The server or network limit was exceeded.'}`;
  }
  if (status === 400 && server && /type not allowed/i.test(server)) {
    return `Format not supported: ${file?.type || file?.name || 'unknown'}. Use jpeg, png, gif, webp, avif or svg.`;
  }
  if (status === 401) return 'You need to be signed in to upload.';
  if (server) return server;
  if (status) return `Upload failed (HTTP ${status}).`;
  return e?.message || 'Upload failed.';
}
