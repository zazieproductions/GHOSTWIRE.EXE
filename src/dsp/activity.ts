import type {
  ActivityClassification,
  ActivityFrame,
  ActivityInferenceResult,
} from '../types/acoustic';

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
  frames: ActivityFrame[],
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

interface TimedSegment {
  start: number;
  end: number;
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

function medianFrameIntervalMs(
  timestamps: number[],
  windowDurationSec: number
): number {
  const diffs: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    diffs.push(timestamps[i] - timestamps[i - 1]);
  }
  diffs.sort((a, b) => a - b);
  if (diffs.length === 0) {
    return (windowDurationSec * 1000) / Math.max(1, timestamps.length - 1);
  }
  return diffs[Math.floor(diffs.length / 2)];
}

function findContinuousTimedSegments(
  timestamps: number[],
  gapThresholdMs: number
): TimedSegment[] {
  const segments: TimedSegment[] = [];
  let segStart = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const isGap = timestamps[i] - timestamps[i - 1] > gapThresholdMs;
    if (isGap) {
      if (i - segStart >= 24) segments.push({ start: segStart, end: i });
      segStart = i;
    }
  }
  if (timestamps.length - segStart >= 24) {
    segments.push({ start: segStart, end: timestamps.length });
  }
  return segments;
}

function longestSegment(segments: TimedSegment[]): TimedSegment | null {
  let best: TimedSegment | null = null;
  for (const segment of segments) {
    const isLonger =
      !best || segment.end - segment.start > best.end - best.start;
    if (isLonger) best = segment;
  }
  return best;
}

function summarizeEnvelopeSegment(
  frames: ActivityFrame[],
  timestamps: number[],
  segment: TimedSegment
): PeriodicityResult {
  const { start, end } = segment;
  const segN = end - start;
  const segDurSec = (timestamps[end - 1] - timestamps[start]) / 1000;
  if (segN < 2 || !Number.isFinite(segDurSec) || segDurSec <= 0) {
    return { detectedPeriodHz: null, periodicityStrength: 0 };
  }

  const dt = segDurSec / (segN - 1);
  const rmsArr = frames.slice(start, end).map((f) => f.rms);
  const meanRms = rmsArr.reduce((a, b) => a + b, 0) / segN;
  const centered = rmsArr.map((v) => v - meanRms);
  let zeroLag = 0;
  for (let i = 0; i < segN; i++) zeroLag += centered[i] * centered[i];

  const rmsStd = Math.sqrt(zeroLag / segN);
  // Require meaningful amplitude modulation above the noise floor.
  if (zeroLag > 1e-10 && rmsStd > meanRms * 0.12) {
    const { bestLag, bestCorr } = findBestEnvelopeLag(centered, segN, dt);
    const periodicityStrength = Math.max(0, bestCorr);
    const detectedPeriodHz =
      bestLag > 0 && bestCorr >= 0.42 ? 1 / (bestLag * dt) : null;
    return { detectedPeriodHz, periodicityStrength };
  }
  return { detectedPeriodHz: null, periodicityStrength: 0 };
}

/**
 * Envelope periodicity via normalized autocorrelation on the linear RMS envelope.
 *
 * AUDIT F6: use per-frame timestamps instead of assuming evenly spaced display
 * frames. Gaps larger than three times the median inter-frame interval split the
 * envelope; only the longest continuous segment is analyzed, and unsupported
 * cadence estimates are suppressed.
 */
function detectEnvelopePeriodicity(
  frames: ActivityFrame[],
  windowDurationSec: number
): PeriodicityResult {
  const noPeriodicity: PeriodicityResult = {
    detectedPeriodHz: null,
    periodicityStrength: 0,
  };
  const n = frames.length;
  if (n < 24 || windowDurationSec < 0.8) return noPeriodicity;

  const timestamps = frames.map((f) => f.timestampMs);
  const medianDtMs = medianFrameIntervalMs(timestamps, windowDurationSec);
  const gapThresholdMs = Math.max(medianDtMs * 3, 50);
  const segments = findContinuousTimedSegments(timestamps, gapThresholdMs);
  const bestSegment = longestSegment(segments);
  if (!bestSegment) return noPeriodicity;

  return summarizeEnvelopeSegment(frames, timestamps, bestSegment);
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
  frames: ActivityFrame[],
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
