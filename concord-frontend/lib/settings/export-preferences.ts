/**
 * Build a download of the preference set `settings.get` actually returned.
 * Callers must not substitute schema defaults when the read fails — that
 * would ship a file of zeros (or defaults) labeled as the user's settings.
 */

export interface PreferenceExportRun {
  (domain: string, name: string, input: Record<string, unknown>): Promise<{
    data?: {
      ok?: boolean;
      result?: { prefs?: Record<string, unknown> } | null;
      error?: string | null;
    };
  }>;
}

export type PreferenceExport =
  | { ok: true; filename: string; body: string; prefs: Record<string, unknown> }
  | { ok: false; reason: string };

export async function loadPreferenceExport(run: PreferenceExportRun, now = new Date()): Promise<PreferenceExport> {
  let response: Awaited<ReturnType<PreferenceExportRun>>;
  try {
    response = await run('settings', 'get', {});
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'saved preferences did not load' };
  }
  const prefs = response.data?.ok ? response.data.result?.prefs : null;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
    return { ok: false, reason: response.data?.error || 'saved preferences did not load' };
  }
  const day = now.toISOString().slice(0, 10);
  return {
    ok: true,
    filename: `concord-settings-${day}.json`,
    body: JSON.stringify(prefs, null, 2),
    prefs,
  };
}
