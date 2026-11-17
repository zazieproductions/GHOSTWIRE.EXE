import type { SyntheticSignalConfig } from '../types/acoustic';

export interface SyntheticPreset {
  id: string;
  name: string;
  description: string;
  expectedBehavior: string;
  config: SyntheticSignalConfig;
}

export const DEFAULT_SYNTHETIC_CONFIG: SyntheticSignalConfig = {
  type: 'sine',
  frequencyHz: 440,
  secondaryFrequencyHz: 1000,
  amplitude: 0.35,
  noiseAmplitude: 0.05,
  sweepStartHz: 100,
  sweepEndHz: 4000,
  sweepDurationSec: 4,
  impulseRateHz: 4,
  humMainsHz: 60,
  monitorAudio: false,
  monitorGain: 0.08,
};

export const SYNTHETIC_PRESETS: SyntheticPreset[] = [
  {
    id: 'electrical_hum',
    name: 'Electrical Hum (60 Hz + Harmonics)',
    description:
      'Simulates AC mains electromagnetic/acoustic coupling: 60 Hz fundamental plus 2nd–5th harmonics (120, 180, 240, 300 Hz) over a low noise floor.',
    expectedBehavior:
      'Low-band energy (>85% below 250 Hz), dominant peak near 60 Hz, low spectral centroid (<220 Hz), low spectral flatness.',
    config: {
      ...DEFAULT_SYNTHETIC_CONFIG,
      type: 'hum',
      humMainsHz: 60,
      amplitude: 0.4,
      noiseAmplitude: 0.015,
    },
  },
  {
    id: 'broadband_noise',
    name: 'Broadband Noise (Pink Floor)',
    description:
      'Continuous 1/f pink noise simulating HVAC airflow, fan turbulence, or diffuse ambient room noise.',
    expectedBehavior:
      'Elevated spectral flatness (>0.35), wide spectral bandwidth (>1500 Hz), low crest factor (~6–10 dB), distributed band energy.',
    config: {
      ...DEFAULT_SYNTHETIC_CONFIG,
      type: 'pink',
      amplitude: 0.25,
      noiseAmplitude: 0.25,
    },
  },
  {
    id: 'tonal_interference',
    name: 'Tonal Interference (1850 Hz + 3700 Hz)',
    description:
      'Simulates switching power supply coil whine or narrowband acoustic resonance with a second harmonic.',
    expectedBehavior:
      'Sharp spectral peaks at 1850 Hz and 3700 Hz, very low spectral flatness (<0.12), high mid/high band concentration.',
    config: {
      ...DEFAULT_SYNTHETIC_CONFIG,
      type: 'mixed',
      frequencyHz: 1850,
      secondaryFrequencyHz: 3700,
      amplitude: 0.32,
      noiseAmplitude: 0.01,
    },
  },
  {
    id: 'repetitive_transients',
    name: 'Repetitive Transients (4 Hz Impulses)',
    description:
      'Periodic damped impulsive clicks at 4 Hz (250 ms interval) simulating rhythmic mechanical events.',
    expectedBehavior:
      'High crest factor (>12 dB), periodic RMS spikes detected at ~4 Hz by Experiment B periodicity detector.',
    config: {
      ...DEFAULT_SYNTHETIC_CONFIG,
      type: 'impulse',
      impulseRateHz: 4,
      amplitude: 0.75,
      noiseAmplitude: 0.008,
    },
  },
  {
    id: 'frequency_masking',
    name: 'Frequency Masking (150 Hz Masking 240 Hz)',
    description:
      'High-amplitude 150 Hz low-frequency tone alongside a weaker (-18 dB) 240 Hz component, demonstrating how high-pass filtering reveals masked mid/high signals.',
    expectedBehavior:
      'Dominant 150 Hz peak masks the 240 Hz tone in aggregate RMS; enabling a 200 Hz high-pass filter in Experiment D reveals the secondary component.',
    config: {
      ...DEFAULT_SYNTHETIC_CONFIG,
      type: 'mixed',
      frequencyHz: 150,
      secondaryFrequencyHz: 240,
      amplitude: 0.5,
      noiseAmplitude: 0.005,
    },
  },
];

/**
 * Deterministic Xorshift32 PRNG returning values in [-1, 1].
 */
export function createPrng(seed = 0x5f3759df): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2147483647.5 - 1;
  };
}

/**
 * Generate a local synthetic PCM signal into a Float32Array.
 * Completely deterministic for a given `seed` and `startSampleIndex`, making it
 * suitable both for looped Web Audio buffers and exact unit-test verification.
 */
export function generateSyntheticSamples(
  config: SyntheticSignalConfig,
  sampleRate: number,
  numSamples: number,
  startSampleIndex = 0,
  seed = 1337
): Float32Array {
  const output = new Float32Array(numSamples);
  const rand = createPrng(seed);
  const amp = Math.min(0.98, Math.max(0, config.amplitude));
  const noiseAmp = Math.min(0.98, Math.max(0, config.noiseAmplitude));

  // Paul Kellet's 7-stage pink noise filter state
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  // Warm up pink filter slightly so frame start has realistic 1/f slope
  if (config.type === 'pink') {
    for (let w = 0; w < 64; w++) {
      const white = rand();
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      b6 = white * 0.115926;
    }
  }

  const twoPi = 2 * Math.PI;
  const f1 = Math.max(10, Math.min(sampleRate * 0.45, config.frequencyHz));
  const f2 = Math.max(10, Math.min(sampleRate * 0.45, config.secondaryFrequencyHz));

  const sweepDur = Math.max(0.25, config.sweepDurationSec);
  const fStart = Math.max(20, config.sweepStartHz);
  const fEnd = Math.max(fStart + 10, Math.min(sampleRate * 0.45, config.sweepEndHz));
  const sweepK = Math.log(fEnd / fStart);

  const impulseRate = Math.max(0.5, Math.min(30, config.impulseRateHz));
  const impulsePeriodSamples = Math.max(1, Math.round(sampleRate / impulseRate));
  const decayTauSamples = Math.max(12, sampleRate * 0.0035); // 3.5 ms damped mechanical click

  for (let i = 0; i < numSamples; i++) {
    const n = startSampleIndex + i;
    const t = n / sampleRate;
    let sample = 0;

    switch (config.type) {
      case 'sine': {
        sample = amp * Math.sin(twoPi * f1 * t);
        break;
      }

      case 'white': {
        // Uniform white noise scaled so RMS ≈ amp / sqrt(3) or scaled cleanly
        sample = amp * rand();
        break;
      }

      case 'pink': {
        const white = rand();
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
        sample = amp * pink;
        break;
      }

      case 'sweep': {
        // Periodic exponential (log) chirp over sweepDur seconds
        const localT = t % sweepDur;
        const phase =
          twoPi *
          fStart *
          sweepDur *
          ((Math.exp((sweepK * localT) / sweepDur) - 1) / sweepK);
        sample = amp * Math.sin(phase);
        break;
      }

      case 'impulse': {
        const posInPeriod = n % impulsePeriodSamples;
        // Sharp positive/bipolar damped burst (ringing at ~2.4 kHz for physical click spectrum)
        const env = Math.exp(-posInPeriod / decayTauSamples);
        const carrier =
          posInPeriod < 3
            ? 1
            : Math.cos(twoPi * 2400 * (posInPeriod / sampleRate));
        sample = amp * env * carrier + noiseAmp * 0.5 * rand();
        break;
      }

      case 'mixed': {
        // Primary tone + quieter secondary tone (-14 dB relative if masking, or harmonic) + broadband noise
        const primary = amp * 0.82 * Math.sin(twoPi * f1 * t);
        const secondary = amp * 0.16 * Math.sin(twoPi * f2 * t);
        sample = primary + secondary + noiseAmp * rand();
        break;
      }

      case 'hum': {
        const mains = config.humMainsHz;
        const fundamental = 0.65 * Math.sin(twoPi * mains * t);
        const h2 = 0.28 * Math.sin(twoPi * mains * 2 * t + 0.3);
        const h3 = 0.18 * Math.sin(twoPi * mains * 3 * t + 0.7);
        const h4 = 0.08 * Math.sin(twoPi * mains * 4 * t + 1.1);
        const h5 = 0.05 * Math.sin(twoPi * mains * 5 * t + 1.4);
        sample =
          amp * (fundamental + h2 + h3 + h4 + h5) + noiseAmp * rand();
        break;
      }
    }

    output[i] = Math.max(-1, Math.min(1, sample));
  }

  return output;
}
