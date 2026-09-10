'use client';

import { AnswersQA } from '@/components/answers/AnswersQA';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { ds } from '@/lib/design-system';

/** Stack Overflow / Quora-shaped Q&A workbench — was stacked under oracle. */
export function QaWorkbenchPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Q&amp;A workspace</h2>
        <p className={ds.textMuted}>Ask, answer, vote, tags, moderation — answers.* macros.</p>
      </div>
      <LensFeedButton domain="answers" />
      <AnswersQA />
    </div>
  );
}
