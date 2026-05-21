# studio — Feature Gap vs Ableton Live

Category leader (2026): Ableton Live (full DAW). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `studio` domain — 40+ macros (project/track/clip/effect/midi-notes/automation/renders/markers/tempo/presets/sends/scenes CRUD + bounce + dashboard). Real client-side Web Audio engine (SynthEngine, AudioRecorder).

## Has (verified in code)
- Multi-view DAW: Session view (Ableton-style, default), arrange, mixer, piano-roll (2786-line page).
- In-browser synth engine with presets, audio tracks, effect chains; mixer with sends.
- Clip/scene model — scenes-create / scenes-launch (Session-view clip launching).
- MIDI note editing (piano roll), automation lanes + points, tempo changes, markers.
- Live mic recording via MediaRecorder, save recording as a DTU + audio track.
- Bounce/render to audio, render list; transport shortcuts (Logic/Ableton idiom).
- World-soundscape bridge — DAW playback broadcasts to in-world soundscape slot.

## Missing — buildable feature backlog
- [ ] `[L]` Audio clip editing — warping/time-stretch, slicing, fades on the audio editor (buffer state exists but editor is thin).
- [ ] `[M]` Sampler / drum-rack instrument with pad triggering and sample mapping.
- [ ] `[M]` More effects — EQ, compressor, reverb, delay with real DSP nodes and visual editors.
- [ ] `[M]` MIDI controller input (Web MIDI API) for live playing and recording.
- [ ] `[M]` Audio quantization / groove and MIDI quantize.
- [ ] `[S]` Metronome, count-in, loop-recording with takes/comping.
- [ ] `[M]` Stem/multi-track export and project file import/export.
- [ ] `[L]` Real-time collaboration on a project.

## Parity
~60% of Ableton Live. Genuinely a working browser DAW — Session view, synths, mixer, MIDI, automation, recording, bounce — but it is light on real DSP effects, sampling/drum-racks, audio warping, and MIDI-hardware input.
