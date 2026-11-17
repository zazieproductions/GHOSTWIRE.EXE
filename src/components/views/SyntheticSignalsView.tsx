import { useState } from 'react';
import { analyzeTimeDomainFrame } from '../../dsp/metrics';
import {
  SYNTHETIC_PRESETS,
  generateSyntheticSamples,
  type SyntheticPreset,
} from '../../dsp/synthetic';
import type {
  DspFrame,
  FrequencyScale,
  InputMode,
  SyntheticSignalConfig,
  SyntheticSignalType,
} from '../../types/acoustic';
import { SpectrumCanvas } from '../visualizations/SpectrumCanvas';
import { WaveformCanvas } from '../visualizations/WaveformCanvas';

interface SyntheticSignalsViewProps {
  mode: InputMode;
  config: SyntheticSignalConfig;
  frame: DspFrame | null;
  frequencyScale: FrequencyScale;
  onChangeConfig: (next: SyntheticSignalConfig, restartIfRunning?: boolean) => void;
  onStartSynthetic: (cfg?: SyntheticSignalConfig) => void;
  onStopCapture: () => void;
}

interface VerificationCheck {
  name: string;
  expected: string;
  measured: string;
  passed: boolean;
}

function runDspVerificationChecks(cfg: SyntheticSignalConfig): VerificationCheck[] {
  const sampleRate = 48000;
  const fftSize = 4096;
  const samples = generateSyntheticSamples(cfg, sampleRate, fftSize, 0, 1337);
  const { frame } = analyzeTimeDomainFrame(samples, { sampleRate, fftSize });
  const checks: VerificationCheck[] = [];

  if (cfg.type === 'sine') {
    const expectedRms = cfg.amplitude / Math.SQRT2;
    const expectedDbfs = 20 * Math.log10(expectedRms);
    const freqErr = Math.abs(frame.dominantFrequencyHz - cfg.frequencyHz);
    const rmsErr = Math.abs(frame.rms - expectedRms);
    checks.push({
      name: 'Sine RMS Accuracy',
      expected: `${expectedRms.toFixed(4)} FS (${expectedDbfs.toFixed(1)} dBFS)`,
      measured: `${frame.rms.toFixed(4)} FS (${frame.rmsDbfs.toFixed(1)} dBFS)`,
      passed: rmsErr < 0.015,
    });
    checks.push({
      name: 'Dominant Frequency Accuracy',
      expected: `${cfg.frequencyHz.toFixed(1)} Hz (±12 Hz)`,
      measured: `${frame.dominantFrequencyHz.toFixed(1)} Hz`,
      passed: freqErr < 12,
    });
    checks.push({
      name: 'Narrowband Spectral Flatness',
      expected: '< 0.05',
      measured: frame.spectralFlatness.toFixed(4),
      passed: frame.spectralFlatness < 0.05,
    });
  } else if (cfg.type === 'white' || cfg.type === 'pink') {
    checks.push({
      name: 'Broadband Spectral Flatness',
      expected: cfg.type === 'white' ? '> 0.42' : '> 0.12',
      measured: frame.spectralFlatness.toFixed(4),
      passed:
        cfg.type === 'white'
          ? frame.spectralFlatness > 0.42
          : frame.spectralFlatness > 0.12,
    });
    checks.push({
      name: 'Wide Spectral Bandwidth',
      expected: '> 1500 Hz',
      measured: `${frame.spectralBandwidthHz.toFixed(0)} Hz`,
      passed: frame.spectralBandwidthHz > 1500,
    });
  } else if (cfg.type === 'hum') {
    checks.push({
      name: 'Low-Band Energy Concentration (<250 Hz)',
      expected: '> 80%',
      measured: `${(frame.bandEnergy.lowRatio * 100).toFixed(1)}%`,
      passed: frame.bandEnergy.lowRatio > 0.8,
    });
    checks.push({
      name: 'Mains Fundamental Peak',
      expected: `${cfg.humMainsHz} Hz (±12 Hz)`,
      measured: `${frame.dominantFrequencyHz.toFixed(1)} Hz`,
      passed: Math.abs(frame.dominantFrequencyHz - cfg.humMainsHz) < 12,
    });
  } else if (cfg.type === 'impulse') {
    checks.push({
      name: 'High Impulsive Crest Factor',
      expected: '> 10.0 dB',
      measured: `${frame.crestFactorDb.toFixed(1)} dB`,
      passed: frame.crestFactorDb > 10,
    });
  } else {
    checks.push({
      name: 'Non-Zero Signal Energy',
      expected: '> -60 dBFS',
      measured: `${frame.rmsDbfs.toFixed(1)} dBFS`,
      passed: frame.rmsDbfs > -60,
    });
  }

  return checks;
}

export function SyntheticSignalsView({
  mode,
  config,
  frame,
  frequencyScale,
  onChangeConfig,
  onStartSynthetic,
  onStopCapture,
}: SyntheticSignalsViewProps) {
  const [verificationChecks, setVerificationChecks] = useState<VerificationCheck[] | null>(
    null
  );

  const isRunningSynthetic = mode === 'synthetic';

  const applyPreset = (preset: SyntheticPreset) => {
    const next = {
      ...preset.config,
      monitorAudio: config.monitorAudio,
      monitorGain: config.monitorGain,
    };
    onChangeConfig(next, false);
    onStartSynthetic(next);
    setVerificationChecks(runDspVerificationChecks(next));
  };

  const updateField = <K extends keyof SyntheticSignalConfig>(
    key: K,
    value: SyntheticSignalConfig[K]
  ) => {
    const next = { ...config, [key]: value };
    onChangeConfig(next, isRunningSynthetic);
  };

  const signalTypes: Array<{ value: SyntheticSignalType; label: string }> = [
    { value: 'sine', label: 'Pure Sine Wave' },
    { value: 'white', label: 'White Noise' },
    { value: 'pink', label: 'Pink Noise (1/f)' },
    { value: 'sweep', label: 'Log Frequency Sweep' },
    { value: 'impulse', label: 'Periodic Impulses' },
    { value: 'mixed', label: 'Mixed Tonal + Noise' },
    { value: 'hum', label: 'Simulated Mains Hum' },
  ];

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            SYNTHETIC SIGNAL LABORATORY // ZERO-PERMISSION LOCAL DSP TESTBENCH
          </div>
          <div className="text-[11px] text-[#7a9384]">
            Generates deterministic local waveforms routed through the identical Web Audio AnalyserNode &amp; DSP engine used for microphones.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isRunningSynthetic ? (
            <button
              type="button"
              onClick={() => onStartSynthetic(config)}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#14532d] hover:bg-[#166534] text-[#bbf7d0] border border-[#22c55e]/50 cursor-pointer"
            >
              START SYNTHETIC STREAM
            </button>
          ) : (
            <button
              type="button"
              onClick={onStopCapture}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] hover:bg-[#92400e] text-[#fde68a] border border-[#f59e0b]/60 cursor-pointer"
            >
              STOP SYNTHETIC STREAM
            </button>
          )}

          <button
            type="button"
            onClick={() => setVerificationChecks(runDspVerificationChecks(config))}
            className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#101c22] hover:bg-[#162730] text-[#93c5fd] border border-[#3b82f6]/40 cursor-pointer"
          >
            RUN DSP NUMERICAL CHECKS
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="panel-border rounded-sm p-3 space-y-2">
        <div className="text-xs font-semibold text-[#86efac] tracking-wider">
          RESEARCH DEMONSTRATION PRESETS
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {SYNTHETIC_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className="text-left p-2.5 rounded-sm border border-[#1d2d24] bg-[#090e11] hover:border-[#22c55e]/60 hover:bg-[#0d1812] transition-colors cursor-pointer space-y-1"
            >
              <div className="text-[11px] font-bold text-[#86efac]">
                {preset.name}
              </div>
              <div className="text-[10px] text-[#7a9384] leading-snug">
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Generator Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="panel-border rounded-sm p-3 space-y-2.5">
          <div className="font-semibold text-[#86efac]">SIGNAL TOPOLOGY</div>
          <label className="block space-y-1">
            <span className="text-[11px] text-[#7a9384]">Waveform / Source Type</span>
            <select
              value={config.type}
              onChange={(e) =>
                updateField('type', e.target.value as SyntheticSignalType)
              }
              className="w-full bg-[#06090b] border border-[#1f2e25] px-2 py-1.5 rounded-xs text-xs text-[#e2efe6]"
            >
              {signalTypes.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#7a9384]">Primary Amplitude</span>
              <span className="tabular-nums">{config.amplitude.toFixed(2)} FS</span>
            </div>
            <input
              type="range"
              min={0.02}
              max={0.95}
              step={0.01}
              value={config.amplitude}
              onChange={(e) => updateField('amplitude', Number(e.target.value))}
              className="w-full"
            />
          </label>

          {(config.type === 'mixed' || config.type === 'hum' || config.type === 'impulse') && (
            <label className="block space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#7a9384]">Broadband Noise Mix</span>
                <span className="tabular-nums">{config.noiseAmplitude.toFixed(3)} FS</span>
              </div>
              <input
                type="range"
                min={0}
                max={0.4}
                step={0.005}
                value={config.noiseAmplitude}
                onChange={(e) =>
                  updateField('noiseAmplitude', Number(e.target.value))
                }
                className="w-full"
              />
            </label>
          )}
        </div>

        <div className="panel-border rounded-sm p-3 space-y-2.5">
          <div className="font-semibold text-[#86efac]">FREQUENCY &amp; TIMING</div>

          {(config.type === 'sine' || config.type === 'mixed') && (
            <label className="block space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#7a9384]">Primary Frequency</span>
                <span className="tabular-nums">{config.frequencyHz} Hz</span>
              </div>
              <input
                type="range"
                min={30}
                max={8000}
                step={10}
                value={config.frequencyHz}
                onChange={(e) => updateField('frequencyHz', Number(e.target.value))}
                className="w-full"
              />
            </label>
          )}

          {config.type === 'mixed' && (
            <label className="block space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#7a9384]">Secondary Tone (-14 dB)</span>
                <span className="tabular-nums">{config.secondaryFrequencyHz} Hz</span>
              </div>
              <input
                type="range"
                min={50}
                max={10000}
                step={10}
                value={config.secondaryFrequencyHz}
                onChange={(e) =>
                  updateField('secondaryFrequencyHz', Number(e.target.value))
                }
                className="w-full"
              />
            </label>
          )}

          {config.type === 'hum' && (
            <div className="space-y-1">
              <div className="text-[11px] text-[#7a9384]">AC Mains Fundamental</div>
              <div className="flex gap-2">
                {([50, 60] as const).map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    onClick={() => updateField('humMainsHz', hz)}
                    className={`flex-1 py-1.5 rounded-xs border text-xs cursor-pointer ${
                      config.humMainsHz === hz
                        ? 'border-[#22c55e] bg-[#11271a] text-[#86efac]'
                        : 'border-[#1f2e25] bg-[#080c0f] text-[#7a9384]'
                    }`}
                  >
                    {hz} Hz
                  </button>
                ))}
              </div>
            </div>
          )}

          {config.type === 'sweep' && (
            <>
              <label className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#7a9384]">Sweep Start → End</span>
                  <span className="tabular-nums">
                    {config.sweepStartHz} → {config.sweepEndHz} Hz
                  </span>
                </div>
                <input
                  type="range"
                  min={500}
                  max={12000}
                  step={100}
                  value={config.sweepEndHz}
                  onChange={(e) =>
                    updateField('sweepEndHz', Number(e.target.value))
                  }
                  className="w-full"
                />
              </label>
              <label className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#7a9384]">Sweep Duration</span>
                  <span className="tabular-nums">{config.sweepDurationSec} s</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={config.sweepDurationSec}
                  onChange={(e) =>
                    updateField('sweepDurationSec', Number(e.target.value))
                  }
                  className="w-full"
                />
              </label>
            </>
          )}

          {config.type === 'impulse' && (
            <label className="block space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#7a9384]">Impulse Repetition Rate</span>
                <span className="tabular-nums">{config.impulseRateHz} Hz</span>
              </div>
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={config.impulseRateHz}
                onChange={(e) =>
                  updateField('impulseRateHz', Number(e.target.value))
                }
                className="w-full"
              />
            </label>
          )}
        </div>

        {/* Audio Output Monitor (muted by default) */}
        <div className="panel-border rounded-sm p-3 space-y-2.5">
          <div className="font-semibold text-[#86efac]">LOCAL SPEAKER MONITOR</div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={config.monitorAudio}
              onChange={(e) => updateField('monitorAudio', e.target.checked)}
            />
            <span>Audition synthetic signal via speakers</span>
          </label>
          <label className="block space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#7a9384]">Monitor Gain (Capped 0.30)</span>
              <span className="tabular-nums">{(config.monitorGain * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.3}
              step={0.01}
              value={config.monitorGain}
              onChange={(e) => updateField('monitorGain', Number(e.target.value))}
              className="w-full"
            />
          </label>
          <p className="text-[11px] text-[#6e8a78]">
            Muted by default. Synthetic DSP analysis always runs regardless of speaker monitoring.
          </p>
        </div>
      </div>

      {/* Live Preview Canvases */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <WaveformCanvas frame={frame} height={150} />
        <SpectrumCanvas frame={frame} scale={frequencyScale} height={150} />
      </div>

      {/* Verification Panel */}
      {verificationChecks && (
        <div className="panel-border rounded-sm p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#86efac]">
              DSP NUMERICAL SELF-VERIFICATION ({config.type.toUpperCase()})
            </span>
            <span className="text-[11px] text-[#7a9384]">
              Computed directly on 4096-sample @ 48 kHz synthetic frame
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {verificationChecks.map((chk) => (
              <div
                key={chk.name}
                className={`p-2 rounded-xs border text-[11px] ${
                  chk.passed
                    ? 'border-[#22c55e]/50 bg-[#0d1c13]'
                    : 'border-[#ef4444]/60 bg-[#1f0d0d]'
                }`}
              >
                <div className="flex justify-between font-semibold mb-1">
                  <span className="text-[#e2efe6]">{chk.name}</span>
                  <span className={chk.passed ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                    {chk.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <div className="text-[#86a390]">Expected: {chk.expected}</div>
                <div className="text-[#d2e4d8]">Measured: {chk.measured}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
