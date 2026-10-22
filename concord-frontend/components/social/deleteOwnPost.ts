import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

function failureMessage(err: unknown, data?: { error?: string; message?: string } | null): string {
  if (data?.error) return String(data.error);
  if (data?.message) return String(data.message);
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { error?: string; message?: string }; status?: number } }).response;
    if (resp?.data?.error) return String(resp.data.error);
    if (resp?.data?.message) return String(resp.data.message);
    if (resp?.status) return `Could not delete this post (${resp.status})`;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Could not delete this post.';
}

/** DELETE /api/social/post/:id. Resolves only after the server answers. */
export async function deleteOwnPost(postId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await api.delete<{ ok?: boolean; error?: string; message?: string }>(
      `/api/social/post/${encodeURIComponent(postId)}`,
    );
    if (res.data?.ok === false) {
      const error = failureMessage(null, res.data);
      useUIStore.getState().addToast({ type: 'error', message: error });
      return { ok: false, error };
    }
    useUIStore.getState().addToast({ type: 'success', message: 'Post deleted.' });
    return { ok: true };
  } catch (err) {
    const error = failureMessage(err);
    useUIStore.getState().addToast({ type: 'error', message: error });
    return { ok: false, error };
  }
}
