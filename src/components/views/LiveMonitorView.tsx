import { useState } from 'react';
import type { ComponentProps } from 'react';
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

type MetricTileModel = ComponentProps<typeof MetricTile>;

interface BandRow {
  label: string;
  pct: number;
  dbfs: number;
  color: string;
}

function buildSignalStateTile(frame: DspFrame | null): MetricTileModel {
  return {
    label: 'Signal State',
    value: !frame ? 'STANDBY' : frame.isActive ? 'ACTIVE' : 'QUIET',
    accent: !frame ? 'neutral' : frame.isActive ? 'green' : 'amber',
    subtext: frame
      ? `SNR +${frame.snrDb.toFixed(1)} dB | Floor ${frame.noiseFloorDbfs.toFixed(1)}`
      : 'No input stream',
  };
}

function buildRmsTile(frame: DspFrame | null): MetricTileModel {
  return {
    label: 'RMS Amplitude',
    value: frame ? frame.rms.toFixed(4) : '—',
    unit: 'FS',
    subtext: frame ? `${frame.rmsDbfs.toFixed(1)} dBFS` : 'Uncalibrated',
  };
}

function buildPeakTile(frame: DspFrame | null): MetricTileModel {
  return {
    label: 'Peak Amplitude',
    value: frame ? frame.peak.toFixed(4) : '—',
    unit: 'FS',
    subtext: frame
      ? `${frame.peakDbfs.toFixed(1)} dBFS | Crest ${frame.crestFactorDb.toFixed(1)} dB`
      : undefined,
  };
}

function buildDominantFrequencyTile(frame: DspFrame | null): MetricTileModel {
  return {
    label: 'Dominant Freq',
    value:
      frame && frame.dominantFrequencyHz > 0
        ? frame.dominantFrequencyHz.toFixed(1)
        : '—',
    unit: 'Hz',
    accent: 'green',
    subtext: frame
      ? `Bin Δf = ${frame.binWidthHz.toFixed(1)} Hz`
      : undefined,
  };
}

function buildCentroidTile(frame: DspFrame | null): MetricTileModel {
  return {
    label: 'Spectral Centroid',
    value: frame ? frame.spectralCentroidHz.toFixed(0) : '—',
    unit: 'Hz',
    subtext: frame
      ? `Bandwidth ${frame.spectralBandwidthHz.toFixed(0)} Hz`
      : undefined,
  };
}

function buildFlatnessTile(frame: DspFrame | null): MetricTileModel {
  return {
    label: 'Flatness / ZCR',
    value: frame ? frame.spectralFlatness.toFixed(3) : '—',
    accent: frame && frame.spectralFlatness > 0.35 ? 'amber' : 'neutral',
    subtext: frame
      ? `ZCR ${(frame.zeroCrossingRate * 100).toFixed(2)}% (~${frame.zcrFrequencyHz.toFixed(0)} Hz)`
      : undefined,
  };
}

function buildMetricTiles(frame: DspFrame | null): MetricTileModel[] {
  return [
    buildSignalStateTile(frame),
    buildRmsTile(frame),
    buildPeakTile(frame),
    buildDominantFrequencyTile(frame),
    buildCentroidTile(frame),
    buildFlatnessTile(frame),
  ];
}

function MetricGrid({ frame }: { frame: DspFrame | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {buildMetricTiles(frame).map((tile) => (
        <MetricTile key={tile.label} {...tile} />
      ))}
    </div>
  );
}

function ControlStrip({
  mode,
  frequencyScale,
  showPeakHold,
  onFrequencyScaleChange,
  onEnableMicrophone,
  onStopCapture,
  onStartSyntheticDefault,
  onShowPeakHoldChange,
}: Pick<
  LiveMonitorViewProps,
  | 'mode'
  | 'frequencyScale'
  | 'onFrequencyScaleChange'
  | 'onEnableMicrophone'
  | 'onStopCapture'
  | 'onStartSyntheticDefault'
> & {
  showPeakHold: boolean;
  onShowPeakHoldChange: (value: boolean) => void;
}) {
  return (
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
            onChange={(e) => onShowPeakHoldChange(e.target.checked)}
          />
          PEAK HOLD
        </label>
      </div>
    </div>
  );
}

function PrimaryCanvases({
  frame,
  postFrame,
  frequencyScale,
  showPeakHold,
}: Pick<LiveMonitorViewProps, 'frame' | 'postFrame' | 'frequencyScale'> & {
  showPeakHold: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <WaveformCanvas
          frame={frame}
          secondaryFrame={postFrame}
          label={
            postFrame
              ? 'OSCILLOSCOPE // GREEN=ORIGINAL, AMBER=TRANSFORMED (EXP D)'
              : 'OSCILLOSCOPE // TIME DOMAIN (PCM [-1.0, +1.0])'
          }
        />
        <SpectrumCanvas
          frame={frame}
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

      <SpectrogramCanvas frame={frame} scale={frequencyScale} />
    </>
  );
}

function lowBandRow(frame: DspFrame | null): BandRow {
  return {
    label: 'LOW BAND (20 – 250 Hz)',
    pct: frame ? frame.bandEnergy.lowRatio * 100 : 0,
    dbfs: frame ? frame.bandEnergy.lowDbfs : -120,
    color: 'bg-[#22c55e]',
  };
}

function midBandRow(frame: DspFrame | null): BandRow {
  return {
    label: 'MID BAND (250 – 2,000 Hz)',
    pct: frame ? frame.bandEnergy.midRatio * 100 : 0,
    dbfs: frame ? frame.bandEnergy.midDbfs : -120,
    color: 'bg-[#4ade80]',
  };
}

function highBandRow(frame: DspFrame | null): BandRow {
  return {
    label: 'HIGH BAND (2,000 Hz – Nyquist)',
    pct: frame ? frame.bandEnergy.highRatio * 100 : 0,
    dbfs: frame ? frame.bandEnergy.highDbfs : -120,
    color: 'bg-[#f59e0b]',
  };
}

function buildBandRows(frame: DspFrame | null): BandRow[] {
  return [lowBandRow(frame), midBandRow(frame), highBandRow(frame)];
}

function BandEnergyPanel({ frame }: { frame: DspFrame | null }) {
  return (
    <div className="panel-border rounded-sm p-3 space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[#86efac] tracking-wider">
          FREQUENCY BAND ENERGY DISTRIBUTION
        </span>
        <span className="text-[11px] text-[#6e8a78]">
          {frame ? `${frame.sampleRate} Hz Sample Rate` : '—'}
        </span>
      </div>

      {buildBandRows(frame).map((b) => (
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
  );
}

function ActivityPanel({ activity }: { activity: ActivityInferenceResult | null }) {
  return (
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
  );
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

  return (
    <div className="space-y-4">
      <ControlStrip
        mode={mode}
        frequencyScale={frequencyScale}
        showPeakHold={showPeakHold}
        onShowPeakHoldChange={setShowPeakHold}
        onFrequencyScaleChange={onFrequencyScaleChange}
        onEnableMicrophone={onEnableMicrophone}
        onStopCapture={onStopCapture}
        onStartSyntheticDefault={onStartSyntheticDefault}
      />
      <PrimaryCanvases
        frame={frame}
        postFrame={postFrame}
        frequencyScale={frequencyScale}
        showPeakHold={showPeakHold}
      />
      <MetricGrid frame={frame} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BandEnergyPanel frame={frame} />
        <ActivityPanel activity={activity} />
      </div>
    </div>
  );
}
