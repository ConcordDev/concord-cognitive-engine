import { Metadata } from 'next';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Newsletter Public View                                             */
/*  Renders a post as a shareable newsletter-style read-only page.     */
/*  Full email integration requires SMTP service                       */
/*  (SendGrid/Mailgun/Postmark). Currently generates shareable link.   */
/* ------------------------------------------------------------------ */

interface NewsletterPageProps {
  params: Promise<{ postId: string }>;
}

export async function generateMetadata({ params }: NewsletterPageProps): Promise<Metadata> {
  const { postId } = await params;
  // Fetch post metadata for OG tags
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  let title = 'Newsletter';
  let description = 'A newsletter post from Concord';

  try {
    const res = await fetch(`${baseUrl}/api/social/post/${postId}`, { next: { revalidate: 60 } });
    if (res.ok) {
      const data = await res.json();
      if (data.post) {
        title = data.post.title || title;
        description = (data.post.content || '').slice(0, 160) || description;
      }
    }
  } catch {
    // Fallback to defaults
  }

  return {
    title: `${title} | Concord Newsletter`,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Concord',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

async function getPost(postId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  try {
    const res = await fetch(`${baseUrl}/api/social/post/${postId}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.post || null;
  } catch {
    return null;
  }
}

export default async function NewsletterPage({ params }: NewsletterPageProps) {
  const { postId } = await params;
  const post = await getPost(postId);

  if (!post) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Newsletter not found</h1>
          <p className="text-gray-500 text-sm">
            This newsletter post may have been removed or is no longer public.
          </p>
        </div>
      </div>
    );
  }

  const publishDate = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Newsletter header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 mb-2">
            Newsletter
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">
            {post.title}
          </h1>
          <div className="flex items-center justify-center gap-3 mt-4 text-sm text-gray-500">
            {post.authorName && <span>By {post.authorName}</span>}
            {publishDate && (
              <>
                <span className="text-gray-300">|</span>
                <time>{publishDate}</time>
              </>
            )}
          </div>
          {post.tags?.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {post.tags.map((tag: string) => (
                <span key={tag} className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Newsletter body */}
      <main className="max-w-2xl mx-auto px-6 py-10">
        <article className="prose prose-lg prose-gray max-w-none">
          {/* Render content with paragraphs */}
          {(post.content || '').split('\n\n').map((paragraph: string, i: number) => (
            <p key={i} className="text-gray-700 leading-relaxed mb-4">
              {paragraph}
            </p>
          ))}
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-2xl mx-auto px-6 py-6 text-center text-xs text-gray-400">
          <p>Published via Concord Cognitive Engine</p>
          <p className="mt-1">
            <Link href="/" className="text-indigo-500 hover:text-indigo-600">
              Visit Concord
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
