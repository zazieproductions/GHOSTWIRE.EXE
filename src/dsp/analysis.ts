import type {
  ActivityClassification,
  ActivityInferenceResult,
  DeviceMetadataSnapshot,
  DspFrame,
  EnvironmentalFingerprint,
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

export function buildEnvironmentalFingerprint(
  frames: DspFrame[],
  label: string,
  sourceMode: InputMode
): EnvironmentalFingerprint {
  if (frames.length === 0) {
    throw new Error('Cannot build environmental fingerprint from 0 frames.');
  }

  const first = frames[0];
  const last = frames[frames.length - 1];
  const sampleRate = first.sampleRate;
  const fftSize = first.fftSize;
  const nyquist = sampleRate / 2;
  const bandEdges = computeLogBandEdges(20, nyquist, LOG_BAND_COUNT);

  const n = frames.length;
  const rmsValues = frames.map((f) => f.rmsDbfs).sort((a, b) => a - b);
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
  const binWidth = sampleRate / fftSize;

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    sumRmsDb += f.rmsDbfs;
    if (f.peakDbfs > maxPeakDb) maxPeakDb = f.peakDbfs;
    sumCentroid += f.spectralCentroidHz;
    sumBandwidth += f.spectralBandwidthHz;
    sumFlatness += f.spectralFlatness;
    sumZcr += f.zeroCrossingRate;
    sumLow += f.bandEnergy.lowRatio;
    sumMid += f.bandEnergy.midRatio;
    sumHigh += f.bandEnergy.highRatio;

    // Accumulate power into 32 log bands
    for (let b = 0; b < LOG_BAND_COUNT; b++) {
      const { lowHz, highHz } = bandEdges[b];
      const startBin = Math.max(1, Math.floor(lowHz / binWidth));
      const endBin = Math.min(
        f.powerSpectrum.length - 1,
        Math.max(startBin, Math.ceil(highHz / binWidth))
      );
      let bandSum = 0;
      for (let k = startBin; k <= endBin; k++) {
        bandSum += f.powerSpectrum[k];
      }
      bandPowerAccum[b] += bandSum;
    }
  }

  const meanRmsDbfs = sumRmsDb / n;
  let sqDiff = 0;
  for (let i = 0; i < n; i++) {
    const d = frames[i].rmsDbfs - meanRmsDbfs;
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

  const logBandDistribution = meanBandPower.map((p) =>
    totalLogPower > 1e-14 ? p / totalLogPower : 1 / LOG_BAND_COUNT
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
  const confidenceLabel: 'Low' | 'Moderate' | 'High' =
    minFrames >= 60 ? 'High' : minFrames >= 25 ? 'Moderate' : 'Low';

  let interpretation: string;
  if (cosineSimilarity >= 0.92 && Math.abs(noiseFloorDeltaDb) < 4) {
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
  ];

  return {
    cosineSimilarity,
    spectralDistanceDb,
    noiseFloorDeltaDb,
    centroidDeltaHz,
    flatnessDelta,
    bandDeltas,
    perBandDeltaDb,
    confidenceLabel,
    interpretation,
    limitations,
  };
}

/**
 * Transparent heuristic classifier for Experiment B — Activity Inference.
 * Evaluates a short rolling buffer of recent frames (typically 1.5–4 seconds).
 */

interface ActivityWindowStats {
  n: number;
  windowDurationSec: number;
  meanRmsDb: number;
  meanFlatness: number;
  meanBandwidth: number;
  meanCrest: number;
  activeRatio: number;
  transientCount: number;
  maxJumpDb: number;
  domFreqCv: number;
  meanDomFreq: number;
}

interface PeriodicityResult {
  detectedPeriodHz: number | null;
  periodicityStrength: number;
}

interface ActivityFlags {
  isQuiet: boolean;
  isTonal: boolean;
  isBroadband: boolean;
  isTransient: boolean;
  isRepetitive: boolean;
}

type ClassificationConfidence = ActivityClassification['confidence'];

function allTrue(...conditions: boolean[]): boolean {
  return conditions.every(Boolean);
}

function anyTrue(...conditions: boolean[]): boolean {
  return conditions.some(Boolean);
}

function confidenceFor(
  detected: boolean,
  stronglyDetected: boolean
): ClassificationConfidence {
  if (!detected) return 'low';
  return stronglyDetected ? 'high' : 'moderate';
}

function reasonFor(detected: boolean, positive: string, negative: string): string {
  return detected ? positive : negative;
}

function summarizeDominantFrequencies(domFreqs: number[]): {
  domFreqCv: number;
  meanDomFreq: number;
} {
  let domFreqStd = 0;
  let meanDomFreq = 0;
  if (domFreqs.length > 1) {
    meanDomFreq = domFreqs.reduce((a, b) => a + b, 0) / domFreqs.length;
    const varSum = domFreqs.reduce(
      (acc, f) => acc + (f - meanDomFreq) ** 2,
      0
    );
    domFreqStd = Math.sqrt(varSum / domFreqs.length);
  } else if (domFreqs.length === 1) {
    meanDomFreq = domFreqs[0];
  }
  const domFreqCv = meanDomFreq > 20 ? domFreqStd / meanDomFreq : 1;
  return { domFreqCv, meanDomFreq };
}

function summarizeActivityFrames(
  frames: DspFrame[],
  activityThresholdDbfs: number
): ActivityWindowStats {
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

  const { domFreqCv, meanDomFreq } = summarizeDominantFrequencies(domFreqs);
  return {
    n,
    windowDurationSec,
    meanRmsDb: sumRmsDb / n,
    meanFlatness: sumFlatness / n,
    meanBandwidth: sumBandwidth / n,
    meanCrest: sumCrest / n,
    activeRatio: activeCount / n,
    transientCount,
    maxJumpDb,
    domFreqCv,
    meanDomFreq,
  };
}

function findBestEnvelopeLag(
  centered: number[],
  n: number,
  dt: number
): { bestLag: number; bestCorr: number } {
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

  return { bestLag, bestCorr };
}

function detectEnvelopePeriodicity(
  frames: DspFrame[],
  windowDurationSec: number
): PeriodicityResult {
  const result: PeriodicityResult = {
    detectedPeriodHz: null,
    periodicityStrength: 0,
  };
  const n = frames.length;

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
      const { bestLag, bestCorr } = findBestEnvelopeLag(centered, n, dt);
      result.periodicityStrength = Math.max(0, bestCorr);
      if (bestLag > 0 && bestCorr >= 0.42) {
        result.detectedPeriodHz = 1 / (bestLag * dt);
      }
    }
  }

  return result;
}

function computeActivityFlags(
  stats: ActivityWindowStats,
  activityThresholdDbfs: number,
  periodicity: PeriodicityResult
): ActivityFlags {
  const isQuiet = allTrue(
    stats.activeRatio < 0.25,
    stats.meanRmsDb < activityThresholdDbfs
  );
  const isTonal = allTrue(
    !isQuiet,
    stats.activeRatio >= 0.4,
    stats.meanFlatness < 0.18,
    stats.domFreqCv < 0.18,
    stats.meanDomFreq > 20
  );
  const isBroadband = allTrue(
    !isQuiet,
    stats.meanFlatness >= 0.32,
    stats.meanBandwidth >= 1100,
    stats.meanCrest < 11.5
  );
  const isTransient = anyTrue(
    stats.transientCount >= Math.max(1, Math.floor(stats.n * 0.06)),
    stats.maxJumpDb >= 7.5
  );
  const isRepetitive = allTrue(
    periodicity.detectedPeriodHz !== null,
    periodicity.periodicityStrength >= 0.42,
    anyTrue(isTransient, stats.transientCount > 0, stats.meanCrest >= 7)
  );
  return { isQuiet, isTonal, isBroadband, isTransient, isRepetitive };
}

function buildQuietClassification(
  stats: ActivityWindowStats,
  flags: ActivityFlags,
  activityThresholdDbfs: number
): ActivityClassification {
  const stronglyDetected = allTrue(
    flags.isQuiet,
    stats.meanRmsDb < activityThresholdDbfs - 8
  );
  return {
    id: 'quiet',
    label: 'Relative Quiet',
    detected: flags.isQuiet,
    confidence: confidenceFor(flags.isQuiet, stronglyDetected),
    measuredEvidence: `Mean RMS ${stats.meanRmsDb.toFixed(1)} dBFS, Active frames ${(stats.activeRatio * 100).toFixed(0)}%`,
    thresholdRule: `Mean RMS < ${activityThresholdDbfs.toFixed(0)} dBFS AND active fraction < 25%`,
    reasoning: reasonFor(
      flags.isQuiet,
      'Signal energy remains below the configured activity threshold with minimal transient excursions.',
      'Signal exceeds the quiet threshold or exhibits frequent active frames.'
    ),
  };
}

function buildTonalClassification(
  stats: ActivityWindowStats,
  flags: ActivityFlags
): ActivityClassification {
  const stronglyDetected = allTrue(
    flags.isTonal,
    stats.meanFlatness < 0.08,
    stats.domFreqCv < 0.06
  );
  return {
    id: 'sustained_tonal',
    label: 'Sustained Tonal Activity',
    detected: flags.isTonal,
    confidence: confidenceFor(flags.isTonal, stronglyDetected),
    measuredEvidence: `Flatness ${stats.meanFlatness.toFixed(3)}, Dom. Freq ${stats.meanDomFreq.toFixed(1)} Hz (CV ${(stats.domFreqCv * 100).toFixed(1)}%)`,
    thresholdRule: 'Active >= 40%, Spectral Flatness < 0.18, Dominant Freq CV < 18%',
    reasoning: flags.isTonal
      ? `Energy is concentrated in narrowband spectral peaks around ${stats.meanDomFreq.toFixed(0)} Hz with stable pitch/frequency.`
      : 'Spectrum lacks a persistent narrowband peak (either quiet, broadband, or rapidly varying).',
  };
}

function buildBroadbandClassification(
  stats: ActivityWindowStats,
  flags: ActivityFlags
): ActivityClassification {
  const stronglyDetected = allTrue(flags.isBroadband, stats.meanFlatness >= 0.45);
  return {
    id: 'broadband_noise',
    label: 'Broadband Noise',
    detected: flags.isBroadband,
    confidence: confidenceFor(flags.isBroadband, stronglyDetected),
    measuredEvidence: `Flatness ${stats.meanFlatness.toFixed(3)}, Bandwidth ${stats.meanBandwidth.toFixed(0)} Hz, Crest ${stats.meanCrest.toFixed(1)} dB`,
    thresholdRule: 'Active, Flatness >= 0.32, Bandwidth >= 1100 Hz, Crest < 11.5 dB',
    reasoning: flags.isBroadband
      ? 'Acoustic energy is spread broadly across frequency bins without dominant tonal concentration.'
      : 'Signal is either below threshold, dominated by narrowband tones, or dominated by sharp impulses.',
  };
}

function buildTransientClassification(
  stats: ActivityWindowStats,
  flags: ActivityFlags
): ActivityClassification {
  const stronglyDetected = anyTrue(stats.meanCrest >= 12, stats.transientCount >= 3);
  return {
    id: 'transient_impulse',
    label: 'Transient / Impulsive Sounds',
    detected: flags.isTransient,
    confidence: confidenceFor(flags.isTransient, stronglyDetected),
    measuredEvidence: `Transient frames ${stats.transientCount}/${stats.n}, Max onset jump +${stats.maxJumpDb.toFixed(1)} dB, Mean crest ${stats.meanCrest.toFixed(1)} dB`,
    thresholdRule: 'Crest factor >= 11 dB OR frame-to-frame RMS jump >= +7 dB',
    reasoning: flags.isTransient
      ? 'Detected abrupt amplitude spikes or high peak-to-RMS ratios characteristic of impulsive acoustic events.'
      : 'Amplitude envelope varies smoothly without high-crest impulsive peaks.',
  };
}

function buildRepetitiveClassification(
  flags: ActivityFlags,
  periodicity: PeriodicityResult
): ActivityClassification {
  const stronglyDetected = periodicity.periodicityStrength >= 0.65;
  return {
    id: 'repetitive_events',
    label: 'Repetitive Acoustic Events',
    detected: flags.isRepetitive,
    confidence: confidenceFor(flags.isRepetitive, stronglyDetected),
    measuredEvidence: periodicity.detectedPeriodHz
      ? `Periodicity r=${periodicity.periodicityStrength.toFixed(2)} at ~${periodicity.detectedPeriodHz.toFixed(2)} Hz`
      : `Max envelope autocorrelation r=${periodicity.periodicityStrength.toFixed(2)}`,
    thresholdRule: 'RMS envelope autocorrelation r >= 0.42 across 0.7–12.5 Hz lags with impulsive modulation',
    reasoning: flags.isRepetitive && periodicity.detectedPeriodHz
      ? `Amplitude envelope repeats regularly at approximately ${periodicity.detectedPeriodHz.toFixed(2)} events/sec.`
      : 'No statistically consistent periodic repetition detected in the rolling RMS envelope.',
  };
}

function buildActivityClassifications(
  stats: ActivityWindowStats,
  flags: ActivityFlags,
  activityThresholdDbfs: number,
  periodicity: PeriodicityResult
): ActivityClassification[] {
  return [
    buildQuietClassification(stats, flags, activityThresholdDbfs),
    buildTonalClassification(stats, flags),
    buildBroadbandClassification(stats, flags),
    buildTransientClassification(stats, flags),
    buildRepetitiveClassification(flags, periodicity),
  ];
}

function emptyActivityResult(): ActivityInferenceResult {
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

export function inferBroadActivity(
  frames: DspFrame[],
  activityThresholdDbfs = -50
): ActivityInferenceResult {
  if (frames.length === 0) return emptyActivityResult();

  const stats = summarizeActivityFrames(frames, activityThresholdDbfs);
  const periodicity = detectEnvelopePeriodicity(frames, stats.windowDurationSec);
  const flags = computeActivityFlags(stats, activityThresholdDbfs, periodicity);
  const classifications = buildActivityClassifications(
    stats,
    flags,
    activityThresholdDbfs,
    periodicity
  );
  const activeLabels = classifications
    .filter((c) => c.detected)
    .map((c) => c.label);
  const dominantState = activeLabels.length > 0
    ? activeLabels.join(' + ')
    : 'Mixed / Unclassified Active Signal';

  return {
    windowDurationSec: stats.windowDurationSec,
    frameCount: stats.n,
    dominantState,
    classifications,
    detectedPeriodHz: periodicity.detectedPeriodHz,
    periodicityStrength: periodicity.periodicityStrength,
    transientCount: stats.transientCount,
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

type PrivacyInference = PrivacyLeakageAssessment['potentialInferences'][number];

interface FrameFeatureSummary {
  hasFrames: boolean;
  latest: DspFrame | null;
  meanRmsDb: number;
  meanFlatness: number;
  meanLowRatio: number;
  meanHighRatio: number;
}

interface InferenceAccumulator {
  points: number;
  inferences: PrivacyInference[];
}

const CANNOT_BE_CONCLUDED = [
  'Spoken words, semantic conversation content, or transcripts (no ASR/recording is performed).',
  'Unique speaker identity, age, gender, or biometric verification.',
  'Exact physical location, street address, or room identity from spectral profiles alone.',
  'Specific real-world actions (e.g., typing vs. tapping vs. kitchen noises) without ground-truth calibration.',
];

const MITIGATIONS = [
  'Revoke site microphone permissions when not actively needed; treat OS hardware mute LEDs as authoritative.',
  'Use physical microphone disconnect/mute switches rather than relying solely on software mute.',
  'Apply high-pass filtering (e.g., 150–250 Hz) or noise gating in privacy-preserving virtual audio routes to strip low-frequency mains/machinery side channels.',
  'Avoid granting persistent microphone access across origins, as permission unlocks device label enumeration for hardware fingerprinting.',
];

function meanFrameFeature(
  frames: DspFrame[],
  select: (frame: DspFrame) => number,
  fallback: number
): number {
  if (frames.length === 0) return fallback;
  return frames.reduce((sum, frame) => sum + select(frame), 0) / frames.length;
}

function summarizeFrameFeatures(frames: DspFrame[]): FrameFeatureSummary {
  const hasFrames = frames.length > 0;
  return {
    hasFrames,
    latest: hasFrames ? frames[frames.length - 1] : null,
    meanRmsDb: meanFrameFeature(frames, (frame) => frame.rmsDbfs, -120),
    meanFlatness: meanFrameFeature(frames, (frame) => frame.spectralFlatness, 0),
    meanLowRatio: meanFrameFeature(
      frames,
      (frame) => frame.bandEnergy.lowRatio,
      0
    ),
    meanHighRatio: meanFrameFeature(
      frames,
      (frame) => frame.bandEnergy.highRatio,
      0
    ),
  };
}

function countExposedLabels(metadata: DeviceMetadataSnapshot): number {
  return metadata.devices.filter((d) => !d.labelRedacted).length;
}

function formatObserved(
  hasFrames: boolean,
  observed: string,
  fallback: string
): string {
  return hasFrames ? observed : fallback;
}

function formatDeviceSurface(metadata: DeviceMetadataSnapshot): string {
  if (metadata.devices.length === 0) return 'Not enumerated / suppressed';
  return `${metadata.devices.length} device(s), ${countExposedLabels(metadata)} labeled`;
}

function buildObservableFeatures(
  summary: FrameFeatureSummary,
  metadata: DeviceMetadataSnapshot
): PrivacyLeakageAssessment['observableFeatures'] {
  return [
    {
      name: 'Estimated Noise Floor',
      value: summary.latest
        ? `${summary.latest.noiseFloorDbfs.toFixed(1)} dBFS`
        : 'No active stream',
      source: 'Adaptive 10th-percentile tracker',
    },
    {
      name: 'Mean Signal Level',
      value: formatObserved(
        summary.hasFrames,
        `${summary.meanRmsDb.toFixed(1)} dBFS`,
        'No active stream'
      ),
      source: 'Time-domain RMS',
    },
    {
      name: 'Spectral Flatness (Mean)',
      value: formatObserved(
        summary.hasFrames,
        summary.meanFlatness.toFixed(3),
        '—'
      ),
      source: 'Wiener entropy across FFT bins',
    },
    {
      name: 'Low / High Band Balance',
      value: formatObserved(
        summary.hasFrames,
        `${(summary.meanLowRatio * 100).toFixed(0)}% Low / ${(summary.meanHighRatio * 100).toFixed(0)}% High`,
        '—'
      ),
      source: '20–250 Hz vs >=2000 Hz power',
    },
    {
      name: 'Browser Device Surface',
      value: formatDeviceSurface(metadata),
      source: 'navigator.mediaDevices',
    },
  ];
}

function addInference(
  accumulator: InferenceAccumulator,
  points: number,
  inference: PrivacyInference
): void {
  accumulator.points += points;
  accumulator.inferences.push(inference);
}

function addSignalStateInference(
  accumulator: InferenceAccumulator,
  latest: DspFrame
): void {
  if (latest.isActive) {
    addInference(accumulator, 20, {
      inference: 'Presence of active acoustic energy above baseline noise floor',
      confidence: latest.snrDb > 10 ? 'High' : 'Moderate',
      basis: `Measured SNR +${latest.snrDb.toFixed(1)} dB over ${latest.noiseFloorDbfs.toFixed(1)} dBFS floor.`,
    });
  } else {
    addInference(accumulator, 8, {
      inference: 'Baseline ambient floor characterization (quiet state)',
      confidence: 'Moderate',
      basis: `Steady baseline near ${latest.noiseFloorDbfs.toFixed(1)} dBFS enables occupancy-change detection if monitored over time.`,
    });
  }
}

function addLowFrequencyInference(
  accumulator: InferenceAccumulator,
  summary: FrameFeatureSummary
): void {
  if (summary.meanLowRatio > 0.55 && summary.meanFlatness < 0.25) {
    addInference(accumulator, 18, {
      inference: 'Low-frequency tonal/harmonic coupling (e.g., mains hum, motor, or HVAC rumble)',
      confidence: 'Moderate',
      basis: `${(summary.meanLowRatio * 100).toFixed(0)}% energy below 250 Hz with low spectral flatness (${summary.meanFlatness.toFixed(3)}).`,
    });
  }
}

function addCadenceInference(
  accumulator: InferenceAccumulator,
  activity: ActivityInferenceResult | null
): void {
  const repetitive = activity?.classifications.some(
    (c) => c.id === 'repetitive_events' && c.detected
  );
  const transient = activity?.classifications.some(
    (c) => c.id === 'transient_impulse' && c.detected
  );

  if (repetitive) {
    addInference(accumulator, 22, {
      inference: `Cadence / event-rate leakage (~${activity?.detectedPeriodHz?.toFixed(2) ?? '?'} Hz repetitive pattern)`,
      confidence: 'Moderate',
      basis: `Envelope autocorrelation r=${activity?.periodicityStrength.toFixed(2)} reveals rhythmic acoustic timing without recording speech.`,
    });
  } else if (transient) {
    addInference(accumulator, 15, {
      inference: 'Intermittent impulsive activity timing (bursts of physical interaction)',
      confidence: 'Moderate',
      basis: `${activity?.transientCount} impulsive frame(s) detected in rolling window.`,
    });
  }
}

function addBroadbandInference(
  accumulator: InferenceAccumulator,
  summary: FrameFeatureSummary
): void {
  if (summary.meanFlatness >= 0.35) {
    addInference(accumulator, 10, {
      inference: 'Broadband airflow / diffuse noise floor profile',
      confidence: 'Low',
      basis: `Elevated spectral flatness (${summary.meanFlatness.toFixed(3)}) suggests broadband environmental noise.`,
    });
  }
}

function collectAcousticInferences(
  accumulator: InferenceAccumulator,
  summary: FrameFeatureSummary,
  activity: ActivityInferenceResult | null
): void {
  const latest = summary.latest;
  if (!latest) return;
  addSignalStateInference(accumulator, latest);
  addLowFrequencyInference(accumulator, summary);
  addCadenceInference(accumulator, activity);
  addBroadbandInference(accumulator, summary);
}

function addDeviceInference(
  accumulator: InferenceAccumulator,
  metadata: DeviceMetadataSnapshot
): void {
  const exposedLabels = countExposedLabels(metadata);
  if (exposedLabels > 0 || metadata.actualSettings) {
    addInference(accumulator, exposedLabels > 0 ? 22 : 10, {
      inference: 'Hardware class, audio-routing, or peripheral configuration fingerprinting',
      confidence: exposedLabels > 0 ? 'High' : 'Moderate',
      basis: exposedLabels > 0
        ? `${exposedLabels} device label(s) + track settings (e.g. ${metadata.actualSettings?.sampleRate ?? '?'} Hz) exposed by MediaDevices API.`
        : 'Track settings expose sample rate and DSP flags.',
    });
  }
}

function addIdleInference(accumulator: InferenceAccumulator): void {
  if (accumulator.inferences.length === 0) {
    addInference(accumulator, 0, {
      inference: 'No active audio stream or enumerated device metadata observed yet',
      confidence: 'High',
      basis: 'Enable Synthetic Signals or Microphone to observe live side-channel feature leakage.',
    });
  }
}

function buildPotentialInferences(
  summary: FrameFeatureSummary,
  metadata: DeviceMetadataSnapshot,
  activity: ActivityInferenceResult | null
): InferenceAccumulator {
  const accumulator: InferenceAccumulator = { points: 0, inferences: [] };
  collectAcousticInferences(accumulator, summary, activity);
  addDeviceInference(accumulator, metadata);
  addIdleInference(accumulator);
  return accumulator;
}

function tierForScore(score: number): PrivacyLeakageAssessment['heuristicTier'] {
  const tiers: Array<{
    min: number;
    tier: PrivacyLeakageAssessment['heuristicTier'];
  }> = [
    { min: 65, tier: 'Elevated' },
    { min: 40, tier: 'Moderate' },
    { min: 15, tier: 'Low' },
    { min: 0, tier: 'Minimal' },
  ];
  return tiers.find(({ min }) => score >= min)?.tier ?? 'Minimal';
}

export function evaluatePrivacyLeakage(
  frames: DspFrame[],
  metadata: DeviceMetadataSnapshot,
  activity: ActivityInferenceResult | null
): PrivacyLeakageAssessment {
  const summary = summarizeFrameFeatures(frames);
  const observableFeatures = buildObservableFeatures(summary, metadata);
  const { points, inferences } = buildPotentialInferences(
    summary,
    metadata,
    activity
  );
  const educationalHeuristicScore = Math.min(100, Math.max(0, points));

  return {
    educationalHeuristicScore,
    heuristicTier: tierForScore(educationalHeuristicScore),
    observableFeatures,
    potentialInferences: inferences,
    cannotBeConcluded: [...CANNOT_BE_CONCLUDED],
    mitigations: [...MITIGATIONS],
  };
}
