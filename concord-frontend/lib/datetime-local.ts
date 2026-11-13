/**
 * Value for <input type="datetime-local">.
 * The control requires YYYY-MM-DDTHH:mm. A longer year (52026) is the
 * segmented-field bug: keep the previous valid value instead of storing it.
 */
export function datetimeLocalValue(raw: string): string | null {
  const v = String(raw || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}
