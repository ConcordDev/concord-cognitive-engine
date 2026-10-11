import { api } from '@/lib/api/client';

export function deleteWhiteboard(id: string) {
  return api.delete(`/api/whiteboard/${encodeURIComponent(id)}`);
}

export function renameWhiteboard(id: string, title: string) {
  return api.patch(`/api/whiteboard/${encodeURIComponent(id)}`, { title });
}

/** Honest note for an owner-gated board mutation. Never claims the board changed. */
export function ownerMutationNote(status: number | undefined, fallback: string): string {
  if (status === 403) return 'Only the owner can change this board.';
  if (status === 404) return 'That board is not on the server.';
  if (status === 400) return 'A board name is required.';
  return fallback;
}

export function axiosStatus(err: unknown): number | undefined {
  const response = (err as { response?: { status?: number } } | null)?.response;
  return typeof response?.status === 'number' ? response.status : undefined;
}
