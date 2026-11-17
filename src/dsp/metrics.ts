import type { BandEnergy, DspFrame } from '../types/acoustic';
import { computeHannSpectrum } from './fft';

export const MIN_AMPLITUDE_FLOOR = 1e-6; // -120 dBFS
export const MIN_POWER_FLOOR = 1e-12; // -120 dBFS

export function amplitudeToDbfs(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= MIN_AMPLITUDE_FLOOR) {
    return -120;
  }
  return Math.max(-120, 20 * Math.log10(amplitude));
}

export function powerToDbfs(power: number): number {
  if (!Number.isFinite(power) || power <= MIN_POWER_FLOOR) {
    return -120;
  }
  return Math.max(-120, 10 * Math.log10(power));
}

export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples.length);
}

export function computePeak(samples: Float32Array): number {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  return maxAbs;
}

/**
 * Zero-Crossing Rate (crossings per sample in [0, 1]).
 * Uses a +/- 1e-6 (-120 dBFS) deadband to prevent sub-LSB silence jitter
 * from inflating ZCR while preserving accurate crossing counts for real signals.
 */
export function computeZeroCrossingRate(
  samples: Float32Array,
  sampleRate: number
): { zcr: number; zcrFrequencyHz: number } {
  if (samples.length < 2) {
    return { zcr: 0, zcrFrequencyHz: 0 };
  }

  const deadband = 1e-6;
  let crossings = 0;
  let prevSign = 0;

  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const sign = x > deadband ? 1 : x < -deadband ? -1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) {
        crossings++;
      }
      prevSign = sign;
    }
  }

  const zcr = crossings / (samples.length - 1);
  // For a pure sinusoid of frequency f, ZCR ≈ 2*f / fs => f ≈ ZCR * fs / 2
  const zcrFrequencyHz = (zcr * sampleRate) / 2;
  return { zcr, zcrFrequencyHz };
}

/**
 * Dominant frequency using FFT bin peak with 3-point parabolic interpolation
 * on log-magnitude spectrum (excludes DC bin k=0).
 */
export function computeDominantFrequency(
  magnitude: Float32Array,
  sampleRate: number,
  fftSize: number
): number {
  const numBins = magnitude.length;
  if (numBins < 3) return 0;

  let maxBin = 1;
  let maxMag = magnitude[1];
  for (let k = 2; k < numBins; k++) {
    if (magnitude[k] > maxMag) {
      maxMag = magnitude[k];
      maxBin = k;
    }
  }

  if (maxMag <= MIN_AMPLITUDE_FLOOR) {
    return 0;
  }

  const binWidth = sampleRate / fftSize;
  let interpolatedBin = maxBin;

  if (maxBin > 1 && maxBin < numBins - 1) {
    const left = Math.log(Math.max(magnitude[maxBin - 1], 1e-12));
    const center = Math.log(Math.max(magnitude[maxBin], 1e-12));
    const right = Math.log(Math.max(magnitude[maxBin + 1], 1e-12));
    const denom = left - 2 * center + right;
    if (Math.abs(denom) > 1e-12) {
      const delta = (0.5 * (left - right)) / denom;
      if (delta > -0.5 && delta < 0.5) {
        interpolatedBin = maxBin + delta;
      }
    }
  }

  return interpolatedBin * binWidth;
}

export function computeSpectralCentroid(
  magnitude: Float32Array,
  sampleRate: number,
  fftSize: number
): number {
  const binWidth = sampleRate / fftSize;
  let weightedSum = 0;
  let totalMag = 0;

  for (let k = 1; k < magnitude.length; k++) {
    const m = magnitude[k];
    weightedSum += k * binWidth * m;
    totalMag += m;
  }

  if (totalMag <= 1e-8) return 0;
  return weightedSum / totalMag;
}

export function computeSpectralBandwidth(
  magnitude: Float32Array,
  centroidHz: number,
  sampleRate: number,
  fftSize: number
): number {
  const binWidth = sampleRate / fftSize;
  let varianceSum = 0;
  let totalMag = 0;

  for (let k = 1; k < magnitude.length; k++) {
    const m = magnitude[k];
    const diff = k * binWidth - centroidHz;
    varianceSum += diff * diff * m;
    totalMag += m;
  }

  if (totalMag <= 1e-8) return 0;
  return Math.sqrt(varianceSum / totalMag);
}

/**
 * Spectral Flatness Measure (Wiener Entropy) over bins 1..N/2.
 * Geometric mean / arithmetic mean of single-sided power spectrum.
 * Near 0 for pure sinusoids; ~0.56 for single-frame Gaussian white noise (exp(-gamma)).
 */
export function computeSpectralFlatness(power: Float32Array): number {
  const count = power.length - 1;
  if (count <= 0) return 0;

  let arithSum = 0;
  for (let k = 1; k < power.length; k++) {
    arithSum += power[k];
  }
  const arithMean = arithSum / count;
  if (arithMean <= 1e-14) return 0;

  const eps = 1e-16;
  let logSum = 0;
  for (let k = 1; k < power.length; k++) {
    logSum += Math.log(power[k] + eps);
  }
  const geomMean = Math.exp(logSum / count);
  return Math.min(1, Math.max(0, geomMean / arithMean));
}

export function computeBandEnergy(
  power: Float32Array,
  sampleRate: number,
  fftSize: number
): BandEnergy {
  const binWidth = sampleRate / fftSize;
  let lowPower = 0;
  let midPower = 0;
  let highPower = 0;

  for (let k = 1; k < power.length; k++) {
    const freq = k * binWidth;
    if (freq < 20) continue;
    if (freq < 250) {
      lowPower += power[k];
    } else if (freq < 2000) {
      midPower += power[k];
    } else {
      highPower += power[k];
    }
  }

  const totalPower = lowPower + midPower + highPower;
  if (totalPower <= 1e-14) {
    return {
      lowRatio: 0,
      midRatio: 0,
      highRatio: 0,
      lowDbfs: -120,
      midDbfs: -120,
      highDbfs: -120,
    };
  }

  return {
    lowRatio: lowPower / totalPower,
    midRatio: midPower / totalPower,
    highRatio: highPower / totalPower,
    lowDbfs: powerToDbfs(lowPower),
    midDbfs: powerToDbfs(midPower),
    highDbfs: powerToDbfs(highPower),
  };
}

export class AdaptiveNoiseFloorTracker {
  private floorDbfs = -90;
  private initialized = false;

  reset(): void {
    this.floorDbfs = -90;
    this.initialized = false;
  }

  update(rmsDbfs: number): number {
    if (!Number.isFinite(rmsDbfs)) return this.floorDbfs;
    if (!this.initialized) {
      this.floorDbfs = Math.max(-110, Math.min(-25, rmsDbfs));
      this.initialized = true;
      return this.floorDbfs;
    }

    // Fast downward tracking when environment becomes quieter;
    // slow upward tracking to adapt to steady ambient changes without absorbing speech/transients.
    if (rmsDbfs < this.floorDbfs) {
      this.floorDbfs = this.floorDbfs * 0.88 + rmsDbfs * 0.12;
    } else {
      const clampedRise = Math.min(rmsDbfs, this.floorDbfs + 6);
      this.floorDbfs = this.floorDbfs * 0.992 + clampedRise * 0.008;
    }
    return this.floorDbfs;
  }

  getFloorDbfs(): number {
    return this.floorDbfs;
  }
}

/**
 * Returns a copy of the frame with the raw waveform stripped, so the frame
 * can be retained for feature aggregation / session storage without keeping
 * raw PCM samples longer than necessary.
 */
export function stripWaveform(frame: DspFrame): DspFrame {
  return {
    ...frame,
    waveform: new Float32Array(0),
  };
}

export interface AnalyzeFrameOptions {
  sampleRate: number;
  fftSize?: number;
  timestampMs?: number;
  activityThresholdDbfs?: number;
  noiseFloorTracker?: AdaptiveNoiseFloorTracker;
  previousMagnitude?: Float32Array | null;
  smoothingTimeConstant?: number;
}

export function analyzeTimeDomainFrame(
  samples: Float32Array,
  options: AnalyzeFrameOptions
): { frame: DspFrame; smoothedMagnitude: Float32Array } {
  const fftSize = options.fftSize ?? samples.length;
  const sampleRate = options.sampleRate;
  const timestampMs = options.timestampMs ?? Date.now();
  const activityThresholdDbfs = options.activityThresholdDbfs ?? -50;
  const smoothing = Math.min(0.95, Math.max(0, options.smoothingTimeConstant ?? 0));

  const rms = computeRms(samples);
  const peak = computePeak(samples);
  const rmsDbfs = amplitudeToDbfs(rms);
  const peakDbfs = amplitudeToDbfs(peak);
  const crestFactorDb = peak > MIN_AMPLITUDE_FLOOR && rms > MIN_AMPLITUDE_FLOOR
    ? 20 * Math.log10(peak / rms)
    : 0;

  const { zcr, zcrFrequencyHz } = computeZeroCrossingRate(samples, sampleRate);
  const rawSpectrum = computeHannSpectrum(samples, fftSize);

  const smoothedMagnitude = new Float32Array(rawSpectrum.magnitude.length);
  const smoothedPower = new Float32Array(rawSpectrum.power.length);
  const smoothedDbfs = new Float32Array(rawSpectrum.spectrumDbfs.length);

  if (
    smoothing > 0 &&
    options.previousMagnitude &&
    options.previousMagnitude.length === rawSpectrum.magnitude.length
  ) {
    for (let k = 0; k < rawSpectrum.magnitude.length; k++) {
      const m =
        smoothing * options.previousMagnitude[k] +
        (1 - smoothing) * rawSpectrum.magnitude[k];
      smoothedMagnitude[k] = m;
      const isEdge = k === 0 || k === fftSize >> 1;
      smoothedPower[k] = isEdge ? m * m : 0.5 * m * m;
      smoothedDbfs[k] = amplitudeToDbfs(m);
    }
  } else {
    smoothedMagnitude.set(rawSpectrum.magnitude);
    smoothedPower.set(rawSpectrum.power);
    smoothedDbfs.set(rawSpectrum.spectrumDbfs);
  }

  const dominantFrequencyHz = computeDominantFrequency(
    smoothedMagnitude,
    sampleRate,
    fftSize
  );
  const spectralCentroidHz = computeSpectralCentroid(
    smoothedMagnitude,
    sampleRate,
    fftSize
  );
  const spectralBandwidthHz = computeSpectralBandwidth(
    smoothedMagnitude,
    spectralCentroidHz,
    sampleRate,
    fftSize
  );
  const spectralFlatness = computeSpectralFlatness(smoothedPower);
  const bandEnergy = computeBandEnergy(smoothedPower, sampleRate, fftSize);

  const noiseFloorDbfs = options.noiseFloorTracker
    ? options.noiseFloorTracker.update(rmsDbfs)
    : rmsDbfs;
  const snrDb = Math.max(0, rmsDbfs - noiseFloorDbfs);
  const isActive =
    rmsDbfs >= activityThresholdDbfs || (snrDb >= 6 && rmsDbfs > -75);

  // Waveform is included only for transient visualization; callers that do not
  // need it should null it out to honor the no-PCM-retention boundary.
  const waveformCopy = new Float32Array(samples.length);
  waveformCopy.set(samples);

  const frame: DspFrame = {
    timestampMs,
    sampleRate,
    fftSize,
    binWidthHz: sampleRate / fftSize,
    rms,
    peak,
    rmsDbfs,
    peakDbfs,
    crestFactorDb,
    dominantFrequencyHz,
    spectralCentroidHz,
    spectralBandwidthHz,
    spectralFlatness,
    zeroCrossingRate: zcr,
    zcrFrequencyHz,
    bandEnergy,
    noiseFloorDbfs,
    snrDb,
    isActive,
    waveform: waveformCopy,
    spectrumDbfs: smoothedDbfs,
    powerSpectrum: smoothedPower,
  };

  return { frame, smoothedMagnitude };
}
