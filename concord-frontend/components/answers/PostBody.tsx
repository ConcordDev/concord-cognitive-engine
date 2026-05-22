'use client';

/**
 * PostBody — renders a question/answer body, switching between plain
 * whitespace-preserving text and rendered markdown depending on the
 * stored bodyFormat.
 */

import { MarkdownView } from './RichMarkdownEditor';

interface PostBodyProps {
  body: string;
  bodyFormat?: string;
}

export function PostBody({ body, bodyFormat }: PostBodyProps) {
  if (bodyFormat === 'markdown') return <MarkdownView body={body} />;
  return <p className="text-sm text-zinc-300 whitespace-pre-wrap">{body}</p>;
}
