import { useEffect, useRef, useState } from 'react';
import { EXPERIMENT_PROTOCOLS } from '../../data/protocols';
import { buildEnvironmentalFingerprint } from '../../dsp/analysis';
import type {
  DspFrame,
  EnvironmentalFingerprint,
  FingerprintComparison,
  InputMode,
} from '../../types/acoustic';
import { dspWorkerClient } from '../../workers/dspWorkerClient';
import { MetricTile } from '../common/MetricTile';
import { ProtocolCard } from '../common/ProtocolCard';

interface ExperimentAProps {
  mode: InputMode;
  latestFrame: DspFrame | null;
}

export function ExperimentA({ mode, latestFrame }: ExperimentAProps) {
  const [capturingSlot, setCapturingSlot] = useState<'A' | 'B' | null>(null);
  const [captureBufferCount, setCaptureBufferCount] = useState(0);
  const captureFramesRef = useRef<DspFrame[]>([]);

  const [fpA, setFpA] = useState<EnvironmentalFingerprint | null>(null);
  const [fpB, setFpB] = useState<EnvironmentalFingerprint | null>(null);
  const [comparison, setComparison] = useState<FingerprintComparison | null>(null);
  const [comparing, setComparing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Collect frames while capturing A or B
  useEffect(() => {
    if (!capturingSlot || !latestFrame) return;
    captureFramesRef.current.push(latestFrame);
    setCaptureBufferCount(captureFramesRef.current.length);
  }, [capturingSlot, latestFrame]);

  // Stop capturing automatically if input stops
  useEffect(() => {
    if (mode === 'idle' && capturingSlot) {
      finishCapture();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const startCapture = (slot: 'A' | 'B') => {
    if (mode === 'idle') return;
    captureFramesRef.current = [];
    setCaptureBufferCount(0);
    setCapturingSlot(slot);
    setComparison(null);
  };

  const finishCapture = () => {
    if (!capturingSlot) return;
    const frames = captureFramesRef.current;
    const slot = capturingSlot;
    setCapturingSlot(null);
    if (frames.length === 0) return;
    const fp = buildEnvironmentalFingerprint(
      frames,
      `Window ${slot} (${mode})`,
      mode
    );
    if (slot === 'A') setFpA(fp);
    else setFpB(fp);
  };

  const runComparison = async () => {
    if (!fpA || !fpB) return;
    setComparing(true);
    try {
      const res = await dspWorkerClient.compareFingerprints(fpA, fpB);
      setComparison(res);
    } finally {
      setComparing(false);
    }
  };

  // Auto-run comparison when both fingerprints exist
  useEffect(() => {
    if (fpA && fpB) {
      void runComparison();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fpA, fpB]);

  // Draw 32-band profile comparison canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth || 640;
    const height = 200;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#06090b';
    ctx.fillRect(0, 0, width, height);

    const padL = 40;
    const padR = 14;
    const padT = 16;
    const padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const minDb = -100;
    const maxDb = 0;
    const dbToY = (db: number) =>
      padT + (1 - (Math.max(minDb, Math.min(maxDb, db)) - minDb) / (maxDb - minDb)) * plotH;

    // Grid
    ctx.strokeStyle = '#132018';
    ctx.fillStyle = '#627d6c';
    ctx.font = '10px monospace';
    for (const db of [0, -25, -50, -75, -100]) {
      const y = Math.round(dbToY(db)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(`${db}`, 4, y + 3);
    }

    const drawProfile = (
      fp: EnvironmentalFingerprint,
      color: string
    ) => {
      const bands = fp.logBandDbfs;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < bands.length; i++) {
        const x = padL + (i / (bands.length - 1)) * plotW;
        const y = dbToY(bands[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Axis frequency ticks from band centers
      ctx.fillStyle = '#627d6c';
      for (const idx of [0, 7, 15, 23, 31]) {
        const hz = fp.logBandCentersHz[idx];
        const x = padL + (idx / (bands.length - 1)) * plotW;
        const txt = hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz.toFixed(0)}`;
        ctx.fillText(txt, Math.min(width - 28, x - 8), height - 7);
      }
    };

    if (fpA) drawProfile(fpA, '#22c55e');
    if (fpB) drawProfile(fpB, '#f59e0b');

    if (!fpA && !fpB) {
      ctx.fillStyle = '#52695b';
      ctx.font = '11px monospace';
      ctx.fillText(
        'CAPTURE WINDOW A AND WINDOW B TO PLOT 32-BAND SPECTRAL FINGERPRINT COMPARISON',
        padL + 10,
        padT + plotH / 2
      );
    }

    ctx.restore();
  }, [fpA, fpB]);

  const liveObs: string[] = [];
  if (fpA) {
    liveObs.push(
      `Window A: ${fpA.frameCount} frames (${fpA.durationSec.toFixed(1)}s), floor ${fpA.noiseFloorDbfs.toFixed(1)} dBFS, centroid ${fpA.meanCentroidHz.toFixed(0)} Hz`
    );
  }
  if (fpB) {
    liveObs.push(
      `Window B: ${fpB.frameCount} frames (${fpB.durationSec.toFixed(1)}s), floor ${fpB.noiseFloorDbfs.toFixed(1)} dBFS, centroid ${fpB.meanCentroidHz.toFixed(0)} Hz`
    );
  }
  if (comparison) {
    liveObs.push(
      `Cosine Similarity ${(comparison.cosineSimilarity * 100).toFixed(1)}%, Spectral RMSE ${comparison.spectralDistanceDb.toFixed(1)} dB, Noise Floor Δ ${comparison.noiseFloorDeltaDb >= 0 ? '+' : ''}${comparison.noiseFloorDeltaDb.toFixed(1)} dB`
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            EXPERIMENT A // ENVIRONMENTAL ACOUSTIC FINGERPRINT
          </div>
          <div className="text-[11px] text-[#7a9384]">
            Capture two independent ephemeral spectral profiles (no raw audio stored) and quantify similarity &amp; drift.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {capturingSlot === 'A' ? (
            <button
              type="button"
              onClick={finishCapture}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] text-[#fde68a] border border-[#f59e0b] cursor-pointer"
            >
              FINISH WINDOW A ({captureBufferCount} frames)
            </button>
          ) : (
            <button
              type="button"
              disabled={mode === 'idle' || capturingSlot === 'B'}
              onClick={() => startCapture('A')}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#123321] hover:bg-[#19472e] disabled:opacity-40 text-[#86efac] border border-[#22c55e]/50 cursor-pointer disabled:cursor-not-allowed"
            >
              {fpA ? 'RE-CAPTURE WINDOW A' : 'CAPTURE WINDOW A'}
            </button>
          )}

          {capturingSlot === 'B' ? (
            <button
              type="button"
              onClick={finishCapture}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] text-[#fde68a] border border-[#f59e0b] cursor-pointer"
            >
              FINISH WINDOW B ({captureBufferCount} frames)
            </button>
          ) : (
            <button
              type="button"
              disabled={mode === 'idle' || capturingSlot === 'A'}
              onClick={() => startCapture('B')}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#2b200b] hover:bg-[#3f2e10] disabled:opacity-40 text-[#fcd34d] border border-[#f59e0b]/50 cursor-pointer disabled:cursor-not-allowed"
            >
              {fpB ? 'RE-CAPTURE WINDOW B' : 'CAPTURE WINDOW B'}
            </button>
          )}

          {(fpA || fpB) && (
            <button
              type="button"
              onClick={() => {
                setFpA(null);
                setFpB(null);
                setComparison(null);
              }}
              className="px-2.5 py-1.5 text-xs rounded-sm bg-[#12181c] hover:bg-[#1a2329] text-[#9cb0a3] border border-[#24322a] cursor-pointer"
            >
              RESET WINDOWS
            </button>
          )}
        </div>
      </div>

      {mode === 'idle' && (
        <div className="border border-[#f59e0b]/40 bg-[#181207] text-[#fcd34d] px-3 py-2 text-xs rounded-sm">
          Input is currently IDLE. Enable Microphone or start a Synthetic Signal to capture environmental profiles.
        </div>
      )}

      {/* Window Summaries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { label: 'WINDOW A (GREEN)', fp: fpA, accent: 'text-[#4ade80]' },
          { label: 'WINDOW B (AMBER)', fp: fpB, accent: 'text-[#fbbf24]' },
        ].map(({ label, fp, accent }) => (
          <div key={label} className="panel-border rounded-sm p-3 text-xs space-y-1.5">
            <div className={`font-semibold tracking-wider ${accent}`}>{label}</div>
            {fp ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="text-[#7a9384]">Source / Frames:</div>
                <div className="text-right tabular-nums">
                  {fp.sourceMode} / {fp.frameCount} ({fp.durationSec.toFixed(1)}s)
                </div>
                <div className="text-[#7a9384]">Noise Floor (10th pct):</div>
                <div className="text-right tabular-nums">{fp.noiseFloorDbfs.toFixed(1)} dBFS</div>
                <div className="text-[#7a9384]">Mean RMS / StdDev:</div>
                <div className="text-right tabular-nums">
                  {fp.meanRmsDbfs.toFixed(1)} dBFS (±{fp.rmsStdDevDb.toFixed(1)} dB)
                </div>
                <div className="text-[#7a9384]">Centroid / Flatness:</div>
                <div className="text-right tabular-nums">
                  {fp.meanCentroidHz.toFixed(0)} Hz / {fp.meanFlatness.toFixed(3)}
                </div>
                <div className="text-[#7a9384]">Low / Mid / High %:</div>
                <div className="text-right tabular-nums">
                  {(fp.meanBandEnergy.lowRatio * 100).toFixed(0)} /{' '}
                  {(fp.meanBandEnergy.midRatio * 100).toFixed(0)} /{' '}
                  {(fp.meanBandEnergy.highRatio * 100).toFixed(0)}%
                </div>
              </div>
            ) : (
              <div className="text-[#5e7a68] py-3">Not captured yet.</div>
            )}
          </div>
        ))}
      </div>

      {/* Spectral Profile Canvas */}
      <div className="panel-border rounded-sm overflow-hidden">
        <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px] text-[#86a390]">
          <span>32-BAND LOG FREQUENCY PROFILE COMPARISON (GREEN = A, AMBER = B)</span>
          <span>{comparing ? 'COMPUTING IN WORKER...' : 'READY'}</span>
        </div>
        <canvas ref={canvasRef} className="w-full block" style={{ height: 200 }} />
      </div>

      {/* Comparison Results */}
      {comparison && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <MetricTile
              label="Feature Similarity"
              value={`${(comparison.cosineSimilarity * 100).toFixed(1)}%`}
              accent={comparison.cosineSimilarity >= 0.85 ? 'green' : 'amber'}
              subtext={`Cosine=${comparison.cosineSimilarity.toFixed(4)} | Confidence: ${comparison.confidenceLabel}`}
            />
            <MetricTile
              label="Spectral RMSE"
              value={comparison.spectralDistanceDb.toFixed(2)}
              unit="dB"
              subtext="Across 32 log bands"
            />
            <MetricTile
              label="Noise Floor Δ (B-A)"
              value={`${comparison.noiseFloorDeltaDb >= 0 ? '+' : ''}${comparison.noiseFloorDeltaDb.toFixed(1)}`}
              unit="dB"
              subtext={`Centroid Δ ${comparison.centroidDeltaHz >= 0 ? '+' : ''}${comparison.centroidDeltaHz.toFixed(0)} Hz`}
            />
            <MetricTile
              label="Band Shift (L/M/H)"
              value={`${comparison.bandDeltas.lowDeltaPct >= 0 ? '+' : ''}${comparison.bandDeltas.lowDeltaPct.toFixed(0)}%`}
              subtext={`M:${comparison.bandDeltas.midDeltaPct >= 0 ? '+' : ''}${comparison.bandDeltas.midDeltaPct.toFixed(0)}% H:${comparison.bandDeltas.highDeltaPct >= 0 ? '+' : ''}${comparison.bandDeltas.highDeltaPct.toFixed(0)}%`}
            />
          </div>

          <div className="panel-border rounded-sm p-3 text-xs space-y-2">
            <div className="text-[#86efac] font-semibold">INTERPRETATION &amp; EPISTEMIC BOUNDARY</div>
            <p className="text-[#c5d4ca]">{comparison.interpretation}</p>
            <div className="border-t border-[#1b2821] pt-2 text-[11px] text-[#fcd34d] space-y-0.5">
              <div className="font-semibold">CRITICAL LIMITATIONS (Similarity ≠ Location/Identity Proof):</div>
              {comparison.limitations.map((l, i) => (
                <div key={i}>• {l}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ProtocolCard
        protocol={EXPERIMENT_PROTOCOLS.A}
        liveObservations={liveObs}
      />
    </div>
  );
}
