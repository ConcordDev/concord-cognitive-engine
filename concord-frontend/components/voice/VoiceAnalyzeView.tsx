'use client';

import { PipingProvider } from '@/components/panel-polish';
import { VoiceActionPanel } from '@/components/voice/VoiceActionPanel';

export function VoiceAnalyzeView() {
  return (
    <PipingProvider>
      <VoiceActionPanel />
    </PipingProvider>
  );
}
