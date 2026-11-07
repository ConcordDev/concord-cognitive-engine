'use client';

/**
 * fmMarkdown — forum's import path for the shared markdown renderer.
 * The renderer was promoted to components/shared/fmMarkdown
 * (build(message) S6, GB-1093 shared-first) so the forum and message
 * lenses render through one component; this module re-exports it so
 * forum's callers keep their import path and behaviour exactly.
 */

export { FmMarkdown } from '@/components/shared/fmMarkdown';
