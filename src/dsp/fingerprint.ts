import type {
  EnvironmentalFingerprint,
  FeatureFrame,
  FingerprintComparison,
  InputMode,
} from '../types/acoustic';
import { powerToDbfs } from './metrics';
import {
  LOG_BAND_COUNT,
  buildLogBandBinMap,
  computeLogBandEdges,
} from './logBands';

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

interface BandComparisonMetrics {
  cosineSimilarity: number;
  spectralDistanceDb: number;
  perBandDeltaDb: number[];
}

/** Cosine similarity and RMSE across the shared log-band grid. */
function compareBandDistributions(
  a: EnvironmentalFingerprint,
  b: EnvironmentalFingerprint
): BandComparisonMetrics {
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
  return {
    cosineSimilarity:
      denom > 1e-12 ? Math.min(1, Math.max(0, dot / denom)) : 0,
    spectralDistanceDb: len > 0 ? Math.sqrt(sqDiffDb / len) : 0,
    perBandDeltaDb,
  };
}

/**
 * Two profiles are only comparable when they were measured on the same
 * analysis grid and both contain measurable spectral energy.
 */
function collectIncompatibilityReasons(
  a: EnvironmentalFingerprint,
  b: EnvironmentalFingerprint
): string[] {
  const reasons: string[] = [];
  if (a.sampleRate !== b.sampleRate) {
    reasons.push(
      `Sample rates differ (${a.sampleRate} Hz vs ${b.sampleRate} Hz), so the log-band edges are not aligned.`
    );
  }
  if (a.fftSize !== b.fftSize) {
    reasons.push(
      `FFT sizes differ (${a.fftSize} vs ${b.fftSize}), so spectral resolution differs between windows.`
    );
  }
  if (a.logBandCentersHz.length !== b.logBandCentersHz.length) {
    reasons.push(
      `Band counts differ (${a.logBandCentersHz.length} vs ${b.logBandCentersHz.length}).`
    );
  }
  const energyA = a.logBandDistribution.reduce((s, v) => s + v, 0);
  const energyB = b.logBandDistribution.reduce((s, v) => s + v, 0);
  if (energyA <= 1e-9 || energyB <= 1e-9) {
    reasons.push(
      'At least one window contains no measurable spectral power, so there is no spectral evidence to compare.'
    );
  }
  return reasons;
}

function confidenceLabelFor(
  comparable: boolean,
  minFrames: number
): FingerprintComparison['confidenceLabel'] {
  if (!comparable) return 'Low';
  if (minFrames >= 60) return 'High';
  if (minFrames >= 25) return 'Moderate';
  return 'Low';
}

function interpretComparison(
  comparable: boolean,
  incompatibilityReasons: string[],
  cosineSimilarity: number,
  noiseFloorDeltaDb: number
): string {
  if (!comparable) {
    return `NOT COMPARABLE — no similarity score is reported. ${incompatibilityReasons.join(
      ' '
    )} Re-capture both windows from the same input source with the same sample rate and FFT size.`;
  }
  if (cosineSimilarity >= 0.92 && Math.abs(noiseFloorDeltaDb) < 4) {
    return 'High spectral-shape alignment and comparable noise floor between the two windows. Consistent with stable ambient acoustics or similar signal sources, though NOT proof of identical physical location or hardware.';
  }
  if (cosineSimilarity >= 0.75) {
    return 'Moderate spectral overlap with measurable shifts in band balance or background noise floor. Could reflect transient activity changes, HVAC cycling, microphone repositioning, or a distinct environment.';
  }
  return 'Substantial divergence in spectral energy distribution between Snapshot A and Snapshot B, indicating changed acoustic sources, altered room/microphone state, or different environments.';
}

function comparisonLimitations(minFrames: number): string[] {
  return [
    'Similarity is NOT proof of a unique physical location, room, or user identity.',
    'Two different quiet rooms with similar HVAC or laptop fan noise can exhibit cosine similarity > 0.90.',
    'The same room with a window opened, fan toggled, or microphone moved can exhibit low similarity.',
    'Browser automatic gain control (AGC) and noise suppression alter absolute noise floors and spectral tilt.',
    `Comparison computed across ${LOG_BAND_COUNT} log-spaced bands (${minFrames} minimum frames per window).`,
    'Each FFT bin belongs to exactly one log band, so band powers do not overlap; bands narrower than one bin carry no bins and read as the -120 dBFS floor.',
    'The Low/Moderate/High confidence label is a frame-count heuristic (25 and 60 frames), not a validated statistical confidence interval.',
  ];
}

export function compareFingerprints(
  a: EnvironmentalFingerprint,
  b: EnvironmentalFingerprint
): FingerprintComparison {
  const metrics = compareBandDistributions(a, b);
  const incompatibilityReasons = collectIncompatibilityReasons(a, b);
  const comparable = incompatibilityReasons.length === 0;
  const noiseFloorDeltaDb = b.noiseFloorDbfs - a.noiseFloorDbfs;
  const minFrames = Math.min(a.frameCount, b.frameCount);

  return {
    cosineSimilarity: metrics.cosineSimilarity,
    spectralDistanceDb: metrics.spectralDistanceDb,
    noiseFloorDeltaDb,
    centroidDeltaHz: b.meanCentroidHz - a.meanCentroidHz,
    flatnessDelta: b.meanFlatness - a.meanFlatness,
    bandDeltas: {
      lowDeltaPct:
        (b.meanBandEnergy.lowRatio - a.meanBandEnergy.lowRatio) * 100,
      midDeltaPct:
        (b.meanBandEnergy.midRatio - a.meanBandEnergy.midRatio) * 100,
      highDeltaPct:
        (b.meanBandEnergy.highRatio - a.meanBandEnergy.highRatio) * 100,
    },
    perBandDeltaDb: metrics.perBandDeltaDb,
    comparable,
    incompatibilityReasons,
    confidenceLabel: confidenceLabelFor(comparable, minFrames),
    interpretation: interpretComparison(
      comparable,
      incompatibilityReasons,
      metrics.cosineSimilarity,
      noiseFloorDeltaDb
    ),
    limitations: comparisonLimitations(minFrames),
  };
}
