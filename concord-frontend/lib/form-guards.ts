/** Shared length and URL checks. Callers show the string and do not save. */

export const SCENE_LOCATION_MAX = 120;
export const TOURNAMENT_TITLE_MAX = 120;
export const ARTIFACT_TITLE_MAX = 200;
export const API_KEY_MAX = 256;
export const FORGE_APP_NAME_MAX = 64;

export function sceneLocationError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'A location is required.';
  if (trimmed.length > SCENE_LOCATION_MAX) {
    return `Location must be ${SCENE_LOCATION_MAX} characters or fewer.`;
  }
  return null;
}

export function tournamentTitleError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'A title is required.';
  if (trimmed.length > TOURNAMENT_TITLE_MAX) {
    return `Title must be ${TOURNAMENT_TITLE_MAX} characters or fewer.`;
  }
  return null;
}

export function artifactTitleError(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length > ARTIFACT_TITLE_MAX) {
    return `Title must be ${ARTIFACT_TITLE_MAX} characters or fewer.`;
  }
  return null;
}

/** Absolute http(s) only. A bare word is not a relative page path. Empty is allowed. */
export function absoluteHttpUrlError(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return 'Enter an http or https link.';
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return 'Enter an http or https link.';
  }
  return null;
}

/** Webhooks must be https. Plain http and unparseable text are refused. */
export function httpsUrlError(raw: string): string | null {
  const u = raw.trim();
  if (!u) return 'A URL is required.';
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return 'Enter an https URL.';
  }
  if (parsed.protocol === 'http:') return 'Use an https URL.';
  if (parsed.protocol !== 'https:' || !parsed.hostname) return 'Enter an https URL.';
  return null;
}

export function apiKeyError(raw: string, opts?: { allowBlank?: boolean }): string | null {
  const key = raw.trim();
  if (!key) {
    return opts?.allowBlank
      ? null
      : 'API key must be at least 8 characters. Paste it from your provider\'s dashboard.';
  }
  if (/\s/.test(key)) return 'API key cannot contain spaces.';
  if (key.length < 8) {
    return 'API key must be at least 8 characters. Paste it from your provider\'s dashboard.';
  }
  if (key.length > API_KEY_MAX) return `API key must be ${API_KEY_MAX} characters or fewer.`;
  return null;
}

/** Comma-separated labels. "x, y" stays two terms. */
export function parseCsvList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function dependencyPctError(raw: string): string | null {
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n) || n < 0 || n > 100) {
    return 'Dependency must be between 0 and 100.';
  }
  return null;
}
