/** Query string for POST /api/media/upload-raw — a canvas artwork save (FIX-art-003). */
export function rawArtUploadQuery(args: { title: string; filename: string; tags?: string[] }): string {
  const q = new URLSearchParams({
    title: args.title,
    filename: args.filename,
    mediaType: 'image',
  });
  if (args.tags?.length) q.set('tags', args.tags.join(','));
  return q.toString();
}

const MB = 1024 * 1024;

/** A readable, specific message for a failed artwork save (never a bare status code). */
export function describeArtUploadError(err: unknown, file?: { size: number }): string {
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
    return `Artwork too large${size}. ${server && server !== 'payload_too_large' ? server : 'The upload size limit was exceeded — try a smaller canvas.'}`;
  }
  if (status === 401) return 'You need to be signed in to save artwork.';
  if (server) return server;
  if (status) return `Save failed (HTTP ${status}).`;
  return e?.message || 'Failed to save artwork';
}
