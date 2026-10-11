import type { ComponentProps } from 'react';
import { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicDTUView } from './PublicDTUView';
import { fetchOwnerDtu } from '@/lib/dtu/public-fetch';

/**
 * Public DTU page — /dtu/[id]
 *
 * Server fetch goes to the backend with the viewer's cookies and a 5s
 * timeout. A miss or a timeout calls notFound() so the owner is not
 * shown "DTU Not Found" after a 60s hang, and everyone else gets the
 * app 404 page.
 */

async function loadDtu(id: string) {
  const jar = await cookies();
  return fetchOwnerDtu(id, jar.toString());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { dtu } = await loadDtu(id);

  if (!dtu) {
    return {
      title: 'DTU Not Found | Concord OS',
      description: 'This thought unit could not be found.',
    };
  }

  const title = (typeof dtu.title === 'string' && dtu.title) || (typeof dtu.name === 'string' && dtu.name) || 'Untitled DTU';
  const description =
    (typeof dtu.content === 'string' ? dtu.content : typeof dtu.summary === 'string' ? dtu.summary : '').slice(0, 200)
    || 'A thought unit on Concord OS';
  const tierLabel = typeof dtu.tier === 'string' ? `${dtu.tier.toUpperCase()} DTU` : 'DTU';

  return {
    title: `${title} | ${tierLabel} | Concord OS`,
    description,
    openGraph: {
      title: `${title} — ${tierLabel}`,
      description,
      type: 'article',
      siteName: 'Concord OS',
      images: [{ url: '/og-image.png', width: 1200, height: 630, alt: title }],
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
  const { dtu, status } = await loadDtu(id);
  if (!dtu || status === 404) notFound();
  return <PublicDTUView dtu={dtu as unknown as ComponentProps<typeof PublicDTUView>['dtu']} dtuId={id} />;
}
