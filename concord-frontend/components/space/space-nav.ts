/** Space lens view union — one nav machine for the thin shell. */
export type SpaceView =
  | 'dashboard'
  | 'missions'
  | 'satellites'
  | 'launchops'
  | 'telemetry'
  | 'crew'
  | 'debris'
  | 'planning'
  | 'observatory'
  | 'news'
  | 'launches'
  | 'wiki';

export const SPACE_ARTIFACT_VIEWS = [
  'missions',
  'satellites',
  'launchops',
  'telemetry',
  'crew',
  'debris',
] as const;

export type SpaceArtifactView = (typeof SPACE_ARTIFACT_VIEWS)[number];

/** Map nav id → personal-tracker artifact type (Planning uses calculators, not CRUD). */
export function artifactTypeForView(view: SpaceArtifactView | 'dashboard'): string {
  const map: Record<string, string> = {
    dashboard: 'Mission',
    missions: 'Mission',
    satellites: 'Satellite',
    launchops: 'Launch',
    telemetry: 'Telemetry',
    crew: 'Crew',
    debris: 'Debris',
  };
  return map[view] ?? 'Mission';
}
