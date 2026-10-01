/**
 * Time-of-day greeting for the chat empty canvas.
 * Hours are local to the browser. No name → greeting without a comma.
 */

export function titleCaseDisplayName(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getTimeOfDayGreeting(name: string | null | undefined, now: Date = new Date()): string {
  const h = now.getHours();
  const who = titleCaseDisplayName(name);
  const late = h >= 22 || h < 5;
  if (late) return who ? `Up late, ${who}?` : 'Up late?';
  const lead = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return who ? `${lead}, ${who}` : lead;
}
