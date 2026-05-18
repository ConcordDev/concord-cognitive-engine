/**
 * /d/[slug] — public published-document route.
 *
 * Docs published via the Share panel get a /d/<slug> URL anyone can
 * read without auth. Server-rendered for SEO; the `docs.get_by_slug`
 * macro lives on Gate 2's publicReadDomains so anonymous traffic
 * reaches it.
 */

import { notFound } from 'next/navigation';
import { headers } from 'next/headers';

interface PageProps { params: Promise<{ slug: string }>; }

async function fetchDoc(slug: string) {
  const hdrs = await headers();
  const host = hdrs.get('host') || 'localhost:3000';
  const proto = hdrs.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const apiBase = process.env.NEXT_PUBLIC_API_URL || `${proto}://${host}`;
  try {
    const r = await fetch(`${apiBase}/api/lens/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'docs', name: 'get_by_slug', input: { slug } }),
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.result?.document || j?.document || null;
  } catch {
    return null;
  }
}

export default async function PublishedDocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = await fetchDoc(slug);
  if (!doc) notFound();

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <article className="prose prose-invert max-w-none">
          <h1 className="text-3xl font-bold mb-4">{doc.title}</h1>
          <div
            className="leading-relaxed"
            // Trusted source — content was authored on-platform; the
            // BlockEditor's allowed marks are constrained. Public docs
            // are an opt-in by the author.
            dangerouslySetInnerHTML={{ __html: doc.content_html || '' }}
          />
        </article>
        <footer className="mt-12 pt-6 border-t border-white/10 text-xs text-white/40">
          Published via Concord — <a href="/lenses/docs" className="hover:text-cyan-400">make your own</a>
        </footer>
      </div>
    </main>
  );
}
