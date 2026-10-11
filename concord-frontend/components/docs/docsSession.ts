'use client';

import { publishableFromPage } from './pageBody';
import type { Page, PageMeta } from './types';

export interface DocsWorkspaceSnapshot {
  pages: PageMeta[];
  active: Page | null;
}

const EMPTY: DocsWorkspaceSnapshot = { pages: [], active: null };
let snap: DocsWorkspaceSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function setDocsWorkspaceSnapshot(next: DocsWorkspaceSnapshot): void {
  snap = next;
  for (const listener of listeners) listener();
}

export function getDocsWorkspaceSnapshot(): DocsWorkspaceSnapshot {
  return snap;
}

export function subscribeDocsWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Title and body of the page open in the docs workspace, or null. */
export function getDocsPublishable(): { title: string; content: string } | null {
  return publishableFromPage(snap.active);
}

export function resetDocsWorkspaceSnapshot(): void {
  setDocsWorkspaceSnapshot(EMPTY);
}
