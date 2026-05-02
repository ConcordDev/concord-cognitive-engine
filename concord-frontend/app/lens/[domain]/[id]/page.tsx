import { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

/**
 * Public Lens Artifact Page — /lens/[domain]/[id]
 *
 * Shareable URL for any lens artifact. Generates OG metadata so links
 * shared on social media show proper title, description, and preview.
 * Redirects authenticated users to the actual lens page.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://concord-os.org';

async function fetchArtifact(domain: string, id: string) {
  try {
    const res = await fetch(`${API_BASE}/api/lens/${domain}/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.artifact || data || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string; id: string }>;
}): Promise<Metadata> {
  const { domain, id } = await params;
  const artifact = await fetchArtifact(domain, id);

  const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);

  if (!artifact) {
    return {
      title: `${domainLabel} | Concord OS`,
      description: `Content from the ${domainLabel} lens on Concord OS.`,
    };
  }

  const title = artifact.title || artifact.data?.title || 'Untitled';
  const description = (
    artifact.data?.description ||
    artifact.data?.summary ||
    artifact.data?.content ||
    (typeof artifact.data === 'string' ? artifact.data : '') ||
    `${artifact.type || 'Content'} from the ${domainLabel} lens`
  ).slice(0, 200);

  const typeLabel = artifact.type
    ? artifact.type.charAt(0).toUpperCase() + artifact.type.slice(1)
    : 'Content';

  return {
    title: `${title} | ${domainLabel} ${typeLabel} | Concord OS`,
    description,
    openGraph: {
      title: `${title} — ${domainLabel}`,
      description,
      type: 'article',
      siteName: 'Concord OS',
      url: `${SITE_URL}/lens/${domain}/${id}`,
      images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} — ${domainLabel}`,
      description,
    },
  };
}

export default async function PublicLensArtifactPage({
  params,
}: {
  params: Promise<{ domain: string; id: string }>;
}) {
  const { domain, id } = await params;

  let artifact = null;
  let fetchError: string | null = null;
  try {
    artifact = await fetchArtifact(domain, id);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to load';
  }

  if (fetchError) {
    return <div className="p-8 text-center text-red-400">Error: {fetchError}</div>;
  }

  // If the artifact specifies a redirect (e.g., content moved to another lens), follow it
  if (artifact?.redirect) {
    redirect(artifact.redirect);
  }

  // If the artifact has a canonical lens URL, redirect authenticated users there
  if (artifact?.canonicalUrl) {
    redirect(artifact.canonicalUrl);
  }

  if (!artifact) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto">
            <svg
              className="w-8 h-8 text-zinc-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white">Not Found</h1>
          <p className="text-sm text-zinc-500">
            This content may have been removed or is no longer available.
          </p>
          <Link
            href="/lenses/feed"
            className="inline-block px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 text-sm hover:bg-cyan-500/30 transition-colors"
          >
            Explore Feed
          </Link>
        </div>
      </main>
    );
  }

  const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
  const title = artifact.title || artifact.data?.title || 'Untitled';
  const description = artifact.data?.description || artifact.data?.summary || '';
  const typeLabel = artifact.type
    ? artifact.type.charAt(0).toUpperCase() + artifact.type.slice(1)
    : 'Content';
  const source = artifact.data?.source || artifact.data?.sourceLens || null;
  const tags = artifact.meta?.tags || [];
  const createdAt = artifact.createdAt
    ? new Date(artifact.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
      <article className="max-w-2xl w-full space-y-6">
        {/* Badge row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded text-xs bg-cyan-500/20 text-cyan-400 font-medium">
            {domainLabel}
          </span>
          <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-400">{typeLabel}</span>
          {source && (
            <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-500">
              from {source}
            </span>
          )}
          {createdAt && <span className="text-xs text-zinc-600 ml-auto">{createdAt}</span>}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-white leading-tight">{title}</h1>

        {/* Description */}
        {description && <p className="text-zinc-400 text-sm leading-relaxed">{description}</p>}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags
              .filter((t: string) => !t.startsWith('stance:') && t !== 'auto_event')
              .slice(0, 10)
              .map((tag: string) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-xs bg-zinc-800/80 text-zinc-500"
                >
                  {tag}
                </span>
              ))}
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center gap-3 pt-4 border-t border-zinc-800">
          <Link
            href={`/lenses/${domain}`}
            className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 text-sm font-medium hover:bg-cyan-500/30 transition-colors"
          >
            Open in {domainLabel} Lens
          </Link>
          <Link
            href="/lenses/feed"
            className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:bg-zinc-700 transition-colors"
          >
            Explore Feed
          </Link>
        </div>

        {/* Branding */}
        <p className="text-[10px] text-zinc-700 pt-4">
          Shared via Concord OS — Sovereign Cognitive Engine
        </p>
      </article>
    </main>
  );
}
