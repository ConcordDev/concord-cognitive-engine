/** Post stays available when the optional note is blank. It is off only while the post is in flight. */
export function lfgPostDisabled(busy: string | null): boolean {
  return busy === 'post';
}
