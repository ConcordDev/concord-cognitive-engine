# voice — Feature Completeness Spec

Rival app(s): Otter.ai, Whisper (2026)
Sources:
- https://otter.ai/ (recordings, live transcription, speaker labels, highlights, summary + action items, search, folders)
- https://openai.com/research/whisper (speech-to-text)

Previously the voice domain was analysis-only (transcript analyze,
diarize, sentiment, keyword spot). This spec covers the new recording /
transcript substrate.

## Features

### Recordings & transcripts
- [x] Create a recording — from structured segments or a raw transcript (sentence-split) (macro: voice.recording-create)
- [x] List recordings — folder filter, speaker + highlight counts (macro: voice.recording-list)
- [x] Recording detail with the full speaker-labelled transcript (macro: voice.recording-detail)
- [x] Rename / re-folder a recording (macro: voice.recording-rename)
- [x] Delete a recording (macro: voice.recording-delete)

### Transcript editing
- [x] Edit a segment's text or speaker — invalidates a stale summary (macro: voice.segment-edit)
- [x] Highlight / un-highlight a segment (macro: voice.highlight-toggle)

### Intelligence
- [x] Recording summary — deterministic key points (highlights or longest segments) + action items from action cues (macro: voice.recording-summary)
- [x] Cross-recording transcript search (macro: voice.transcript-search)
- [x] Voice dashboard — recordings, minutes, segments, highlights, folders (macro: voice.voice-dashboard)

### Analysis (retained)
- [x] Transcript analysis (macro: voice.transcriptAnalyze)
- [x] Speaker diarization (macro: voice.speakerDiarize)
- [x] Sentiment scoring (macro: voice.sentimentScore)
- [x] Keyword spotting (macro: voice.keywordSpot)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live in-browser speech-to-text | a Whisper/ASR model + audio stream | recordings are created from pasted or structured transcripts; the existing `VoiceRecorder` captures audio, this substrate stores the transcript |
| LLM-written meeting summary | the subconscious brain | deterministic summary — highlights/longest segments as key points, action-cue detection for action items |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/voice.js` clean. 14 macros
  (4 analysis + 10 recording/transcript substrate).
- 2026-05-20: Tests — `tests/voice-domain-parity.test.js` 11/11 green
  (recording CRUD + per-user scope + transcript-split + rename/delete /
  segment edit invalidates summary / highlight toggle / summary action-item
  extraction + highlights-as-keypoints / search / dashboard / analysis intact).
- 2026-05-20: Frontend — new `VoiceTranscripts` workspace (recording list,
  speaker-labelled editable transcript with highlights, summary panel,
  cross-recording search) mounted in the voice lens page. `npx tsc --noEmit`
  exit 0.
