'use client';

/**
 * VoiceOtterSuite — Otter.ai-parity feature surface for the voice lens.
 * A tabbed panel exposing live in-browser transcription, the recording
 * studio (AI summary, timestamped playback, share + comments, multi-language
 * translation), automatic speaker identification (voice-prints), and the
 * meeting-bot calendar. Every panel wires real voice.* macros — no mock data.
 */

import { useCallback, useState } from 'react';
import { Radio, FileAudio, Fingerprint, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceLiveTranscribe } from './VoiceLiveTranscribe';
import { VoiceRecordingStudio } from './VoiceRecordingStudio';
import { VoiceprintEnroll } from './VoiceprintEnroll';
import { VoiceMeetings } from './VoiceMeetings';

type Tab = 'live' | 'studio' | 'voiceprint' | 'meetings';

const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: 'live', label: 'Live transcription', icon: Radio },
  { id: 'studio', label: 'Recording studio', icon: FileAudio },
  { id: 'voiceprint', label: 'Speaker ID', icon: Fingerprint },
  { id: 'meetings', label: 'Meeting bot', icon: CalendarClock },
];

export function VoiceOtterSuite() {
  const [tab, setTab] = useState<Tab>('live');
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <h3 className="text-sm font-bold text-zinc-100 mr-2">Meeting intelligence</h3>
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('px-2.5 py-1 text-xs rounded-lg inline-flex items-center gap-1 border',
                tab === t.id
                  ? 'bg-sky-600/15 border-sky-700/50 text-sky-200'
                  : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3 h-3" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === 'live' && <VoiceLiveTranscribe onFinalized={bumpRefresh} />}
      {tab === 'studio' && <VoiceRecordingStudio refreshKey={refreshKey} />}
      {tab === 'voiceprint' && <VoiceprintEnroll />}
      {tab === 'meetings' && <VoiceMeetings onRecorded={bumpRefresh} />}
    </div>
  );
}
