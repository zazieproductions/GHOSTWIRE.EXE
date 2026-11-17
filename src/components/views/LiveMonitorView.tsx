import { useState } from 'react';
import type {
  ActivityInferenceResult,
  DspFrame,
  FrequencyScale,
  InputMode,
} from '../../types/acoustic';
import { MetricTile } from '../common/MetricTile';
import { SpectrogramCanvas } from '../visualizations/SpectrogramCanvas';
import { SpectrumCanvas } from '../visualizations/SpectrumCanvas';
import { WaveformCanvas } from '../visualizations/WaveformCanvas';

interface LiveMonitorViewProps {
  mode: InputMode;
  frame: DspFrame | null;
  postFrame: DspFrame | null;
  activity: ActivityInferenceResult | null;
  frequencyScale: FrequencyScale;
  onFrequencyScaleChange: (scale: FrequencyScale) => void;
  onEnableMicrophone: () => void;
  onStopCapture: () => void;
  onStartSyntheticDefault: () => void;
}

export function LiveMonitorView({
  mode,
  frame,
  postFrame,
  activity,
  frequencyScale,
  onFrequencyScaleChange,
  onEnableMicrophone,
  onStopCapture,
  onStartSyntheticDefault,
}: LiveMonitorViewProps) {
  const [showPeakHold, setShowPeakHold] = useState(true);

  const activeFrame = frame;
  const lowPct = activeFrame ? activeFrame.bandEnergy.lowRatio * 100 : 0;
  const midPct = activeFrame ? activeFrame.bandEnergy.midRatio * 100 : 0;
  const highPct = activeFrame ? activeFrame.bandEnergy.highRatio * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Control Strip */}
      <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            LIVE ACOUSTIC TELEMETRY // REAL-TIME WEB AUDIO DSP
          </div>
          <div className="text-[11px] text-[#7a9384]">
            All dBFS readings are uncalibrated digital levels relative to full-scale PCM (±1.0),{' '}
            <span className="text-[#fbbf24]">not physical dB SPL</span>.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode !== 'microphone' ? (
            <button
              type="button"
              onClick={onEnableMicrophone}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#14532d] hover:bg-[#166534] text-[#bbf7d0] border border-[#22c55e]/50 transition-colors cursor-pointer"
            >
              ENABLE MICROPHONE
            </button>
          ) : (
            <button
              type="button"
              onClick={onStopCapture}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#7f1d1d] hover:bg-[#991b1b] text-[#fecaca] border border-[#ef4444]/60 transition-colors cursor-pointer"
            >
              STOP MICROPHONE
            </button>
          )}

          {mode === 'idle' && (
            <button
              type="button"
              onClick={onStartSyntheticDefault}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#102119] hover:bg-[#152d22] text-[#86efac] border border-[#244734] transition-colors cursor-pointer"
            >
              RUN SYNTHETIC TEST SIGNAL
            </button>
          )}

          <div className="flex items-center gap-1 border border-[#1b2821] rounded-sm px-2 py-1 text-[11px]">
            <span className="text-[#6e8a78] mr-1">SCALE:</span>
            <button
              type="button"
              onClick={() => onFrequencyScaleChange('log')}
              className={`px-1.5 py-0.5 rounded-sm cursor-pointer ${
                frequencyScale === 'log'
                  ? 'bg-[#1a3325] text-[#86efac]'
                  : 'text-[#6e8a78] hover:text-[#c8d6cc]'
              }`}
            >
              LOG
            </button>
            <button
              type="button"
              onClick={() => onFrequencyScaleChange('linear')}
              className={`px-1.5 py-0.5 rounded-sm cursor-pointer ${
                frequencyScale === 'linear'
                  ? 'bg-[#1a3325] text-[#86efac]'
                  : 'text-[#6e8a78] hover:text-[#c8d6cc]'
              }`}
            >
              LIN
            </button>
          </div>

          <label className="flex items-center gap-1.5 text-[11px] text-[#86a390] border border-[#1b2821] rounded-sm px-2.5 py-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showPeakHold}
              onChange={(e) => setShowPeakHold(e.target.checked)}
            />
            PEAK HOLD
          </label>
        </div>
      </div>

      {/* Primary Canvases */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <WaveformCanvas
          frame={activeFrame}
          secondaryFrame={postFrame}
          label={
            postFrame
              ? 'OSCILLOSCOPE // GREEN=ORIGINAL, AMBER=TRANSFORMED (EXP D)'
              : 'OSCILLOSCOPE // TIME DOMAIN (PCM [-1.0, +1.0])'
          }
        />
        <SpectrumCanvas
          frame={activeFrame}
          secondaryFrame={postFrame}
          scale={frequencyScale}
          showPeakHold={showPeakHold}
          label={
            postFrame
              ? 'FFT SPECTRUM // GREEN=ORIGINAL, AMBER=TRANSFORMED (EXP D)'
              : 'FFT MAGNITUDE SPECTRUM // dBFS (HANN WINDOWED)'
          }
        />
      </div>

      <SpectrogramCanvas frame={activeFrame} scale={frequencyScale} />

      {/* Signal Measurements Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <MetricTile
          label="Signal State"
          value={
            !activeFrame
              ? 'STANDBY'
              : activeFrame.isActive
                ? 'ACTIVE'
                : 'QUIET'
          }
          accent={
            !activeFrame
              ? 'neutral'
              : activeFrame.isActive
                ? 'green'
                : 'amber'
          }
          subtext={
            activeFrame
              ? `SNR +${activeFrame.snrDb.toFixed(1)} dB | Floor ${activeFrame.noiseFloorDbfs.toFixed(1)}`
              : 'No input stream'
          }
        />
        <MetricTile
          label="RMS Amplitude"
          value={activeFrame ? activeFrame.rms.toFixed(4) : '—'}
          unit="FS"
          subtext={
            activeFrame ? `${activeFrame.rmsDbfs.toFixed(1)} dBFS` : 'Uncalibrated'
          }
        />
        <MetricTile
          label="Peak Amplitude"
          value={activeFrame ? activeFrame.peak.toFixed(4) : '—'}
          unit="FS"
          subtext={
            activeFrame
              ? `${activeFrame.peakDbfs.toFixed(1)} dBFS | Crest ${activeFrame.crestFactorDb.toFixed(1)} dB`
              : undefined
          }
        />
        <MetricTile
          label="Dominant Freq"
          value={
            activeFrame && activeFrame.dominantFrequencyHz > 0
              ? activeFrame.dominantFrequencyHz.toFixed(1)
              : '—'
          }
          unit="Hz"
          accent="green"
          subtext={
            activeFrame
              ? `Bin Δf = ${activeFrame.binWidthHz.toFixed(1)} Hz`
              : undefined
          }
        />
        <MetricTile
          label="Spectral Centroid"
          value={activeFrame ? activeFrame.spectralCentroidHz.toFixed(0) : '—'}
          unit="Hz"
          subtext={
            activeFrame
              ? `Bandwidth ${activeFrame.spectralBandwidthHz.toFixed(0)} Hz`
              : undefined
          }
        />
        <MetricTile
          label="Flatness / ZCR"
          value={activeFrame ? activeFrame.spectralFlatness.toFixed(3) : '—'}
          accent={
            activeFrame && activeFrame.spectralFlatness > 0.35
              ? 'amber'
              : 'neutral'
          }
          subtext={
            activeFrame
              ? `ZCR ${(activeFrame.zeroCrossingRate * 100).toFixed(2)}% (~${activeFrame.zcrFrequencyHz.toFixed(0)} Hz)`
              : undefined
          }
        />
      </div>

      {/* Band Energy Distribution & Live Activity Inference Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="panel-border rounded-sm p-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#86efac] tracking-wider">
              FREQUENCY BAND ENERGY DISTRIBUTION
            </span>
            <span className="text-[11px] text-[#6e8a78]">
              {activeFrame ? `${activeFrame.sampleRate} Hz Sample Rate` : '—'}
            </span>
          </div>

          {[
            {
              label: 'LOW BAND (20 – 250 Hz)',
              pct: lowPct,
              dbfs: activeFrame?.bandEnergy.lowDbfs ?? -120,
              color: 'bg-[#22c55e]',
            },
            {
              label: 'MID BAND (250 – 2,000 Hz)',
              pct: midPct,
              dbfs: activeFrame?.bandEnergy.midDbfs ?? -120,
              color: 'bg-[#4ade80]',
            },
            {
              label: 'HIGH BAND (2,000 Hz – Nyquist)',
              pct: highPct,
              dbfs: activeFrame?.bandEnergy.highDbfs ?? -120,
              color: 'bg-[#f59e0b]',
            },
          ].map((b) => (
            <div key={b.label} className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#a5baad]">{b.label}</span>
                <span className="tabular-nums text-[#d8e6dd]">
                  {b.pct.toFixed(1)}% ({b.dbfs.toFixed(1)} dBFS)
                </span>
              </div>
              <div className="h-2 bg-[#070a0c] border border-[#18241d] rounded-xs overflow-hidden">
                <div
                  className={`h-full ${b.color} transition-all duration-100`}
                  style={{ width: `${Math.min(100, Math.max(0, b.pct))}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="panel-border rounded-sm p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#86efac] tracking-wider">
              TRANSPARENT ACTIVITY HEURISTICS (ROLLING WINDOW)
            </span>
            <span className="text-[11px] text-[#6e8a78]">
              {activity ? `${activity.frameCount} frames` : 'Waiting'}
            </span>
          </div>
          {activity && activity.classifications.length > 0 ? (
            <div className="space-y-1.5">
              {activity.classifications.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center justify-between px-2 py-1 rounded-xs border text-[11px] ${
                    c.detected
                      ? 'border-[#22c55e]/45 bg-[#0e1f16] text-[#bbf7d0]'
                      : 'border-[#16221b] bg-[#090d10] text-[#647b6d]'
                  }`}
                >
                  <span className="font-semibold">
                    [{c.detected ? 'DETECTED' : 'OFF'}] {c.label}
                  </span>
                  <span className="truncate max-w-[55%] text-right">
                    {c.measuredEvidence}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[#5e7a68] py-4">
              Start Microphone or Synthetic Signals to populate real-time activity classification metrics.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
