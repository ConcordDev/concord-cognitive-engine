'use client';

import dynamic from 'next/dynamic';

const RecipeAuthorPanel = dynamic(
  () => import('@/components/concordia/recipes/RecipeAuthorPanel'),
  { ssr: false }
);

export function AuthorPanel({ onPublished }: { onPublished: () => void }) {
  return (
    <section className="flex justify-center">
      <RecipeAuthorPanel onPublished={onPublished} />
    </section>
  );
}
