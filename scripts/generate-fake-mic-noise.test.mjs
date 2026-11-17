// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FAKE_MIC_NOISE_DEFAULTS,
  encodeMono16BitWav,
  generateFakeMicNoiseWav,
  generatePinkNoiseSamples,
  normalizeToRms,
} from './generate-fake-mic-noise.mjs';

function decodedStats(wav) {
  const count = wav.length / 2 - 22;
  let sum = 0;
  let diffSum = 0;
  let peak = 0;
  let prev = 0;
  for (let i = 0; i < count; i += 1) {
    const sample = wav.readInt16LE(44 + i * 2) / 32767;
    sum += sample * sample;
    const diff = sample - prev;
    diffSum += diff * diff;
    prev = sample;
    if (Math.abs(sample) > peak) peak = Math.abs(sample);
  }
  const rms = Math.sqrt(sum / count);
  return { count, rms, peak, diffRatio: Math.sqrt(diffSum / count) / rms };
}

describe('generateFakeMicNoiseWav', () => {
  it('is byte-identical for the same options (deterministic input)', () => {
    const first = generateFakeMicNoiseWav({ seconds: 1 });
    const second = generateFakeMicNoiseWav({ seconds: 1 });
    expect(first.equals(second)).toBe(true);
  });

  it('changes output when the seed changes', () => {
    const first = generateFakeMicNoiseWav({ seconds: 1, seed: 1 });
    const second = generateFakeMicNoiseWav({ seconds: 1, seed: 2 });
    expect(first.equals(second)).toBe(false);
  });

  it('writes a valid 16-bit mono PCM WAV header', () => {
    const wav = generateFakeMicNoiseWav({ seconds: 1 });
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(FAKE_MIC_NOISE_DEFAULTS.sampleRate);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
  });

  it('encodes the requested duration at the requested sample rate', () => {
    const wav = generateFakeMicNoiseWav({ seconds: 2, sampleRate: 48000 });
    expect(wav.readUInt32LE(40)).toBe(2 * 48000 * 2);
    expect(wav.length).toBe(44 + 2 * 48000 * 2);
  });

  it('normalizes broadband noise near the target RMS without clipping', () => {
    const wav = generateFakeMicNoiseWav({ seconds: 3 });
    const stats = decodedStats(wav);
    const rmsDbfs = 20 * Math.log10(stats.rms);
    expect(rmsDbfs).toBeCloseTo(FAKE_MIC_NOISE_DEFAULTS.targetRmsDbfs, 1);
    expect(stats.peak).toBeLessThanOrEqual(FAKE_MIC_NOISE_DEFAULTS.maxPeak);
  });

  it('produces pink-ish noise (low-frequency dominated, not white)', () => {
    const wav = generateFakeMicNoiseWav({ seconds: 3 });
    const stats = decodedStats(wav);
    expect(stats.diffRatio).toBeLessThan(1);
  });
});

describe('normalizeToRms', () => {
  it('peak-limits instead of clipping when RMS gain would overshoot', () => {
    const samples = new Float32Array([0.9, -0.9, 0.9, -0.9]);
    const leveled = normalizeToRms(samples, 0, 0.5);
    for (const sample of leveled) {
      expect(Math.abs(sample)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});

describe('generatePinkNoiseSamples', () => {
  it('returns the requested sample count', () => {
    const samples = generatePinkNoiseSamples({
      seconds: 0.5,
      sampleRate: 8000,
      seed: 42,
    });
    expect(samples.length).toBe(4000);
  });
});

describe('encodeMono16BitWav', () => {
  it('round-trips sample polarity and approximate level', () => {
    const wav = encodeMono16BitWav(new Float32Array([0.5, -0.5]), 48000);
    expect(wav.readInt16LE(44)).toBeGreaterThan(16000);
    expect(wav.readInt16LE(46)).toBeLessThan(-16000);
  });
});
