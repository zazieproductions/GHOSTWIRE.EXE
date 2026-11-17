#!/usr/bin/env node
/**
 * Deterministic broadband-noise WAV generator for GHOSTWIRE.EXE screenshots.
 *
 * Produces the file-backed fake-microphone input described in the README
 * screenshots note: Chromium is launched with
 * `--use-file-for-fake-audio-capture=<wav>`, so Experiment A's microphone
 * window analyses this noise instead of the default fake-device beep.
 *
 * The output is fully deterministic for a given seed: a seeded Xorshift32
 * PRNG (mirroring `src/dsp/synthetic.ts`) drives Paul Kellet's pink-noise
 * filter, the result is normalized to a target RMS, peak-limited, and
 * encoded as 16-bit mono PCM — the safest shape for Chromium's capture path.
 *
 * Library usage: import { generateFakeMicNoiseWav } from this module, then
 * call `generateFakeMicNoiseWav({ seconds: 10 })` to get the WAV bytes.
 *
 * CLI usage:
 *   node scripts/generate-fake-mic-noise.mjs <output.wav> [--seconds 10]
 *     [--sample-rate 48000] [--seed 20261117] [--target-rms-dbfs -18]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_MIC_NOISE_DEFAULTS = {
  seconds: 10,
  sampleRate: 48000,
  seed: 20261117,
  targetRmsDbfs: -18,
  maxPeak: 0.95,
};

/**
 * Seeded Xorshift32 PRNG returning values in [-1, 1].
 */
function createNoisePrng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2147483647.5 - 1;
  };
}

function createPinkFilterState() {
  return { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
}

function stepPinkFilter(filter, white) {
  filter.b0 = 0.99886 * filter.b0 + white * 0.0555179;
  filter.b1 = 0.99332 * filter.b1 + white * 0.0750759;
  filter.b2 = 0.969 * filter.b2 + white * 0.153852;
  filter.b3 = 0.8665 * filter.b3 + white * 0.3104856;
  filter.b4 = 0.55 * filter.b4 + white * 0.5329522;
  filter.b5 = -0.7616 * filter.b5 - white * 0.016898;
  const pink =
    (filter.b0 +
      filter.b1 +
      filter.b2 +
      filter.b3 +
      filter.b4 +
      filter.b5 +
      filter.b6 +
      white * 0.5362) *
    0.11;
  filter.b6 = white * 0.115926;
  return pink;
}

/**
 * Generate raw pink-noise samples. Deterministic for a fixed seed.
 */
export function generatePinkNoiseSamples({ seconds, sampleRate, seed }) {
  const total = Math.max(1, Math.floor(seconds * sampleRate));
  const output = new Float32Array(total);
  const rand = createNoisePrng(seed);
  const filter = createPinkFilterState();
  for (let w = 0; w < 64; w += 1) stepPinkFilter(filter, rand());
  for (let i = 0; i < total; i += 1) {
    output[i] = stepPinkFilter(filter, rand());
  }
  return output;
}

function rmsOf(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Normalize samples to a target RMS (dBFS), then peak-limit. Returns a
 * new array; the input is left untouched.
 */
export function normalizeToRms(samples, targetRmsDbfs, maxPeak) {
  const targetRms = Math.pow(10, targetRmsDbfs / 20);
  const currentRms = rmsOf(samples);
  const rmsGain = currentRms > 0 ? targetRms / currentRms : 1;
  const output = new Float32Array(samples.length);
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    output[i] = samples[i] * rmsGain;
    const abs = Math.abs(output[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > maxPeak) {
    const peakGain = maxPeak / peak;
    for (let i = 0; i < output.length; i += 1) output[i] *= peakGain;
  }
  return output;
}

/**
 * Encode mono float samples as a 16-bit PCM WAV Buffer.
 */
export function encodeMono16BitWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

/**
 * Generate the complete fake-microphone WAV file as a Buffer.
 */
export function generateFakeMicNoiseWav(options = {}) {
  const config = { ...FAKE_MIC_NOISE_DEFAULTS, ...options };
  const raw = generatePinkNoiseSamples(config);
  const leveled = normalizeToRms(
    raw,
    config.targetRmsDbfs,
    config.maxPeak
  );
  return encodeMono16BitWav(leveled, config.sampleRate);
}

function printUsage() {
  console.log(
    'Usage: node scripts/generate-fake-mic-noise.mjs <output.wav> [options]\n' +
      '\n' +
      'Options:\n' +
      '  --seconds <n>          Duration in seconds (default 10)\n' +
      '  --sample-rate <hz>     Sample rate in Hz (default 48000)\n' +
      '  --seed <int>           PRNG seed (default 20261117)\n' +
      '  --target-rms-dbfs <db> Target RMS level (default -18)\n'
  );
}

function readNumericFlag(argv, index, name) {
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Option ${name} expects a numeric value.`);
  }
  return value;
}

function parseCliArgs(argv) {
  const options = {};
  let output = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--seconds') options.seconds = readNumericFlag(argv, i, arg);
    else if (arg === '--sample-rate') {
      options.sampleRate = readNumericFlag(argv, i, arg);
    } else if (arg === '--seed') options.seed = readNumericFlag(argv, i, arg);
    else if (arg === '--target-rms-dbfs') {
      options.targetRmsDbfs = readNumericFlag(argv, i, arg);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!output) {
      output = arg;
    }
    if (arg.startsWith('--') && arg !== '--help' && arg !== '-h') i += 1;
  }
  return { help: false, output, options };
}

function runCli(argv) {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    printUsage();
    return;
  }
  if (!parsed.output) {
    printUsage();
    throw new Error('Missing required <output.wav> path.');
  }
  const wav = generateFakeMicNoiseWav(parsed.options);
  fs.writeFileSync(parsed.output, wav);
  console.log(`Wrote ${wav.length} bytes to ${parsed.output}`);
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    runCli(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
