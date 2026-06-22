'use client';

// components/legal/LegalMarkdown.tsx
//
// Shared renderer for Concord's legal/policy documents. Authors write plain
// markdown (easy for a non-dev / lawyer to edit); this renders it with the
// legal prose styling used across /legal/*. Uses the react-markdown + remark-gfm
// already in the dependency tree (see components/chat/MessageRenderer.tsx).

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function LegalMarkdown({ title, updated, children }: {
  title: string;
  updated?: string;
  children: string;
}) {
  return (
    <article className="max-w-none">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-100">{title}</h1>
      {updated && <p className="mb-6 text-xs text-zinc-400">Last updated: {updated}</p>}
      <div className="legal-prose space-y-4 text-sm leading-relaxed text-zinc-300
        [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100
        [&_h3]:mt-5 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-zinc-200
        [&_p]:my-3
        [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1
        [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1
        [&_a]:text-neon-cyan [&_a:hover]:underline
        [&_strong]:text-zinc-100
        [&_code]:rounded [&_code]:bg-lattice-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]
        [&_table]:my-4 [&_table]:w-full [&_table]:text-left [&_table]:text-xs
        [&_th]:border-b [&_th]:border-lattice-border [&_th]:py-2 [&_th]:pr-4 [&_th]:font-semibold [&_th]:text-zinc-200
        [&_td]:border-b [&_td]:border-lattice-border/50 [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top
        [&_blockquote]:border-l-2 [&_blockquote]:border-neon-cyan/40 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
      </div>
    </article>
  );
}

export default LegalMarkdown;
