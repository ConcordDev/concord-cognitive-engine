# voice — Feature Gap vs Otter.ai

Category leader (2026): Otter.ai (recording + transcription + meeting intelligence). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `voice` domain (`server/domains/voice.js`) — **38 macros** (re-verified 2026-07-11, Wave 3 audit; the earlier "14 macros: 4 analysis + 10 recording/transcript substrate" was a stale undercount — `grep -c 'registerLensAction("voice"' server/domains/voice.js`): 4 text-analysis calculators (transcriptAnalyze/speakerDiarize/sentimentScore/keywordSpot) + 10 recording CRUD/summary/search + 5 live in-browser transcription + 1 LLM summary + 5 voice-print speaker ID + 5 meeting-bot calendar integration + 6 share/comments + 2 multi-language translation. Real audio transcription (whisper.cpp) and TTS (Piper) are SEPARATE macros registered directly on `server.js` (`register("voice","transcribe"/"tts"/"ingest", ...)`, reached via `apiHelpers.voice.transcribe`/`.tts`/`.ingest` → `/api/voice/{transcribe,tts,ingest}` → bare `runMacro`), not part of the 38 in `domains/voice.js`. Full detail + a fixed security defect: `docs/lens-specs/voice-capability-map.md`.

## Has (verified in code)
- Real audio capture — `VoiceRecorder` uses `getUserMedia` + `MediaRecorder` (webm), transcribe via `apiHelpers.voice.transcribe`.
- Recording CRUD — create (from segments or raw transcript), list (folder filter), detail (speaker-labelled transcript), rename/re-folder, delete.
- Transcript editing — edit segment text/speaker (invalidates stale summary), highlight toggle.
- Recording summary — deterministic key points + action items from action cues.
- Cross-recording transcript search; voice dashboard (recordings/minutes/segments/highlights/folders).
- Retained analysis — transcript analysis, speaker diarization, sentiment scoring, keyword spotting.
- VoiceTranscripts workspace UI.

## Missing — buildable feature backlog
- [x] `[M]` Live in-browser transcription — stream audio to ASR and show words as they're spoken (Otter's signature).
- [x] `[M]` LLM-written meeting summary — currently deterministic; route through the subconscious brain (opt-in).
- [x] `[S]` Automatic speaker identification (voice-print) vs manual speaker labels.
- [x] `[M]` Calendar / meeting-bot integration — auto-join and record meetings.
- [x] `[S]` Timestamped playback synced to the transcript (click a line, jump audio).
- [x] `[S]` Share a recording with collaborators + comment on segments.
- [x] `[M]` Multi-language transcription and translation.

## Parity
~95% of Otter.ai. Recording, transcript editing, highlights, summaries, search plus live in-browser transcription, LLM meeting summaries, automatic speaker identification, meeting-bot integration, timestamped synced playback, collaborator sharing with comments, and multi-language translation all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
