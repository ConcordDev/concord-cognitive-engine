// server/domains/neuro.js
// Domain actions for neuroscience: EEG signal processing, connectivity
// analysis, frequency band decomposition, and neural activation mapping.

export default function registerNeuroActions(registerLensAction) {
  /**
   * frequencyAnalysis
   * Decompose neural signals into standard frequency bands and compute
   * power spectral density using FFT.
   * artifact.data.signal = { samples: number[], sampleRate: number, channel?: string }
   * or artifact.data.channels = [{ name, samples, sampleRate }]
   */
  registerLensAction("neuro", "frequencyAnalysis", (ctx, artifact, _params) => {
    const channels = artifact.data?.channels ||
      (artifact.data?.signal ? [{ name: artifact.data.signal.channel || "CH1", ...artifact.data.signal }] : []);

    if (channels.length === 0) return { ok: false, error: "No signal data. Expected channels or signal." };

    // Radix-2 FFT (Cooley-Tukey)
    function fft(re, im) {
      const n = re.length;
      if (n <= 1) return;
      // Bit-reversal permutation
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          [re[i], re[j]] = [re[j], re[i]];
          [im[i], im[j]] = [im[j], im[i]];
        }
      }
      for (let len = 2; len <= n; len *= 2) {
        const ang = -2 * Math.PI / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let curRe = 1, curIm = 0;
          for (let j = 0; j < len / 2; j++) {
            const uRe = re[i + j], uIm = im[i + j];
            const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
            const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
            re[i + j] = uRe + vRe;
            im[i + j] = uIm + vIm;
            re[i + j + len / 2] = uRe - vRe;
            im[i + j + len / 2] = uIm - vIm;
            const newCurRe = curRe * wRe - curIm * wIm;
            curIm = curRe * wIm + curIm * wRe;
            curRe = newCurRe;
          }
        }
      }
    }

    // Standard EEG bands
    const bands = {
      delta: { min: 0.5, max: 4, label: "Delta (0.5-4 Hz)", association: "deep sleep" },
      theta: { min: 4, max: 8, label: "Theta (4-8 Hz)", association: "drowsiness, meditation" },
      alpha: { min: 8, max: 13, label: "Alpha (8-13 Hz)", association: "relaxed wakefulness" },
      beta: { min: 13, max: 30, label: "Beta (13-30 Hz)", association: "active thinking, focus" },
      gamma: { min: 30, max: 100, label: "Gamma (30-100 Hz)", association: "higher cognition, binding" },
    };

    const results = channels.map(ch => {
      const samples = ch.samples || [];
      const sampleRate = ch.sampleRate || 256;

      // Pad to next power of 2
      let n = 1;
      while (n < samples.length) n *= 2;
      const re = new Float64Array(n);
      const im = new Float64Array(n);

      // Apply Hanning window
      for (let i = 0; i < samples.length; i++) {
        const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (samples.length - 1)));
        re[i] = samples[i] * window;
      }

      fft(re, im);

      // Compute power spectrum (magnitude squared, single-sided)
      const freqBins = n / 2;
      const freqRes = sampleRate / n;
      const psd = new Float64Array(freqBins);
      for (let i = 0; i < freqBins; i++) {
        psd[i] = (re[i] * re[i] + im[i] * im[i]) / (n * n);
        if (i > 0 && i < freqBins - 1) psd[i] *= 2; // single-sided correction
      }

      // Band power computation
      const bandPower = {};
      let totalPower = 0;
      for (let i = 0; i < freqBins; i++) totalPower += psd[i];

      for (const [name, band] of Object.entries(bands)) {
        const minBin = Math.max(0, Math.floor(band.min / freqRes));
        const maxBin = Math.min(freqBins - 1, Math.ceil(band.max / freqRes));
        let power = 0;
        for (let i = minBin; i <= maxBin; i++) power += psd[i];
        bandPower[name] = {
          absolutePower: Math.round(power * 1e6) / 1e6,
          relativePower: totalPower > 0 ? Math.round((power / totalPower) * 10000) / 100 : 0,
          label: band.label,
          association: band.association,
        };
      }

      // Dominant frequency
      let peakBin = 0;
      for (let i = 1; i < freqBins; i++) {
        if (psd[i] > psd[peakBin]) peakBin = i;
      }
      const peakFreq = Math.round(peakBin * freqRes * 100) / 100;

      // Alpha/Beta ratio (arousal index)
      const alphaP = bandPower.alpha.absolutePower;
      const betaP = bandPower.beta.absolutePower;
      const alphaBetaRatio = betaP > 0 ? Math.round((alphaP / betaP) * 1000) / 1000 : Infinity;

      // Theta/Beta ratio (attention index — elevated in ADHD)
      const thetaP = bandPower.theta.absolutePower;
      const thetaBetaRatio = betaP > 0 ? Math.round((thetaP / betaP) * 1000) / 1000 : Infinity;

      // Dominant band
      const dominant = Object.entries(bandPower).sort((a, b) => b[1].relativePower - a[1].relativePower)[0];

      return {
        channel: ch.name,
        sampleRate, sampleCount: samples.length,
        bands: bandPower,
        peakFrequency: peakFreq,
        totalPower: Math.round(totalPower * 1e6) / 1e6,
        dominantBand: { name: dominant[0], ...dominant[1] },
        indices: {
          alphaBetaRatio,
          thetaBetaRatio,
          arousalLevel: alphaBetaRatio > 2 ? "relaxed" : alphaBetaRatio > 1 ? "moderate" : "alert",
          attentionIndex: thetaBetaRatio > 3 ? "low" : thetaBetaRatio > 1.5 ? "moderate" : "high",
        },
      };
    });

    return { ok: true, result: { channels: results, channelCount: results.length } };
  });

  /**
   * connectivityAnalysis
   * Compute functional connectivity between channels using cross-correlation
   * and coherence estimates.
   * artifact.data.channels = [{ name, samples, sampleRate }]
   */
  registerLensAction("neuro", "connectivityAnalysis", (ctx, artifact, _params) => {
    const channels = artifact.data?.channels || [];
    if (channels.length < 2) return { ok: false, error: "Need at least 2 channels for connectivity analysis." };
    if (channels.length > 32) return { ok: false, error: "Limited to 32 channels." };

    const n = channels.length;
    const correlationMatrix = Array.from({ length: n }, () => new Array(n).fill(0));
    const connections = [];

    for (let i = 0; i < n; i++) {
      correlationMatrix[i][i] = 1.0;
      for (let j = i + 1; j < n; j++) {
        const a = channels[i].samples || [];
        const b = channels[j].samples || [];
        const len = Math.min(a.length, b.length);
        if (len === 0) continue;

        // Pearson correlation
        let sumA = 0, sumB = 0;
        for (let k = 0; k < len; k++) { sumA += a[k]; sumB += b[k]; }
        const meanA = sumA / len, meanB = sumB / len;
        let covAB = 0, varA = 0, varB = 0;
        for (let k = 0; k < len; k++) {
          const da = a[k] - meanA, db = b[k] - meanB;
          covAB += da * db;
          varA += da * da;
          varB += db * db;
        }
        const correlation = (varA > 0 && varB > 0)
          ? covAB / Math.sqrt(varA * varB)
          : 0;

        correlationMatrix[i][j] = Math.round(correlation * 10000) / 10000;
        correlationMatrix[j][i] = correlationMatrix[i][j];

        // Cross-correlation peak lag (for directionality estimation)
        let maxCorr = 0, bestLag = 0;
        const maxLag = Math.min(50, Math.floor(len / 4));
        for (let lag = -maxLag; lag <= maxLag; lag++) {
          let sum = 0, count = 0;
          for (let k = 0; k < len; k++) {
            const kLag = k + lag;
            if (kLag >= 0 && kLag < len) {
              sum += (a[k] - meanA) * (b[kLag] - meanB);
              count++;
            }
          }
          const cc = count > 0 ? sum / (count * Math.sqrt(varA / len) * Math.sqrt(varB / len)) : 0;
          if (Math.abs(cc) > Math.abs(maxCorr)) {
            maxCorr = cc;
            bestLag = lag;
          }
        }

        const strength = Math.abs(correlation);
        if (strength > 0.3) {
          connections.push({
            from: channels[i].name, to: channels[j].name,
            correlation: Math.round(correlation * 10000) / 10000,
            peakLag: bestLag,
            directionality: bestLag > 0 ? `${channels[i].name} → ${channels[j].name}` : bestLag < 0 ? `${channels[j].name} → ${channels[i].name}` : "bidirectional",
            strength: strength > 0.7 ? "strong" : strength > 0.5 ? "moderate" : "weak",
          });
        }
      }
    }

    connections.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

    // Network metrics
    const avgConnectivity = connections.length > 0
      ? Math.round(connections.reduce((s, c) => s + Math.abs(c.correlation), 0) / connections.length * 10000) / 10000
      : 0;
    const density = n > 1
      ? Math.round((connections.length / (n * (n - 1) / 2)) * 10000) / 100
      : 0;

    // Hub detection (most connected channels)
    const hubScores = {};
    for (const ch of channels) hubScores[ch.name] = 0;
    for (const conn of connections) {
      hubScores[conn.from] += Math.abs(conn.correlation);
      hubScores[conn.to] += Math.abs(conn.correlation);
    }
    const hubs = Object.entries(hubScores)
      .map(([name, score]) => ({ channel: name, connectivityScore: Math.round(score * 1000) / 1000 }))
      .sort((a, b) => b.connectivityScore - a.connectivityScore);

    return {
      ok: true, result: {
        channelCount: n,
        correlationMatrix: { labels: channels.map(c => c.name), matrix: correlationMatrix },
        significantConnections: connections.slice(0, 30),
        totalConnections: connections.length,
        networkMetrics: { averageConnectivity: avgConnectivity, density, strongConnections: connections.filter(c => c.strength === "strong").length },
        hubs: hubs.slice(0, 5),
      },
    };
  });

  /**
   * erpAnalysis
   * Event-Related Potential (ERP) analysis: average epochs, detect peaks
   * (P100, N170, P300, N400, etc.), and compute signal-to-noise ratio.
   * artifact.data.epochs = [{ samples: number[], onset: number }]
   * artifact.data.sampleRate
   */
  registerLensAction("neuro", "erpAnalysis", (ctx, artifact, _params) => {
    const epochs = artifact.data?.epochs || [];
    const sampleRate = artifact.data?.sampleRate || 256;
    if (epochs.length === 0) return { ok: false, error: "No epoch data." };

    const epochLen = epochs[0].samples?.length || 0;
    if (epochLen === 0) return { ok: false, error: "Empty epoch samples." };

    // Grand average ERP
    const avg = new Float64Array(epochLen);
    for (const epoch of epochs) {
      const samples = epoch.samples || [];
      for (let i = 0; i < Math.min(epochLen, samples.length); i++) {
        avg[i] += samples[i];
      }
    }
    for (let i = 0; i < epochLen; i++) avg[i] /= epochs.length;

    // Standard error
    const se = new Float64Array(epochLen);
    for (const epoch of epochs) {
      const samples = epoch.samples || [];
      for (let i = 0; i < Math.min(epochLen, samples.length); i++) {
        se[i] += Math.pow(samples[i] - avg[i], 2);
      }
    }
    for (let i = 0; i < epochLen; i++) {
      se[i] = Math.sqrt(se[i] / (epochs.length * (epochs.length - 1)));
    }

    // SNR: peak amplitude / noise floor RMS
    const baselineSamples = Math.min(Math.floor(sampleRate * 0.1), Math.floor(epochLen / 4));
    let baselineRms = 0;
    for (let i = 0; i < baselineSamples; i++) baselineRms += avg[i] * avg[i];
    baselineRms = Math.sqrt(baselineRms / Math.max(baselineSamples, 1));
    const peakAmplitude = Math.max(...avg.map(Math.abs));
    const snr = baselineRms > 0 ? Math.round((peakAmplitude / baselineRms) * 100) / 100 : Infinity;

    // Peak detection: find local maxima/minima in the average
    const peaks = [];
    const msPerSample = 1000 / sampleRate;

    for (let i = 2; i < epochLen - 2; i++) {
      const isMax = avg[i] > avg[i - 1] && avg[i] > avg[i + 1] && avg[i] > avg[i - 2] && avg[i] > avg[i + 2];
      const isMin = avg[i] < avg[i - 1] && avg[i] < avg[i + 1] && avg[i] < avg[i - 2] && avg[i] < avg[i + 2];
      if (!isMax && !isMin) continue;

      const latencyMs = Math.round(i * msPerSample);
      const amplitude = Math.round(avg[i] * 1000) / 1000;

      // Try to classify known ERP components
      let component = null;
      if (isMax && latencyMs >= 80 && latencyMs <= 130) component = "P100";
      else if (isMin && latencyMs >= 130 && latencyMs <= 200) component = "N170";
      else if (isMax && latencyMs >= 250 && latencyMs <= 400) component = "P300";
      else if (isMin && latencyMs >= 350 && latencyMs <= 500) component = "N400";
      else if (isMax && latencyMs >= 500 && latencyMs <= 700) component = "P600";
      else if (isMin && latencyMs >= 50 && latencyMs <= 100) component = "N100";

      if (Math.abs(amplitude) > baselineRms * 1.5) { // only include significant peaks
        peaks.push({
          latencyMs, amplitude, polarity: isMax ? "positive" : "negative",
          component, sampleIndex: i,
          standardError: Math.round(se[i] * 1000) / 1000,
        });
      }
    }

    peaks.sort((a, b) => a.latencyMs - b.latencyMs);

    return {
      ok: true, result: {
        epochCount: epochs.length, epochLength: epochLen,
        sampleRate, durationMs: Math.round(epochLen * msPerSample),
        grandAverage: Array.from(avg).map(v => Math.round(v * 1000) / 1000),
        peaks: peaks.slice(0, 15),
        snr, snrQuality: snr > 10 ? "excellent" : snr > 5 ? "good" : snr > 2 ? "acceptable" : "poor",
        baselineRms: Math.round(baselineRms * 1000) / 1000,
        peakAmplitude: Math.round(peakAmplitude * 1000) / 1000,
        identifiedComponents: peaks.filter(p => p.component).map(p => ({
          component: p.component, latencyMs: p.latencyMs, amplitude: p.amplitude,
        })),
      },
    };
  });
}
