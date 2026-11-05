/** One status list. live is today on a confirmed event. completed is the engine's complete. */

export const EVENT_STATUS_WORDS = ['planning', 'confirmed', 'live', 'completed', 'cancelled'] as const;

export function statusToEngine(word: string): string {
  if (word === 'live') return 'confirmed';
  if (word === 'completed') return 'complete';
  return word;
}

export function statusFromEngine(engine: string, date: string | null | undefined, today: string): string {
  if (engine === 'complete') return 'completed';
  const day = typeof date === 'string' ? date.slice(0, 10) : '';
  if (engine === 'confirmed' && day && day === today) return 'live';
  return engine;
}
