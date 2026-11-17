import { describe, expect, it } from 'vitest';
import {
  buildEnvironmentalFingerprint,
  buildLogBandBinMap,
  compareFingerprints,
  computeLogBandEdges,
  inferBroadActivity,
} from '../analysis';
import { computeHannSpectrum } from '../fft';
import {
  amplitudeToDbfs,
  analyzeTimeDomainFrame,
  computeBandEnergy,
  computeDominantFrequency,
  computePeak,
  computeRms,
  computeSpectralBandwidth,
  computeSpectralCentroid,
  computeSpectralFlatness,
  computeZeroCrossingRate,
  toActivityFrame,
  toFeatureFrame,
} from '../metrics';
import {
  DEFAULT_SYNTHETIC_CONFIG,
  SYNTHETIC_PRESETS,
  generateSyntheticSamples,
} from '../synthetic';
import {
  buildMeasurementSession,
  exportSessionToCsv,
  exportSessionToHtmlReport,
  exportSessionToJson,
  frameToSessionSample,
  sanitizeCsvText,
  toCsvField,
} from '../../utils/exportSession';
import type { DspFrame } from '../../types/acoustic';

describe('DSP Core Metrics', () => {
  const sampleRate = 48000;
  const fftSize = 2048;

  it('computes exact RMS, peak, and dBFS for a full-scale sine wave', () => {
    // Bin-aligned frequency: k = 40 -> f = 40 * 48000 / 2048 = 937.5 Hz
    const freq = (40 * sampleRate) / fftSize;
    const samples = generateSyntheticSamples(
      { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: freq, amplitude: 1.0 },
      sampleRate,
      fftSize
    );
    // Clamp in generator is [-1, 1], amplitude=0.98 max in generator; test raw sine directly too:
    const rawSine = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      rawSine[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }

    const rms = computeRms(rawSine);
    const peak = computePeak(rawSine);
    expect(rms).toBeCloseTo(1 / Math.SQRT2, 3);
    expect(peak).toBeCloseTo(1.0, 3);
    expect(amplitudeToDbfs(peak)).toBeCloseTo(0.0, 2);
    expect(amplitudeToDbfs(rms)).toBeCloseTo(-3.01, 1);

    // Silence floor
    expect(amplitudeToDbfs(0)).toBe(-120);
    expect(amplitudeToDbfs(1e-8)).toBe(-120);
    expect(samples.length).toBe(fftSize);
  });

  it('computes accurate zero-crossing rate for pure sinusoids and zero for silence', () => {
    const freq = 1000;
    const n = 4096;
    const sine = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sine[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    const { zcr, zcrFrequencyHz } = computeZeroCrossingRate(sine, sampleRate);
    const expectedZcr = (2 * freq) / sampleRate;
    expect(zcr).toBeCloseTo(expectedZcr, 3);
    expect(Math.abs(zcrFrequencyHz - freq)).toBeLessThan(20);

    const silence = new Float32Array(n);
    const silentZcr = computeZeroCrossingRate(silence, sampleRate);
    expect(silentZcr.zcr).toBe(0);
    expect(silentZcr.zcrFrequencyHz).toBe(0);
  });

  it('computes dominant frequency, spectral centroid, bandwidth, and flatness accurately', () => {
    const freq = 1000;
    const sine = generateSyntheticSamples(
      { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: freq, amplitude: 0.5 },
      sampleRate,
      fftSize
    );
    const spec = computeHannSpectrum(sine, fftSize);
    const dom = computeDominantFrequency(spec.magnitude, sampleRate, fftSize);
    const centroid = computeSpectralCentroid(spec.magnitude, sampleRate, fftSize);
    const bandwidth = computeSpectralBandwidth(
      spec.magnitude,
      centroid,
      sampleRate,
      fftSize
    );
    const flatness = computeSpectralFlatness(spec.power);

    expect(Math.abs(dom - freq)).toBeLessThan(8);
    expect(Math.abs(centroid - freq)).toBeLessThan(40);
    expect(bandwidth).toBeLessThan(250);
    expect(flatness).toBeLessThan(0.03);

    // White noise should have high flatness (~0.56) and wide bandwidth
    const white = generateSyntheticSamples(
      { ...DEFAULT_SYNTHETIC_CONFIG, type: 'white', amplitude: 0.5 },
      sampleRate,
      fftSize
    );
    const whiteSpec = computeHannSpectrum(white, fftSize);
    const whiteFlatness = computeSpectralFlatness(whiteSpec.power);
    const whiteCentroid = computeSpectralCentroid(
      whiteSpec.magnitude,
      sampleRate,
      fftSize
    );
    const whiteBw = computeSpectralBandwidth(
      whiteSpec.magnitude,
      whiteCentroid,
      sampleRate,
      fftSize
    );
    expect(whiteFlatness).toBeGreaterThan(0.42);
    expect(whiteBw).toBeGreaterThan(4000);
  });

  it('computes low, mid, and high frequency band energy distribution correctly', () => {
    // Low band: 120 Hz
    const lowSig = generateSyntheticSamples(
      { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: 120, amplitude: 0.5 },
      sampleRate,
      4096
    );
    const lowBands = computeBandEnergy(
      computeHannSpectrum(lowSig, 4096).power,
      sampleRate,
      4096
    );
    expect(lowBands.lowRatio).toBeGreaterThan(0.95);

    // Mid band: 1000 Hz
    const midSig = generateSyntheticSamples(
      { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: 1000, amplitude: 0.5 },
      sampleRate,
      4096
    );
    const midBands = computeBandEnergy(
      computeHannSpectrum(midSig, 4096).power,
      sampleRate,
      4096
    );
    expect(midBands.midRatio).toBeGreaterThan(0.95);

    // High band: 5000 Hz
    const highSig = generateSyntheticSamples(
      { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: 5000, amplitude: 0.5 },
      sampleRate,
      4096
    );
    const highBands = computeBandEnergy(
      computeHannSpectrum(highSig, 4096).power,
      sampleRate,
      4096
    );
    expect(highBands.highRatio).toBeGreaterThan(0.95);
    expect(highBands.lowRatio + highBands.midRatio + highBands.highRatio).toBeCloseTo(1, 5);
  });
});

describe('Synthetic Presets & Experiment Analysis', () => {
  const sampleRate = 48000;
  const fftSize = 2048;

  it('generates valid verifiable signals for all 5 research presets', () => {
    for (const preset of SYNTHETIC_PRESETS) {
      const samples = generateSyntheticSamples(preset.config, sampleRate, 4096);
      const { frame } = analyzeTimeDomainFrame(samples, { sampleRate, fftSize: 4096 });
      expect(frame.rms).toBeGreaterThan(0.01);
      expect(frame.rmsDbfs).toBeGreaterThan(-60);
    }
  });

  it('compares two environmental fingerprints accurately', () => {
    const humPreset = SYNTHETIC_PRESETS.find((p) => p.id === 'electrical_hum')!;
    const tonePreset = SYNTHETIC_PRESETS.find((p) => p.id === 'tonal_interference')!;

    const buildFrames = (cfg: typeof humPreset.config): DspFrame[] => {
      const frames: DspFrame[] = [];
      for (let i = 0; i < 12; i++) {
        const buf = generateSyntheticSamples(cfg, sampleRate, fftSize, i * fftSize, 100 + i);
        const { frame } = analyzeTimeDomainFrame(buf, {
          sampleRate,
          fftSize,
          timestampMs: 1000 + i * 50,
        });
        frames.push(frame);
      }
      return frames;
    };

    const fpHum1 = buildEnvironmentalFingerprint(buildFrames(humPreset.config), 'Hum 1', 'synthetic');
    const fpHum2 = buildEnvironmentalFingerprint(buildFrames(humPreset.config), 'Hum 2', 'synthetic');
    const fpTone = buildEnvironmentalFingerprint(buildFrames(tonePreset.config), 'Tone', 'synthetic');

    const sameCmp = compareFingerprints(fpHum1, fpHum2);
    expect(sameCmp.cosineSimilarity).toBeGreaterThan(0.98);
    expect(Math.abs(sameCmp.noiseFloorDeltaDb)).toBeLessThan(1.5);

    const diffCmp = compareFingerprints(fpHum1, fpTone);
    expect(diffCmp.cosineSimilarity).toBeLessThan(0.35);
    expect(diffCmp.bandDeltas.lowDeltaPct).toBeLessThan(-50);
  });

  it('infers broad activity states transparently (quiet, tonal, broadband, repetitive transients)', () => {
    // 1. Quiet
    const quietFrames: DspFrame[] = [];
    for (let i = 0; i < 20; i++) {
      const { frame } = analyzeTimeDomainFrame(new Float32Array(fftSize), {
        sampleRate,
        fftSize,
        timestampMs: i * 50,
      });
      quietFrames.push(frame);
    }
    const quietRes = inferBroadActivity(quietFrames, -50);
    expect(quietRes.classifications.find((c) => c.id === 'quiet')?.detected).toBe(true);

    // 2. Sustained tonal
    const tonalFrames: DspFrame[] = [];
    for (let i = 0; i < 25; i++) {
      const buf = generateSyntheticSamples(
        { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: 880, amplitude: 0.4 },
        sampleRate,
        fftSize,
        i * fftSize
      );
      const { frame } = analyzeTimeDomainFrame(buf, {
        sampleRate,
        fftSize,
        timestampMs: i * 45,
      });
      tonalFrames.push(frame);
    }
    const tonalRes = inferBroadActivity(tonalFrames, -50);
    expect(tonalRes.classifications.find((c) => c.id === 'sustained_tonal')?.detected).toBe(true);

    // 3. Repetitive 4 Hz impulses across 2.5 seconds
    const impulsePreset = SYNTHETIC_PRESETS.find((p) => p.id === 'repetitive_transients')!;
    const impulseFrames: DspFrame[] = [];
    const totalFrames = 60;
    const hopSamples = Math.round(sampleRate * 0.042); // ~24 fps
    const longBuf = generateSyntheticSamples(
      impulsePreset.config,
      sampleRate,
      totalFrames * hopSamples + fftSize
    );
    for (let i = 0; i < totalFrames; i++) {
      const slice = longBuf.subarray(i * hopSamples, i * hopSamples + fftSize);
      const { frame } = analyzeTimeDomainFrame(slice, {
        sampleRate,
        fftSize,
        timestampMs: i * 42,
      });
      impulseFrames.push(frame);
    }
    const impRes = inferBroadActivity(impulseFrames, -50);
    expect(impRes.classifications.find((c) => c.id === 'transient_impulse')?.detected).toBe(true);
    expect(impRes.classifications.find((c) => c.id === 'repetitive_events')?.detected).toBe(true);
    expect(impRes.detectedPeriodHz).not.toBeNull();
    expect(Math.abs((impRes.detectedPeriodHz ?? 0) - 4)).toBeLessThan(0.8);
  });

  it('builds and exports valid CSV, JSON, and HTML session reports with privacy notices', () => {
    const buf = generateSyntheticSamples(
      { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: 440, amplitude: 0.5 },
      sampleRate,
      fftSize
    );
    const { frame } = analyzeTimeDomainFrame(buf, { sampleRate, fftSize, timestampMs: 1000 });
    const samplePt = frameToSessionSample(frame, 0.25);

    const session = buildMeasurementSession({
      id: 'sess-test',
      name: 'Calibration Test',
      startedAtIso: '2026-11-17T00:00:00.000Z',
      endedAtIso: '2026-11-17T00:00:02.000Z',
      durationSec: 2,
      sourceMode: 'synthetic',
      sampleRate,
      fftSize,
      samples: [samplePt],
      framesForFingerprint: [frame],
    });

    const csv = exportSessionToCsv(session);
    expect(csv).toContain('rms_dbfs');
    expect(csv).toContain('PRIVACY NOTICE');
    expect(csv).toContain('0.25,');

    const json = JSON.parse(exportSessionToJson(session));
    expect(json.containsRawAudio).toBe(false);
    expect(json.privacyNotice).toContain('aggregate acoustic features');
    expect(json.session.summary.sampleCount).toBe(1);

    const html = exportSessionToHtmlReport(session);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Calibration Test');
    expect(html).toContain('PRIVACY NOTICE');
  });
});

describe('Audit remediation: retention, comparability and export safety', () => {
  const sampleRate = 48000;
  const fftSize = 2048;

  const frameFrom = (
    config = DEFAULT_SYNTHETIC_CONFIG,
    timestampMs = 1000,
    rate = sampleRate
  ): DspFrame => {
    const buf = generateSyntheticSamples(config, rate, fftSize, 0, 42);
    return analyzeTimeDomainFrame(buf, {
      sampleRate: rate,
      fftSize,
      timestampMs,
    }).frame;
  };

  const framesFrom = (
    config = DEFAULT_SYNTHETIC_CONFIG,
    count = 6,
    rate = sampleRate
  ): DspFrame[] =>
    Array.from({ length: count }, (_, i) =>
      frameFrom(config, 1000 + i * 50, rate)
    );

  it('projects live frames onto feature-only and activity-only shapes with no PCM', () => {
    const frame = frameFrom();
    const feature = toFeatureFrame(frame);
    const activity = toActivityFrame(frame);

    expect('waveform' in feature).toBe(false);
    expect('waveform' in activity).toBe(false);
    expect('powerSpectrum' in activity).toBe(false);
    expect('spectrumDbfs' in activity).toBe(false);
    expect(activity.rmsDbfs).toBeCloseTo(frame.rmsDbfs, 10);
    expect(feature.powerSpectrum.length).toBe(frame.powerSpectrum.length);
  });

  it('assigns each FFT bin to exactly one log band (no overlapping integration)', () => {
    const edges = computeLogBandEdges(20, sampleRate / 2, 32);
    const binToBand = buildLogBandBinMap(fftSize, sampleRate, edges);
    const binWidth = sampleRate / fftSize;

    let previousBand = -1;
    let assigned = 0;
    for (let k = 1; k < binToBand.length; k++) {
      const band = binToBand[k];
      if (band < 0) continue;
      const freq = k * binWidth;
      expect(freq).toBeGreaterThanOrEqual(edges[band].lowHz);
      // The top band includes Nyquist itself, so allow floating-point slack.
      expect(freq).toBeLessThanOrEqual(edges[band].highHz + 1e-6);
      // Bands receive contiguous, non-repeating bin ranges: no double counting.
      expect(band).toBeGreaterThanOrEqual(previousBand);
      previousBand = band;
      assigned++;
    }

    expect(assigned).toBeGreaterThan(0);
    expect(assigned).toBeLessThanOrEqual(binToBand.length - 1);
  });

  it('normalises band power and treats a silent window as having no spectral evidence', () => {
    const silence = new Float32Array(fftSize);
    const silentFrames = Array.from({ length: 5 }, (_, i) =>
      analyzeTimeDomainFrame(silence, {
        sampleRate,
        fftSize,
        timestampMs: 1000 + i * 50,
      }).frame
    );
    const silentFp = buildEnvironmentalFingerprint(
      silentFrames,
      'Silence',
      'synthetic'
    );
    expect(silentFp.logBandDistribution.reduce((s, v) => s + v, 0)).toBe(0);
    expect(silentFp.excludedFrameCount).toBe(0);

    const silentCmp = compareFingerprints(silentFp, silentFp);
    expect(silentCmp.comparable).toBe(false);
    expect(silentCmp.incompatibilityReasons.join(' ')).toMatch(
      /no measurable spectral power/i
    );

    const hum = SYNTHETIC_PRESETS.find((p) => p.id === 'electrical_hum')!;
    const humFp = buildEnvironmentalFingerprint(
      framesFrom(hum.config),
      'Hum',
      'synthetic'
    );
    const total = humFp.logBandDistribution.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(compareFingerprints(humFp, humFp).comparable).toBe(true);
  });

  it('refuses to score fingerprints measured on incompatible grids', () => {
    const tone = {
      ...DEFAULT_SYNTHETIC_CONFIG,
      type: 'sine' as const,
      frequencyHz: 440,
      amplitude: 0.4,
    };
    const at48k = buildEnvironmentalFingerprint(framesFrom(tone), '48k', 'synthetic');
    const at44k = buildEnvironmentalFingerprint(
      framesFrom(tone, 6, 44100),
      '44k',
      'synthetic'
    );

    const cmp = compareFingerprints(at48k, at44k);
    expect(cmp.comparable).toBe(false);
    expect(cmp.confidenceLabel).toBe('Low');
    expect(cmp.incompatibilityReasons.join(' ')).toMatch(/sample rates differ/i);
    expect(cmp.interpretation).toMatch(/NOT COMPARABLE/);
  });

  it('excludes frames captured on a different grid and counts them', () => {
    const mixed = [
      ...framesFrom(DEFAULT_SYNTHETIC_CONFIG, 3),
      ...framesFrom(DEFAULT_SYNTHETIC_CONFIG, 2, 44100),
    ];
    const fp = buildEnvironmentalFingerprint(mixed, 'Mixed', 'microphone');
    expect(fp.frameCount).toBe(3);
    expect(fp.excludedFrameCount).toBe(2);
    expect(fp.sampleRate).toBe(48000);
  });

  it('keeps exported sessions free of PCM and neutralises CSV injection', () => {
    const frame = frameFrom();
    const session = buildMeasurementSession({
      id: 'sess-injection',
      name: 'Bad\n=HYPERLINK("http://evil")',
      startedAtIso: '2026-11-17T00:00:00.000Z',
      endedAtIso: '2026-11-17T00:00:01.000Z',
      durationSec: 1,
      sourceMode: 'microphone',
      sampleRate: null,
      fftSize,
      samples: [frameToSessionSample(frame, 0)],
      framesForFingerprint: [toFeatureFrame(frame)],
    });

    const csv = exportSessionToCsv(session);
    expect(csv.split('\n').filter((l) => l.startsWith('# Session:'))).toHaveLength(1);
    expect(csv).not.toContain('\n=HYPERLINK');
    expect(csv).toContain('Sample Rate: unknown Hz');

    const json = exportSessionToJson(session);
    // The privacy notice mentions "waveform" in prose, so check keys, not text.
    const keys = new Set<string>();
    JSON.parse(json, (key, value) => {
      keys.add(key);
      return value;
    });
    expect(keys.has('waveform')).toBe(false);
    expect(keys.has('powerSpectrum')).toBe(false);
    expect(keys.has('spectrumDbfs')).toBe(false);

    expect(sanitizeCsvText('a\r\nb\u0000c')).toBe('a b c');
    expect(toCsvField('=1+1')).toBe("'=1+1");
    expect(toCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(toCsvField('plain')).toBe('plain');
    expect(toCsvField(-3.5)).toBe('-3.5');
  });
});
