import { redirect } from 'next/navigation';

/**
 * GB-1536: the brain-mode screen is no longer a forced post-signup
 * step — brain mode defaults to Private and is chosen in Settings
 * (profile → Settings, next to UniverseSettings). This route remains
 * only as a redirect for stale links/bookmarks; middleware also 308s
 * it to /hub before the auth check.
 */
export default function BrainModePage() {
  redirect('/hub');
}
