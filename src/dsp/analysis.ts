import type {
  ActivityClassification,
  ActivityFrame,
  ActivityInferenceResult,
  DeviceMetadataSnapshot,
  EnvironmentalFingerprint,
  FeatureFrame,
  FingerprintComparison,
  InputMode,
} from '../types/acoustic';
import { powerToDbfs } from './metrics';

const LOG_BAND_COUNT = 32;

export function computeLogBandEdges(
  minHz: number,
  maxHz: number,
  bandCount = LOG_BAND_COUNT
): Array<{ lowHz: number; centerHz: number; highHz: number }> {
  const safeMin = Math.max(20, minHz);
  const safeMax = Math.max(safeMin * 2, maxHz);
  const logMin = Math.log(safeMin);
  const logMax = Math.log(safeMax);
  const edges: Array<{ lowHz: number; centerHz: number; highHz: number }> = [];

  for (let b = 0; b < bandCount; b++) {
    const lowHz = Math.exp(logMin + ((logMax - logMin) * b) / bandCount);
    const highHz = Math.exp(logMin + ((logMax - logMin) * (b + 1)) / bandCount);
    const centerHz = Math.sqrt(lowHz * highHz);
    edges.push({ lowHz, centerHz, highHz });
  }
  return edges;
}

/**
 * Assign every FFT bin to at most one log band. Band powers are therefore
 * disjoint: no bin is counted twice, and bands narrower than one bin simply
 * contain no bins (their power is reported as the -120 dBFS floor).
 */
export function buildLogBandBinMap(
  fftSize: number,
  sampleRate: number,
  bandEdges: Array<{ lowHz: number; highHz: number }>
): Int16Array {
  const binCount = Math.floor(fftSize / 2) + 1;
  const binToBand = new Int16Array(binCount).fill(-1);
  const binWidth = sampleRate / fftSize;
  const nyquist = sampleRate / 2;

  for (let k = 1; k < binCount; k++) {
    const freq = k * binWidth;
    for (let b = 0; b < bandEdges.length; b++) {
      const isLast = b === bandEdges.length - 1;
      const inBand = isLast
        ? freq >= bandEdges[b].lowHz && freq <= nyquist
        : freq >= bandEdges[b].lowHz && freq < bandEdges[b].highHz;
      if (inBand) {
        binToBand[k] = b;
        break;
      }
    }
  }

  return binToBand;
}

export function buildEnvironmentalFingerprint(
  frames: FeatureFrame[],
  label: string,
  sourceMode: InputMode
): EnvironmentalFingerprint {
  if (frames.length === 0) {
    throw new Error('Cannot build environmental fingerprint from 0 frames.');
  }

  // Only frames on the first frame's analysis grid are comparable. Mixing
  // sample rates or FFT sizes inside one fingerprint would silently average
  // incommensurable band edges, so mismatched frames are excluded and counted.
  const grid = frames[0];
  const usable = frames.filter(
    (f) => f.sampleRate === grid.sampleRate && f.fftSize === grid.fftSize
  );
  const excludedFrameCount = frames.length - usable.length;

  const first = usable[0];
  const last = usable[usable.length - 1];
  const sampleRate = first.sampleRate;
  const fftSize = first.fftSize;
  const nyquist = sampleRate / 2;
  const bandEdges = computeLogBandEdges(20, nyquist, LOG_BAND_COUNT);
  const binToBand = buildLogBandBinMap(fftSize, sampleRate, bandEdges);

  const n = usable.length;
  const rmsValues = usable.map((f) => f.rmsDbfs).sort((a, b) => a - b);
  const floorIdx = Math.max(0, Math.floor(0.1 * (n - 1)));
  const noiseFloorDbfs = rmsValues[floorIdx];

  let sumRmsDb = 0;
  let maxPeakDb = -120;
  let sumCentroid = 0;
  let sumBandwidth = 0;
  let sumFlatness = 0;
  let sumZcr = 0;
  let sumLow = 0;
  let sumMid = 0;
  let sumHigh = 0;

  const bandPowerAccum = new Float64Array(LOG_BAND_COUNT);

  for (let i = 0; i < n; i++) {
    const f = usable[i];
    sumRmsDb += f.rmsDbfs;
    if (f.peakDbfs > maxPeakDb) maxPeakDb = f.peakDbfs;
    sumCentroid += f.spectralCentroidHz;
    sumBandwidth += f.spectralBandwidthHz;
    sumFlatness += f.spectralFlatness;
    sumZcr += f.zeroCrossingRate;
    sumLow += f.bandEnergy.lowRatio;
    sumMid += f.bandEnergy.midRatio;
    sumHigh += f.bandEnergy.highRatio;

    // Accumulate power into 32 log bands, one band per FFT bin (disjoint).
    const binLimit = Math.min(f.powerSpectrum.length, binToBand.length);
    for (let k = 1; k < binLimit; k++) {
      const band = binToBand[k];
      if (band >= 0) {
        bandPowerAccum[band] += f.powerSpectrum[k];
      }
    }
  }

  const meanRmsDbfs = sumRmsDb / n;
  let sqDiff = 0;
  for (let i = 0; i < n; i++) {
    const d = usable[i].rmsDbfs - meanRmsDbfs;
    sqDiff += d * d;
  }
  const rmsStdDevDb = Math.sqrt(sqDiff / n);

  const logBandCentersHz: number[] = [];
  const logBandDbfs: number[] = [];
  const meanBandPower: number[] = [];
  let totalLogPower = 0;

  for (let b = 0; b < LOG_BAND_COUNT; b++) {
    const meanP = bandPowerAccum[b] / n;
    meanBandPower.push(meanP);
    totalLogPower += meanP;
    logBandCentersHz.push(bandEdges[b].centerHz);
    logBandDbfs.push(powerToDbfs(meanP));
  }

  // A silent window has no spectral evidence. Emitting an all-zero
  // distribution (instead of a uniform one) stops two empty windows from
  // looking identical to a cosine-similarity comparison.
  const logBandDistribution = meanBandPower.map((p) =>
    totalLogPower > 1e-14 ? p / totalLogPower : 0
  );

  const durationSec = Math.max(
    0.05,
    (last.timestampMs - first.timestampMs) / 1000
  );

  return {
    id: `fp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    capturedAtIso: new Date().toISOString(),
    durationSec,
    frameCount: n,
    sampleRate,
    fftSize,
    sourceMode,
    meanRmsDbfs,
    rmsStdDevDb,
    noiseFloorDbfs,
    peakDbfsMax: maxPeakDb,
    meanCentroidHz: sumCentroid / n,
    meanBandwidthHz: sumBandwidth / n,
    meanFlatness: sumFlatness / n,
    meanZcr: sumZcr / n,
    meanBandEnergy: {
      lowRatio: sumLow / n,
      midRatio: sumMid / n,
      highRatio: sumHigh / n,
    },
    logBandCentersHz,
    logBandDbfs,
    logBandDistribution,
    excludedFrameCount,
  };
}

export function compareFingerprints(
  a: EnvironmentalFingerprint,
  b: EnvironmentalFingerprint
): FingerprintComparison {
  const len = Math.min(
    a.logBandDistribution.length,
    b.logBandDistribution.length
  );

  let dot = 0;
  let normA = 0;
  let normB = 0;
  let sqDiffDb = 0;
  const perBandDeltaDb: number[] = [];

  for (let i = 0; i < len; i++) {
    const va = a.logBandDistribution[i];
    const vb = b.logBandDistribution[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;

    const deltaDb = b.logBandDbfs[i] - a.logBandDbfs[i];
    perBandDeltaDb.push(deltaDb);
    sqDiffDb += deltaDb * deltaDb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  const cosineSimilarity = denom > 1e-12 ? Math.min(1, Math.max(0, dot / denom)) : 0;
  const spectralDistanceDb = len > 0 ? Math.sqrt(sqDiffDb / len) : 0;
  const noiseFloorDeltaDb = b.noiseFloorDbfs - a.noiseFloorDbfs;
  const centroidDeltaHz = b.meanCentroidHz - a.meanCentroidHz;
  const flatnessDelta = b.meanFlatness - a.meanFlatness;

  const bandDeltas = {
    lowDeltaPct: (b.meanBandEnergy.lowRatio - a.meanBandEnergy.lowRatio) * 100,
    midDeltaPct: (b.meanBandEnergy.midRatio - a.meanBandEnergy.midRatio) * 100,
    highDeltaPct: (b.meanBandEnergy.highRatio - a.meanBandEnergy.highRatio) * 100,
  };

  const minFrames = Math.min(a.frameCount, b.frameCount);

  // Two profiles are only comparable when they were measured on the same
  // analysis grid and both contain measurable spectral energy.
  const incompatibilityReasons: string[] = [];
  if (a.sampleRate !== b.sampleRate) {
    incompatibilityReasons.push(
      `Sample rates differ (${a.sampleRate} Hz vs ${b.sampleRate} Hz), so the log-band edges are not aligned.`
    );
  }
  if (a.fftSize !== b.fftSize) {
    incompatibilityReasons.push(
      `FFT sizes differ (${a.fftSize} vs ${b.fftSize}), so spectral resolution differs between windows.`
    );
  }
  if (a.logBandCentersHz.length !== b.logBandCentersHz.length) {
    incompatibilityReasons.push(
      `Band counts differ (${a.logBandCentersHz.length} vs ${b.logBandCentersHz.length}).`
    );
  }
  const energyA = a.logBandDistribution.reduce((s, v) => s + v, 0);
  const energyB = b.logBandDistribution.reduce((s, v) => s + v, 0);
  if (energyA <= 1e-9 || energyB <= 1e-9) {
    incompatibilityReasons.push(
      'At least one window contains no measurable spectral power, so there is no spectral evidence to compare.'
    );
  }
  const comparable = incompatibilityReasons.length === 0;

  const confidenceLabel: 'Low' | 'Moderate' | 'High' = !comparable
    ? 'Low'
    : minFrames >= 60
      ? 'High'
      : minFrames >= 25
        ? 'Moderate'
        : 'Low';

  let interpretation: string;
  if (!comparable) {
    interpretation = `NOT COMPARABLE — no similarity score is reported. ${incompatibilityReasons.join(
      ' '
    )} Re-capture both windows from the same input source with the same sample rate and FFT size.`;
  } else if (cosineSimilarity >= 0.92 && Math.abs(noiseFloorDeltaDb) < 4) {
    interpretation =
      'High spectral-shape alignment and comparable noise floor between the two windows. Consistent with stable ambient acoustics or similar signal sources, though NOT proof of identical physical location or hardware.';
  } else if (cosineSimilarity >= 0.75) {
    interpretation =
      'Moderate spectral overlap with measurable shifts in band balance or background noise floor. Could reflect transient activity changes, HVAC cycling, microphone repositioning, or a distinct environment.';
  } else {
    interpretation =
      'Substantial divergence in spectral energy distribution between Snapshot A and Snapshot B, indicating changed acoustic sources, altered room/microphone state, or different environments.';
  }

  const limitations = [
    'Similarity is NOT proof of a unique physical location, room, or user identity.',
    'Two different quiet rooms with similar HVAC or laptop fan noise can exhibit cosine similarity > 0.90.',
    'The same room with a window opened, fan toggled, or microphone moved can exhibit low similarity.',
    'Browser automatic gain control (AGC) and noise suppression alter absolute noise floors and spectral tilt.',
    `Comparison computed across ${LOG_BAND_COUNT} log-spaced bands (${minFrames} minimum frames per window).`,
    'Each FFT bin belongs to exactly one log band, so band powers do not overlap; bands narrower than one bin carry no bins and read as the -120 dBFS floor.',
    'The Low/Moderate/High confidence label is a frame-count heuristic (25 and 60 frames), not a validated statistical confidence interval.',
  ];

  return {
    cosineSimilarity,
    spectralDistanceDb,
    noiseFloorDeltaDb,
    centroidDeltaHz,
    flatnessDelta,
    bandDeltas,
    perBandDeltaDb,
    comparable,
    incompatibilityReasons,
    confidenceLabel,
    interpretation,
    limitations,
  };
}

/**
 * Transparent heuristic classifier for Experiment B — Activity Inference.
 * Evaluates a short rolling buffer of recent frames (typically 1.5–4 seconds).
 */
export function inferBroadActivity(
  frames: ActivityFrame[],
  activityThresholdDbfs = -50
): ActivityInferenceResult {
  if (frames.length === 0) {
    return {
      windowDurationSec: 0,
      frameCount: 0,
      dominantState: 'No Signal Window',
      classifications: [],
      detectedPeriodHz: null,
      periodicityStrength: 0,
      transientCount: 0,
    };
  }

  const n = frames.length;
  const windowDurationSec = Math.max(
    0.05,
    (frames[n - 1].timestampMs - frames[0].timestampMs) / 1000
  );

  let sumRmsDb = 0;
  let sumFlatness = 0;
  let sumBandwidth = 0;
  let sumCrest = 0;
  let activeCount = 0;
  let transientCount = 0;
  let maxJumpDb = 0;
  const domFreqs: number[] = [];

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    sumRmsDb += f.rmsDbfs;
    sumFlatness += f.spectralFlatness;
    sumBandwidth += f.spectralBandwidthHz;
    sumCrest += f.crestFactorDb;
    if (f.isActive || f.rmsDbfs >= activityThresholdDbfs) {
      activeCount++;
      domFreqs.push(f.dominantFrequencyHz);
    }
    const jumpDb = i > 0 ? f.rmsDbfs - frames[i - 1].rmsDbfs : 0;
    if (jumpDb > maxJumpDb) maxJumpDb = jumpDb;
    if (f.crestFactorDb >= 11 || jumpDb >= 7) {
      transientCount++;
    }
  }

  const meanRmsDb = sumRmsDb / n;
  const meanFlatness = sumFlatness / n;
  const meanBandwidth = sumBandwidth / n;
  const meanCrest = sumCrest / n;
  const activeRatio = activeCount / n;

  // Dominant frequency stability across active frames
  let domFreqStd = 0;
  let meanDomFreq = 0;
  if (domFreqs.length > 1) {
    meanDomFreq = domFreqs.reduce((a, b) => a + b, 0) / domFreqs.length;
    const varSum = domFreqs.reduce((acc, f) => acc + (f - meanDomFreq) ** 2, 0);
    domFreqStd = Math.sqrt(varSum / domFreqs.length);
  } else if (domFreqs.length === 1) {
    meanDomFreq = domFreqs[0];
  }
  const domFreqCv = meanDomFreq > 20 ? domFreqStd / meanDomFreq : 1;

  // Envelope periodicity via normalized autocorrelation on linear RMS envelope
  let detectedPeriodHz: number | null = null;
  let periodicityStrength = 0;
  if (n >= 24 && windowDurationSec >= 0.8) {
    const dt = windowDurationSec / (n - 1);
    const rmsArr = frames.map((f) => f.rms);
    const meanRms = rmsArr.reduce((a, b) => a + b, 0) / n;
    const centered = rmsArr.map((v) => v - meanRms);
    let zeroLag = 0;
    for (let i = 0; i < n; i++) zeroLag += centered[i] * centered[i];

    const rmsStd = Math.sqrt(zeroLag / n);
    // Require meaningful amplitude modulation above noise floor
    if (zeroLag > 1e-10 && rmsStd > meanRms * 0.12) {
      const minLag = Math.max(2, Math.floor(0.08 / dt)); // up to ~12.5 Hz
      const maxLag = Math.min(Math.floor(n * 0.6), Math.ceil(1.5 / dt)); // down to ~0.67 Hz
      let bestLag = -1;
      let bestCorr = 0;

      for (let lag = minLag; lag <= maxLag; lag++) {
        let num = 0;
        let denA = 0;
        let denB = 0;
        for (let i = 0; i < n - lag; i++) {
          num += centered[i] * centered[i + lag];
          denA += centered[i] * centered[i];
          denB += centered[i + lag] * centered[i + lag];
        }
        const den = Math.sqrt(denA * denB);
        const corr = den > 1e-12 ? num / den : 0;
        if (corr > bestCorr) {
          bestCorr = corr;
          bestLag = lag;
        }
      }

      periodicityStrength = Math.max(0, bestCorr);
      if (bestLag > 0 && bestCorr >= 0.42) {
        detectedPeriodHz = 1 / (bestLag * dt);
      }
    }
  }

  const isQuiet = activeRatio < 0.25 && meanRmsDb < activityThresholdDbfs;
  const isTonal =
    !isQuiet &&
    activeRatio >= 0.4 &&
    meanFlatness < 0.18 &&
    domFreqCv < 0.18 &&
    meanDomFreq > 20;
  const isBroadband =
    !isQuiet &&
    meanFlatness >= 0.32 &&
    meanBandwidth >= 1100 &&
    meanCrest < 11.5;
  const isTransient = transientCount >= Math.max(1, Math.floor(n * 0.06)) || maxJumpDb >= 7.5;
  const isRepetitive =
    detectedPeriodHz !== null &&
    periodicityStrength >= 0.42 &&
    (isTransient || transientCount > 0 || meanCrest >= 7);

  const classifications: ActivityClassification[] = [
    {
      id: 'quiet',
      label: 'Relative Quiet',
      detected: isQuiet,
      confidence: isQuiet && meanRmsDb < activityThresholdDbfs - 8 ? 'high' : isQuiet ? 'moderate' : 'low',
      measuredEvidence: `Mean RMS ${meanRmsDb.toFixed(1)} dBFS, Active frames ${(activeRatio * 100).toFixed(0)}%`,
      thresholdRule: `Mean RMS < ${activityThresholdDbfs.toFixed(0)} dBFS AND active fraction < 25%`,
      reasoning: isQuiet
        ? 'Signal energy remains below the configured activity threshold with minimal transient excursions.'
        : 'Signal exceeds the quiet threshold or exhibits frequent active frames.',
    },
    {
      id: 'sustained_tonal',
      label: 'Sustained Tonal Activity',
      detected: isTonal,
      confidence: isTonal && meanFlatness < 0.08 && domFreqCv < 0.06 ? 'high' : isTonal ? 'moderate' : 'low',
      measuredEvidence: `Flatness ${meanFlatness.toFixed(3)}, Dom. Freq ${meanDomFreq.toFixed(1)} Hz (CV ${(domFreqCv * 100).toFixed(1)}%)`,
      thresholdRule: 'Active >= 40%, Spectral Flatness < 0.18, Dominant Freq CV < 18%',
      reasoning: isTonal
        ? `Energy is concentrated in narrowband spectral peaks around ${meanDomFreq.toFixed(0)} Hz with stable pitch/frequency.`
        : 'Spectrum lacks a persistent narrowband peak (either quiet, broadband, or rapidly varying).',
    },
    {
      id: 'broadband_noise',
      label: 'Broadband Noise',
      detected: isBroadband,
      confidence: isBroadband && meanFlatness >= 0.45 ? 'high' : isBroadband ? 'moderate' : 'low',
      measuredEvidence: `Flatness ${meanFlatness.toFixed(3)}, Bandwidth ${meanBandwidth.toFixed(0)} Hz, Crest ${meanCrest.toFixed(1)} dB`,
      thresholdRule: 'Active, Flatness >= 0.32, Bandwidth >= 1100 Hz, Crest < 11.5 dB',
      reasoning: isBroadband
        ? 'Acoustic energy is spread broadly across frequency bins without dominant tonal concentration.'
        : 'Signal is either below threshold, dominated by narrowband tones, or dominated by sharp impulses.',
    },
    {
      id: 'transient_impulse',
      label: 'Transient / Impulsive Sounds',
      detected: isTransient,
      confidence: isTransient && (meanCrest >= 12 || transientCount >= 3) ? 'high' : isTransient ? 'moderate' : 'low',
      measuredEvidence: `Transient frames ${transientCount}/${n}, Max onset jump +${maxJumpDb.toFixed(1)} dB, Mean crest ${meanCrest.toFixed(1)} dB`,
      thresholdRule: 'Crest factor >= 11 dB OR frame-to-frame RMS jump >= +7 dB',
      reasoning: isTransient
        ? 'Detected abrupt amplitude spikes or high peak-to-RMS ratios characteristic of impulsive acoustic events.'
        : 'Amplitude envelope varies smoothly without high-crest impulsive peaks.',
    },
    {
      id: 'repetitive_events',
      label: 'Repetitive Acoustic Events',
      detected: isRepetitive,
      confidence: isRepetitive && periodicityStrength >= 0.65 ? 'high' : isRepetitive ? 'moderate' : 'low',
      measuredEvidence: detectedPeriodHz
        ? `Periodicity r=${periodicityStrength.toFixed(2)} at ~${detectedPeriodHz.toFixed(2)} Hz`
        : `Max envelope autocorrelation r=${periodicityStrength.toFixed(2)}`,
      thresholdRule: 'RMS envelope autocorrelation r >= 0.42 across 0.7–12.5 Hz lags with impulsive modulation',
      reasoning: isRepetitive && detectedPeriodHz
        ? `Amplitude envelope repeats regularly at approximately ${detectedPeriodHz.toFixed(2)} events/sec.`
        : 'No statistically consistent periodic repetition detected in the rolling RMS envelope.',
    },
  ];

  const activeLabels = classifications.filter((c) => c.detected).map((c) => c.label);
  const dominantState =
    activeLabels.length > 0 ? activeLabels.join(' + ') : 'Mixed / Unclassified Active Signal';

  return {
    windowDurationSec,
    frameCount: n,
    dominantState,
    classifications,
    detectedPeriodHz,
    periodicityStrength,
    transientCount,
  };
}

export interface PrivacyLeakageAssessment {
  educationalHeuristicScore: number; // 0..100 explicitly labeled non-validated heuristic
  heuristicTier: 'Minimal' | 'Low' | 'Moderate' | 'Elevated';
  observableFeatures: Array<{ name: string; value: string; source: string }>;
  potentialInferences: Array<{
    inference: string;
    confidence: 'Low' | 'Moderate' | 'High';
    basis: string;
  }>;
  cannotBeConcluded: string[];
  mitigations: string[];
}

export function evaluatePrivacyLeakage(
  frames: ActivityFrame[],
  metadata: DeviceMetadataSnapshot,
  activity: ActivityInferenceResult | null
): PrivacyLeakageAssessment {
  const hasFrames = frames.length > 0;
  const latest = hasFrames ? frames[frames.length - 1] : null;
  const meanRmsDb = hasFrames
    ? frames.reduce((s, f) => s + f.rmsDbfs, 0) / frames.length
    : -120;
  const meanFlatness = hasFrames
    ? frames.reduce((s, f) => s + f.spectralFlatness, 0) / frames.length
    : 0;
  const meanLowRatio = hasFrames
    ? frames.reduce((s, f) => s + f.bandEnergy.lowRatio, 0) / frames.length
    : 0;
  const meanHighRatio = hasFrames
    ? frames.reduce((s, f) => s + f.bandEnergy.highRatio, 0) / frames.length
    : 0;

  const observableFeatures: Array<{ name: string; value: string; source: string }> = [
    {
      name: 'Estimated Noise Floor',
      value: latest ? `${latest.noiseFloorDbfs.toFixed(1)} dBFS` : 'No active stream',
      source: 'Adaptive 10th-percentile tracker',
    },
    {
      name: 'Mean Signal Level',
      value: hasFrames ? `${meanRmsDb.toFixed(1)} dBFS` : 'No active stream',
      source: 'Time-domain RMS',
    },
    {
      name: 'Spectral Flatness (Mean)',
      value: hasFrames ? meanFlatness.toFixed(3) : '—',
      source: 'Wiener entropy across FFT bins',
    },
    {
      name: 'Low / High Band Balance',
      value: hasFrames
        ? `${(meanLowRatio * 100).toFixed(0)}% Low / ${(meanHighRatio * 100).toFixed(0)}% High`
        : '—',
      source: '20–250 Hz vs >=2000 Hz power',
    },
    {
      name: 'Browser Device Surface',
      value:
        metadata.devices.length > 0
          ? `${metadata.devices.length} device(s), ${metadata.devices.filter((d) => !d.labelRedacted).length} labeled`
          : 'Not enumerated / suppressed',
      source: 'navigator.mediaDevices',
    },
  ];

  const potentialInferences: PrivacyLeakageAssessment['potentialInferences'] = [];
  let heuristicPoints = 0;

  if (hasFrames && latest) {
    if (latest.isActive) {
      heuristicPoints += 20;
      potentialInferences.push({
        inference: 'Presence of active acoustic energy above baseline noise floor',
        confidence: latest.snrDb > 10 ? 'High' : 'Moderate',
        basis: `Measured SNR +${latest.snrDb.toFixed(1)} dB over ${latest.noiseFloorDbfs.toFixed(1)} dBFS floor.`,
      });
    } else {
      heuristicPoints += 8;
      potentialInferences.push({
        inference: 'Baseline ambient floor characterization (quiet state)',
        confidence: 'Moderate',
        basis: `Steady baseline near ${latest.noiseFloorDbfs.toFixed(1)} dBFS enables occupancy-change detection if monitored over time.`,
      });
    }

    if (meanLowRatio > 0.55 && meanFlatness < 0.25) {
      heuristicPoints += 18;
      potentialInferences.push({
        inference: 'Low-frequency tonal/harmonic coupling (e.g., mains hum, motor, or HVAC rumble)',
        confidence: 'Moderate',
        basis: `${(meanLowRatio * 100).toFixed(0)}% energy below 250 Hz with low spectral flatness (${meanFlatness.toFixed(3)}).`,
      });
    }

    if (activity?.classifications.some((c) => c.id === 'repetitive_events' && c.detected)) {
      heuristicPoints += 22;
      potentialInferences.push({
        inference: `Cadence / event-rate leakage (~${activity.detectedPeriodHz?.toFixed(2) ?? '?'} Hz repetitive pattern)`,
        confidence: 'Moderate',
        basis: `Envelope autocorrelation r=${activity.periodicityStrength.toFixed(2)} reveals rhythmic acoustic timing without recording speech.`,
      });
    } else if (activity?.classifications.some((c) => c.id === 'transient_impulse' && c.detected)) {
      heuristicPoints += 15;
      potentialInferences.push({
        inference: 'Intermittent impulsive activity timing (bursts of physical interaction)',
        confidence: 'Moderate',
        basis: `${activity.transientCount} impulsive frame(s) detected in rolling window.`,
      });
    }

    if (meanFlatness >= 0.35) {
      heuristicPoints += 10;
      potentialInferences.push({
        inference: 'Broadband airflow / diffuse noise floor profile',
        confidence: 'Low',
        basis: `Elevated spectral flatness (${meanFlatness.toFixed(3)}) suggests broadband environmental noise.`,
      });
    }
  }

  const exposedLabels = metadata.devices.filter((d) => !d.labelRedacted).length;
  if (exposedLabels > 0 || metadata.actualSettings) {
    heuristicPoints += exposedLabels > 0 ? 22 : 10;
    potentialInferences.push({
      inference: 'Hardware class, audio-routing, or peripheral configuration fingerprinting',
      confidence: exposedLabels > 0 ? 'High' : 'Moderate',
      basis:
        exposedLabels > 0
          ? `${exposedLabels} device label(s) + track settings (e.g. ${metadata.actualSettings?.sampleRate ?? '?'} Hz) exposed by MediaDevices API.`
          : 'Track settings expose sample rate and DSP flags.',
    });
  }

  if (potentialInferences.length === 0) {
    potentialInferences.push({
      inference: 'No active audio stream or enumerated device metadata observed yet',
      confidence: 'High',
      basis: 'Enable Synthetic Signals or Microphone to observe live side-channel feature leakage.',
    });
  }

  const educationalHeuristicScore = Math.min(100, Math.max(0, heuristicPoints));
  const heuristicTier: PrivacyLeakageAssessment['heuristicTier'] =
    educationalHeuristicScore >= 65
      ? 'Elevated'
      : educationalHeuristicScore >= 40
        ? 'Moderate'
        : educationalHeuristicScore >= 15
          ? 'Low'
          : 'Minimal';

  return {
    educationalHeuristicScore,
    heuristicTier,
    observableFeatures,
    potentialInferences,
    cannotBeConcluded: [
      'Spoken words, semantic conversation content, or transcripts (no ASR/recording is performed).',
      'Unique speaker identity, age, gender, or biometric verification.',
      'Exact physical location, street address, or room identity from spectral profiles alone.',
      'Specific real-world actions (e.g., typing vs. tapping vs. kitchen noises) without ground-truth calibration.',
    ],
    mitigations: [
      'Revoke site microphone permissions when not actively needed; treat OS hardware mute LEDs as authoritative.',
      'Use physical microphone disconnect/mute switches rather than relying solely on software mute.',
      'Apply high-pass filtering (e.g., 150–250 Hz) or noise gating in privacy-preserving virtual audio routes to strip low-frequency mains/machinery side channels.',
      'Avoid granting persistent microphone access across origins, as permission unlocks device label enumeration for hardware fingerprinting.',
    ],
  };
}
