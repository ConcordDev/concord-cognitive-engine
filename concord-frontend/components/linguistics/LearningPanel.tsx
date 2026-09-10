'use client';

/**
 * LearningPanel — vocabulary, quiz, progress, decks, word tools.
 * Folded from the Word Learning accordion on the linguistics page.
 */

import { useCallback, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { VocabularyBuilder } from '@/components/linguistics/VocabularyBuilder';
import { QuizEngine } from '@/components/linguistics/QuizEngine';
import { ProgressDashboard } from '@/components/linguistics/ProgressDashboard';
import { WordDecks } from '@/components/linguistics/WordDecks';
import { WordTools } from '@/components/linguistics/WordTools';

export function LearningPanel() {
  const [vocabRefresh, setVocabRefresh] = useState(0);
  const bumpVocab = useCallback(() => setVocabRefresh((n) => n + 1), []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <GraduationCap className="w-4 h-4 text-indigo-400" />
        Word Learning
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VocabularyBuilder refreshKey={vocabRefresh} onChange={bumpVocab} />
        <ProgressDashboard refreshKey={vocabRefresh} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QuizEngine onComplete={bumpVocab} />
        <WordDecks onImported={bumpVocab} />
      </div>
      <WordTools />
    </div>
  );
}
