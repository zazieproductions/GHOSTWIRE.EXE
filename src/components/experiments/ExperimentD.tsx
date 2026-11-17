import { EXPERIMENT_PROTOCOLS } from '../../data/protocols';
import type {
  DspFrame,
  FrequencyScale,
  InputMode,
  TransformConfig,
} from '../../types/acoustic';
import { ProtocolCard } from '../common/ProtocolCard';
import { SpectrumCanvas } from '../visualizations/SpectrumCanvas';
import { WaveformCanvas } from '../visualizations/WaveformCanvas';

interface ExperimentDProps {
  mode: InputMode;
  preFrame: DspFrame | null;
  postFrame: DspFrame | null;
  transformConfig: TransformConfig;
  frequencyScale: FrequencyScale;
  onChangeTransform: (next: TransformConfig) => void;
}

export function ExperimentD({
  mode,
  preFrame,
  postFrame,
  transformConfig,
  frequencyScale,
  onChangeTransform,
}: ExperimentDProps) {
  const activePost = transformConfig.enabled ? postFrame : null;

  const update = (patch: Partial<TransformConfig>) => {
    onChangeTransform({ ...transformConfig, ...patch });
  };

  const liveObs: string[] = [];
  if (preFrame && activePost) {
    liveObs.push(
      `RMS Δ: ${(activePost.rmsDbfs - preFrame.rmsDbfs).toFixed(1)} dB (${preFrame.rmsDbfs.toFixed(1)} → ${activePost.rmsDbfs.toFixed(1)} dBFS)`
    );
    liveObs.push(
      `Dominant Frequency: ${preFrame.dominantFrequencyHz.toFixed(1)} Hz → ${activePost.dominantFrequencyHz.toFixed(1)} Hz`
    );
    liveObs.push(
      `Spectral Flatness: ${preFrame.spectralFlatness.toFixed(3)} → ${activePost.spectralFlatness.toFixed(3)}`
    );
  } else {
    liveObs.push('Enable Transformation Pipeline with an active signal to observe pre/post deltas.');
  }

  const deltaRows =
    preFrame && activePost
      ? [
          {
            metric: 'RMS Level (dBFS)',
            orig: `${preFrame.rmsDbfs.toFixed(1)} dBFS`,
            proc: `${activePost.rmsDbfs.toFixed(1)} dBFS`,
            delta: `${(activePost.rmsDbfs - preFrame.rmsDbfs).toFixed(1)} dB`,
          },
          {
            metric: 'Dominant Freq (Hz)',
            orig: `${preFrame.dominantFrequencyHz.toFixed(1)} Hz`,
            proc: `${activePost.dominantFrequencyHz.toFixed(1)} Hz`,
            delta: `${(activePost.dominantFrequencyHz - preFrame.dominantFrequencyHz).toFixed(1)} Hz`,
          },
          {
            metric: 'Spectral Centroid (Hz)',
            orig: `${preFrame.spectralCentroidHz.toFixed(0)} Hz`,
            proc: `${activePost.spectralCentroidHz.toFixed(0)} Hz`,
            delta: `${(activePost.spectralCentroidHz - preFrame.spectralCentroidHz).toFixed(0)} Hz`,
          },
          {
            metric: 'Spectral Bandwidth (Hz)',
            orig: `${preFrame.spectralBandwidthHz.toFixed(0)} Hz`,
            proc: `${activePost.spectralBandwidthHz.toFixed(0)} Hz`,
            delta: `${(activePost.spectralBandwidthHz - preFrame.spectralBandwidthHz).toFixed(0)} Hz`,
          },
          {
            metric: 'Spectral Flatness',
            orig: preFrame.spectralFlatness.toFixed(3),
            proc: activePost.spectralFlatness.toFixed(3),
            delta: (activePost.spectralFlatness - preFrame.spectralFlatness).toFixed(3),
          },
          {
            metric: 'Low Band (<250 Hz)',
            orig: `${(preFrame.bandEnergy.lowRatio * 100).toFixed(1)}%`,
            proc: `${(activePost.bandEnergy.lowRatio * 100).toFixed(1)}%`,
            delta: `${((activePost.bandEnergy.lowRatio - preFrame.bandEnergy.lowRatio) * 100).toFixed(1)}%`,
          },
          {
            metric: 'High Band (>=2 kHz)',
            orig: `${(preFrame.bandEnergy.highRatio * 100).toFixed(1)}%`,
            proc: `${(activePost.bandEnergy.highRatio * 100).toFixed(1)}%`,
            delta: `${((activePost.bandEnergy.highRatio - preFrame.bandEnergy.highRatio) * 100).toFixed(1)}%`,
          },
        ]
      : [];

  return (
    <div className="space-y-4">
      <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            EXPERIMENT D // SIGNAL TRANSFORMATION &amp; FEATURE ALTERATION
          </div>
          <div className="text-[11px] text-[#7a9384]">
            Real-time Web Audio processing chain comparing Original (green) vs Transformed (amber) spectra.
          </div>
        </div>

        <label className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-[#22c55e]/50 bg-[#0e2016] text-xs font-semibold text-[#86efac] cursor-pointer">
          <input
            type="checkbox"
            checked={transformConfig.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          ENABLE TRANSFORMATION PIPELINE
        </label>
      </div>

      {mode === 'idle' && (
        <div className="border border-[#f59e0b]/40 bg-[#181207] text-[#fcd34d] px-3 py-2 text-xs rounded-sm">
          Input is IDLE. Start Synthetic Signals (try &ldquo;Frequency Masking&rdquo; or &ldquo;Electrical Hum&rdquo;) or Enable Microphone to measure live transformations.
        </div>
      )}

      {/* Controls Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
        {/* Gain */}
        <div className="panel-border rounded-sm p-3 space-y-2">
          <div className="flex justify-between">
            <span className="font-semibold text-[#86efac]">Gain Adjustment</span>
            <span className="tabular-nums text-[#e2efe6]">
              {transformConfig.gainDb >= 0 ? '+' : ''}
              {transformConfig.gainDb.toFixed(1)} dB
            </span>
          </div>
          <input
            type="range"
            min={-24}
            max={24}
            step={0.5}
            value={transformConfig.gainDb}
            onChange={(e) => update({ gainDb: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-[#6e8a78]">
            Scales absolute amplitude &amp; dBFS while preserving normalized spectral ratios (unless clipped).
          </p>
        </div>

        {/* High-pass */}
        <div className="panel-border rounded-sm p-3 space-y-2">
          <div className="flex justify-between items-center">
            <label className="flex items-center gap-2 font-semibold text-[#86efac] cursor-pointer">
              <input
                type="checkbox"
                checked={transformConfig.highPassEnabled}
                onChange={(e) => update({ highPassEnabled: e.target.checked })}
              />
              High-Pass Filter
            </label>
            <span className="tabular-nums">{transformConfig.highPassHz} Hz</span>
          </div>
          <input
            type="range"
            min={20}
            max={2000}
            step={10}
            value={transformConfig.highPassHz}
            onChange={(e) => update({ highPassHz: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-[#6e8a78]">
            Attenuates 50/60 Hz mains hum, rumble, and HVAC sub-bass; reduces low-frequency side channels.
          </p>
        </div>

        {/* Low-pass */}
        <div className="panel-border rounded-sm p-3 space-y-2">
          <div className="flex justify-between items-center">
            <label className="flex items-center gap-2 font-semibold text-[#86efac] cursor-pointer">
              <input
                type="checkbox"
                checked={transformConfig.lowPassEnabled}
                onChange={(e) => update({ lowPassEnabled: e.target.checked })}
              />
              Low-Pass Filter
            </label>
            <span className="tabular-nums">{transformConfig.lowPassHz} Hz</span>
          </div>
          <input
            type="range"
            min={500}
            max={16000}
            step={100}
            value={transformConfig.lowPassHz}
            onChange={(e) => update({ lowPassHz: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-[#6e8a78]">
            Suppresses high-frequency hiss, coil whine, and crisp transient edges while preserving low-band hum.
          </p>
        </div>

        {/* Noise Gate */}
        <div className="panel-border rounded-sm p-3 space-y-2">
          <div className="flex justify-between items-center">
            <label className="flex items-center gap-2 font-semibold text-[#86efac] cursor-pointer">
              <input
                type="checkbox"
                checked={transformConfig.noiseGateEnabled}
                onChange={(e) => update({ noiseGateEnabled: e.target.checked })}
              />
              Noise Gate
            </label>
            <span className="tabular-nums">{transformConfig.noiseGateThresholdDbfs} dBFS</span>
          </div>
          <input
            type="range"
            min={-80}
            max={-10}
            step={1}
            value={transformConfig.noiseGateThresholdDbfs}
            onChange={(e) =>
              update({ noiseGateThresholdDbfs: Number(e.target.value) })
            }
            className="w-full"
          />
          <p className="text-[11px] text-[#6e8a78]">
            Silences quiet intervals below threshold, hiding ambient noise-floor fingerprints while exposing gate-open cadence.
          </p>
        </div>

        {/* Noise Injection */}
        <div className="panel-border rounded-sm p-3 space-y-2 md:col-span-2">
          <div className="flex justify-between items-center">
            <label className="flex items-center gap-2 font-semibold text-[#fbbf24] cursor-pointer">
              <input
                type="checkbox"
                checked={transformConfig.noiseInjectionEnabled}
                onChange={(e) =>
                  update({ noiseInjectionEnabled: e.target.checked })
                }
              />
              Synthetic Broadband Noise Injection
            </label>
            <span className="tabular-nums">{transformConfig.noiseInjectionDbfs} dBFS</span>
          </div>
          <input
            type="range"
            min={-60}
            max={-6}
            step={1}
            value={transformConfig.noiseInjectionDbfs}
            onChange={(e) =>
              update({ noiseInjectionDbfs: Number(e.target.value) })
            }
            className="w-full"
          />
          <p className="text-[11px] text-[#6e8a78]">
            Adds local white noise into the processed branch to demonstrate acoustic masking of weak tonal side channels and flatness elevation.
          </p>
        </div>
      </div>

      {/* Dual Visualizations */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SpectrumCanvas
          frame={preFrame}
          secondaryFrame={activePost}
          scale={frequencyScale}
          showPeakHold={false}
          label="ORIGINAL (GREEN) VS PROCESSED (AMBER) SPECTRUM"
        />
        <WaveformCanvas
          frame={preFrame}
          secondaryFrame={activePost}
          label="ORIGINAL (GREEN) VS PROCESSED (AMBER) WAVEFORM"
        />
      </div>

      {/* Numerical Comparison Table */}
      <div className="panel-border rounded-sm overflow-hidden">
        <div className="panel-header px-3 py-1.5 text-[11px] font-semibold text-[#86efac]">
          REAL-TIME FEATURE DELTA (ORIGINAL VS TRANSFORMED)
        </div>
        {deltaRows.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#18231d] text-[#6e8a78] text-[11px]">
                <th className="text-left px-3 py-1.5">Acoustic Feature</th>
                <th className="text-right px-3 py-1.5">Original</th>
                <th className="text-right px-3 py-1.5">Processed</th>
                <th className="text-right px-3 py-1.5">Delta</th>
              </tr>
            </thead>
            <tbody>
              {deltaRows.map((r) => (
                <tr key={r.metric} className="border-b border-[#121c16] text-[11px]">
                  <td className="px-3 py-1.5 text-[#c5d4ca]">{r.metric}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#4ade80]">
                    {r.orig}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#fbbf24]">
                    {r.proc}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#e2efe6]">
                    {r.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4 text-xs text-[#6e8a78]">
            Enable the Transformation Pipeline above while an audio source is running to compare real-time measurements.
          </div>
        )}
      </div>

      <ProtocolCard
        protocol={EXPERIMENT_PROTOCOLS.D}
        liveObservations={liveObs}
      />
    </div>
  );
}
