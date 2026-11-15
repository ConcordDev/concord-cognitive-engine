import Link from 'next/link';

/**
 * Middleware rewrites a missing or private /dtu/:id here with status 404.
 * This route has to exist. A rewrite to a path with no page came back as
 * an invalid response, so Chrome said the site could not be reached.
 */
export default function DtuNotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-lattice-void text-white px-4">
      <div className="text-center max-w-md">
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <h2 className="text-lg text-gray-300 mb-4">This thought unit is not available</h2>
        <p className="text-sm text-gray-400 mb-8">
          It is missing, or it belongs to another account. A public thought unit still opens on its own page.
        </p>
        <Link
          href="/hub"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/30 transition-colors text-sm font-medium"
        >
          Back to the hub
        </Link>
      </div>
    </div>
  );
}
