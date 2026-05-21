# neuro — Feature Gap vs EEGLAB / MNE-Python

Category leader (2026): EEGLAB / MNE-Python (neuroscience signal analysis). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/neuro.js` — 3 macros: frequencyAnalysis, connectivityAnalysis, erpAnalysis + NeuroFeed, arXiv + PubMed + Wikipedia research panels.

## Has (verified in code)
- Frequency analysis — spectral decomposition of neural signal data (delta/theta/alpha/beta/gamma bands)
- Connectivity analysis — inter-region/inter-channel connectivity measures
- ERP analysis — event-related potential extraction and characterization
- Networks/neurons/training/datasets/experiments/metrics tabs with typed artifacts
- Research feeds — arXiv, PubMed, Wikipedia panels; NeuroFeed
- Realtime feed, DTU export

## Missing — buildable feature backlog
- [ ] `[L]` Signal data import — load EEG/MEG recordings (EDF/FIF/CSV) into the lens
- [ ] `[M]` Time-series / waveform viewer — scroll and inspect raw channel traces
- [ ] `[M]` Topographic scalp maps — render spatial activity across electrodes
- [ ] `[M]` Preprocessing pipeline — filtering, artifact rejection, ICA, re-referencing
- [ ] `[M]` Epoching — segment continuous data around events for ERP averaging
- [ ] `[S]` Time-frequency plots — spectrograms / wavelet maps
- [ ] `[M]` Source localization — estimate cortical sources from sensor data
- [ ] `[S]` Statistical testing across conditions/groups

## Parity
~35% of an EEG-analysis toolkit. The analysis macros (frequency, connectivity, ERP) are real computational primitives, but missing signal import, waveform/topomap visualization, the preprocessing pipeline, and epoching that make EEGLAB/MNE a working neuroscience workbench.
