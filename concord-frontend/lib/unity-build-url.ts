/**
 * Where the Unity WebGL build is served from (PF-10 — serve builds from
 * R2/CDN).
 *
 * Until PF-10 the player candidates were hand-rolled in two components and
 * builds were same-origin only: the committed export under
 * public/unity-client, probed via /unity-client/index.html. Setting
 * NEXT_PUBLIC_UNITY_BUILD_BASE_URL to the CDN base of a published build
 * (e.g. https://cdn.example/builds/<sha>/ — the P0-04 asset rail's push
 * target) puts that build's index.html between the explicit override and
 * the same-origin fallback: the shell probes it first, and the iframe then
 * loads the build's Build/ assets from the CDN origin, because Unity's
 * template resolves them relative to the index.
 *
 * The base is validated, never trusted: anything that is not an absolute
 * http(s) URL without credentials, query, or hash resolves to null and the
 * candidates fall back to exactly today's list — a bad value can never
 * produce a mangled player URL.
 */

export type UnityBuildEnv = Record<string, string | undefined>;

/** The same-origin player, as before PF-10. */
export const UNITY_SAME_ORIGIN_INDEX = '/unity-client/index.html';

export function resolveUnityBuildBaseUrl(env: UnityBuildEnv): string | null {
  const raw = (env.NEXT_PUBLIC_UNITY_BUILD_BASE_URL || '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${pathname}`;
}

/**
 * Ordered player candidates: the explicit UNITY_WEBGL_URL override, then
 * the configured CDN build, then the same-origin export. Deduped, empties
 * dropped — with no base configured this is exactly the pre-PF-10 list.
 */
export function unityPlayerCandidatesFromEnv(env: UnityBuildEnv): string[] {
  const override =
    env.NEXT_PUBLIC_UNITY_WEBGL_URL || env.NEXT_PUBLIC_CONCORDIA_UNITY_URL || '';
  const base = resolveUnityBuildBaseUrl(env);
  const list = [override, base ? `${base}index.html` : '', UNITY_SAME_ORIGIN_INDEX];
  return list.filter((u, i, arr) => Boolean(u) && arr.indexOf(u) === i);
}

/**
 * The candidates for this build of the frontend. NEXT_PUBLIC_* values are
 * inlined at build time only as literal member accesses, so they are read
 * here, in one place, rather than passed in as a whole env object.
 */
export function unityPlayerCandidates(): string[] {
  return unityPlayerCandidatesFromEnv({
    NEXT_PUBLIC_UNITY_WEBGL_URL: process.env.NEXT_PUBLIC_UNITY_WEBGL_URL,
    NEXT_PUBLIC_CONCORDIA_UNITY_URL: process.env.NEXT_PUBLIC_CONCORDIA_UNITY_URL,
    NEXT_PUBLIC_UNITY_BUILD_BASE_URL: process.env.NEXT_PUBLIC_UNITY_BUILD_BASE_URL,
  });
}
