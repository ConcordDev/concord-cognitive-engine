'use client';

import dynamic from 'next/dynamic';

const Page = dynamic(() => import('./page-client'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-[40vh] text-sm text-gray-400">
      Loading ar lens…
    </div>
  ),
});

export default function ArLensRoute() {
  return <Page />;
}
