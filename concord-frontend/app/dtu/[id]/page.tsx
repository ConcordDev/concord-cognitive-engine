import { Metadata } from 'next';
import { PublicDTUView } from './PublicDTUView';

/**
 * Public DTU Sharing Page — /dtu/[id]
 *
 * Read-only view of a DTU accessible without login.
 * Generates OG metadata from DTU content for social sharing.
 * Server-side data fetch for SEO + generateMetadata.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function fetchDTU(id: string) {
  try {
    const res = await fetch(`${API_BASE}/api/dtus/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.dtu || data || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const dtu = await fetchDTU(id);

  if (!dtu) {
    return {
      title: 'DTU Not Found | Concord OS',
      description: 'This thought unit could not be found.',
    };
  }

  const title = dtu.title || dtu.name || 'Untitled DTU';
  const description =
    (typeof dtu.content === 'string' ? dtu.content : dtu.summary || dtu.description || '').slice(
      0,
      200
    ) || 'A thought unit on Concord OS';
  const tierLabel = dtu.tier ? `${dtu.tier.toUpperCase()} DTU` : 'DTU';

  return {
    title: `${title} | ${tierLabel} | Concord OS`,
    description,
    openGraph: {
      title: `${title} — ${tierLabel}`,
      description,
      type: 'article',
      siteName: 'Concord OS',
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} — ${tierLabel}`,
      description,
      images: ['/og-image.png'],
    },
  };
}

export default async function PublicDTUPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let dtu = null;
  let fetchError: string | null = null;
  try {
    dtu = await fetchDTU(id);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to load';
  }

  if (fetchError) {
    return <div className="p-8 text-center text-red-400">Error: {fetchError}</div>;
  }

  return <PublicDTUView dtu={dtu} dtuId={id} />;
}
