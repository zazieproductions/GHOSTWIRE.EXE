import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CAPTURE_FRAMES } from '../../app/limits';
import { EXPERIMENT_PROTOCOLS } from '../../data/protocols';
import { buildEnvironmentalFingerprint } from '../../dsp/analysis';
import { toFeatureFrame } from '../../dsp/metrics';
import type {
  DspFrame,
  EnvironmentalFingerprint,
  FeatureFrame,
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

type CaptureSlot = 'A' | 'B';

type ComparisonSetter = (value: FingerprintComparison | null) => void;
type ComparingSetter = (value: boolean) => void;
type ComparisonErrorSetter = (value: string | null) => void;

interface ProfilePlot {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  padL: number;
  padT: number;
  plotW: number;
  plotH: number;
}

const PROFILE_GRID_DB = [0, -25, -50, -75, -100];
const PROFILE_TICKS = [0, 7, 15, 23, 31];

function signed(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function profileDbToY(db: number, padT: number, plotH: number): number {
  const minDb = -100;
  const maxDb = 0;
  const clamped = Math.max(minDb, Math.min(maxDb, db));
  return padT + (1 - (clamped - minDb) / (maxDb - minDb)) * plotH;
}

function formatFrequency(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz.toFixed(0)}`;
}

function drawProfileGrid(plot: ProfilePlot): void {
  const { ctx, padL, padT, plotW, plotH } = plot;
  ctx.strokeStyle = '#132018';
  ctx.fillStyle = '#627d6c';
  ctx.font = '10px monospace';
  for (const db of PROFILE_GRID_DB) {
    const y = Math.round(profileDbToY(db, padT, plotH)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(`${db}`, 4, y + 3);
  }
}

function drawProfile(
  plot: ProfilePlot,
  fp: EnvironmentalFingerprint,
  color: string
): void {
  const { ctx, width, height, padL, padT, plotW, plotH } = plot;
  const bands = fp.logBandDbfs;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < bands.length; i++) {
    const x = padL + (i / (bands.length - 1)) * plotW;
    const y = profileDbToY(bands[i], padT, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Axis frequency ticks from band centers
  ctx.fillStyle = '#627d6c';
  for (const idx of PROFILE_TICKS) {
    const hz = fp.logBandCentersHz[idx];
    const x = padL + (idx / (bands.length - 1)) * plotW;
    const txt = formatFrequency(hz);
    ctx.fillText(txt, Math.min(width - 28, x - 8), height - 7);
  }
}

function drawEmptyProfile(plot: ProfilePlot): void {
  const { ctx, padL, padT, plotH } = plot;
  ctx.fillStyle = '#52695b';
  ctx.font = '11px monospace';
  ctx.fillText(
    'CAPTURE WINDOW A AND WINDOW B TO PLOT 32-BAND SPECTRAL FINGERPRINT COMPARISON',
    padL + 10,
    padT + plotH / 2
  );
}

function drawFingerprintComparison(
  canvas: HTMLCanvasElement,
  fpA: EnvironmentalFingerprint | null,
  fpB: EnvironmentalFingerprint | null
): void {
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
  const plot: ProfilePlot = {
    ctx,
    width,
    height,
    padL,
    padT,
    plotW: width - padL - padR,
    plotH: height - padT - padB,
  };

  drawProfileGrid(plot);
  if (fpA) drawProfile(plot, fpA, '#22c55e');
  if (fpB) drawProfile(plot, fpB, '#f59e0b');
  if (!fpA && !fpB) drawEmptyProfile(plot);

  ctx.restore();
}

function FingerprintCanvas({
  fpA,
  fpB,
  comparing,
}: {
  fpA: EnvironmentalFingerprint | null;
  fpB: EnvironmentalFingerprint | null;
  comparing: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawFingerprintComparison(canvas, fpA, fpB);
  }, [fpA, fpB]);

  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px] text-[#86a390]">
        <span>32-BAND LOG FREQUENCY PROFILE COMPARISON (GREEN = A, AMBER = B)</span>
        <span>{comparing ? 'COMPUTING IN WORKER...' : 'READY'}</span>
      </div>
      <canvas ref={canvasRef} className="w-full block" style={{ height: 200 }} />
    </div>
  );
}

function useWindowCapture(
  mode: InputMode,
  latestFrame: DspFrame | null,
  onCaptureStart: () => void
) {
  const [capturingSlot, setCapturingSlot] = useState<CaptureSlot | null>(null);
  const [captureBufferCount, setCaptureBufferCount] = useState(0);
  // Derived feature frames only: no time-domain PCM is buffered here.
  const captureFramesRef = useRef<FeatureFrame[]>([]);
  // Provenance of the window being captured, fixed at capture start.
  const captureModeRef = useRef<InputMode>('idle');
  const [fpA, setFpA] = useState<EnvironmentalFingerprint | null>(null);
  const [fpB, setFpB] = useState<EnvironmentalFingerprint | null>(null);

  const clearCaptureBuffer = useCallback(() => {
    captureFramesRef.current = [];
    setCaptureBufferCount(0);
  }, []);

  // AUDIT F1: release any retained frames when the component unmounts.
  useEffect(
    () => () => {
      captureFramesRef.current = [];
    },
    []
  );

  useEffect(() => {
    if (!capturingSlot || !latestFrame) return;
    // AUDIT F8: bound the short A/B capture buffer.
    if (captureFramesRef.current.length >= MAX_CAPTURE_FRAMES) return;
    // AUDIT F1: fingerprinting keeps spectral features only, never PCM.
    captureFramesRef.current.push(toFeatureFrame(latestFrame));
    setCaptureBufferCount(captureFramesRef.current.length);
  }, [capturingSlot, latestFrame]);

  const finishCapture = useCallback(() => {
    if (!capturingSlot) return;
    const frames = captureFramesRef.current;
    const slot = capturingSlot;
    const sourceMode = captureModeRef.current;
    setCapturingSlot(null);
    clearCaptureBuffer();
    if (frames.length === 0) return;
    const fp = buildEnvironmentalFingerprint(
      frames,
      `Window ${slot} (${sourceMode})`,
      sourceMode
    );
    if (slot === 'A') setFpA(fp);
    else setFpB(fp);
  }, [capturingSlot, clearCaptureBuffer]);

  useEffect(() => {
    if (mode === 'idle' && capturingSlot) {
      finishCapture();
    }
  }, [mode, capturingSlot, finishCapture]);

  const startCapture = useCallback(
    (slot: CaptureSlot) => {
      if (mode === 'idle') return;
      clearCaptureBuffer();
      captureModeRef.current = mode;
      setCapturingSlot(slot);
      // Clear the comparison and the window being replaced so a failed or
      // in-flight worker request cannot leave a stale result visible (AUDIT F9).
      onCaptureStart();
      if (slot === 'A') setFpA(null);
      else setFpB(null);
    },
    [mode, onCaptureStart, clearCaptureBuffer]
  );

  const resetWindows = useCallback(() => {
    clearCaptureBuffer();
    setFpA(null);
    setFpB(null);
    onCaptureStart();
  }, [onCaptureStart, clearCaptureBuffer]);

  return {
    capturingSlot,
    captureBufferCount,
    fpA,
    fpB,
    startCapture,
    finishCapture,
    resetWindows,
  };
}

function useFingerprintComparison(
  fpA: EnvironmentalFingerprint | null,
  fpB: EnvironmentalFingerprint | null,
  setComparison: ComparisonSetter,
  setComparing: ComparingSetter,
  setComparisonError: ComparisonErrorSetter
): void {
  const requestIdRef = useRef(0);
  const runComparison = useCallback(async () => {
    if (!fpA || !fpB) return;
    const requestId = ++requestIdRef.current;
    setComparison(null);
    setComparisonError(null);
    setComparing(true);
    try {
      const res = await dspWorkerClient.compareFingerprints(fpA, fpB);
      if (requestId !== requestIdRef.current) return;
      setComparison(res);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      // Surface worker / fingerprint comparison failures without leaving a
      // stale result visible (AUDIT F9).
      console.error('[ExperimentA] fingerprint comparison failed:', err);
      setComparison(null);
      setComparisonError(
        err instanceof Error ? err.message : 'Fingerprint comparison failed.'
      );
    } finally {
      if (requestId === requestIdRef.current) setComparing(false);
    }
  }, [fpA, fpB, setComparison, setComparing, setComparisonError]);

  useEffect(() => {
    if (fpA && fpB) {
      void runComparison();
    }
    return () => {
      // A newer capture invalidates any in-flight comparison response.
      requestIdRef.current += 1;
    };
  }, [fpA, fpB, runComparison]);
}

function buildLiveObservations(
  fpA: EnvironmentalFingerprint | null,
  fpB: EnvironmentalFingerprint | null,
  comparison: FingerprintComparison | null
): string[] {
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
      comparison.comparable
        ? `Cosine Similarity ${(comparison.cosineSimilarity * 100).toFixed(1)}%, Spectral RMSE ${comparison.spectralDistanceDb.toFixed(1)} dB, Noise Floor Δ ${signed(comparison.noiseFloorDeltaDb, 1)} dB`
        : `NOT COMPARABLE — ${comparison.incompatibilityReasons.join(' ')}`
    );
  }
  return liveObs;
}

function CaptureControls({
  mode,
  capturingSlot,
  captureBufferCount,
  fpA,
  fpB,
  onStart,
  onFinish,
  onReset,
}: {
  mode: InputMode;
  capturingSlot: CaptureSlot | null;
  captureBufferCount: number;
  fpA: EnvironmentalFingerprint | null;
  fpB: EnvironmentalFingerprint | null;
  onStart: (slot: CaptureSlot) => void;
  onFinish: () => void;
  onReset: () => void;
}) {
  return (
    <>
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
              onClick={onFinish}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] text-[#fde68a] border border-[#f59e0b] cursor-pointer"
            >
              FINISH WINDOW A ({captureBufferCount} frames)
            </button>
          ) : (
            <button
              type="button"
              disabled={mode === 'idle' || capturingSlot === 'B'}
              onClick={() => onStart('A')}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#123321] hover:bg-[#19472e] disabled:opacity-40 text-[#86efac] border border-[#22c55e]/50 cursor-pointer disabled:cursor-not-allowed"
            >
              {fpA ? 'RE-CAPTURE WINDOW A' : 'CAPTURE WINDOW A'}
            </button>
          )}

          {capturingSlot === 'B' ? (
            <button
              type="button"
              onClick={onFinish}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] text-[#fde68a] border border-[#f59e0b] cursor-pointer"
            >
              FINISH WINDOW B ({captureBufferCount} frames)
            </button>
          ) : (
            <button
              type="button"
              disabled={mode === 'idle' || capturingSlot === 'A'}
              onClick={() => onStart('B')}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#2b200b] hover:bg-[#3f2e10] disabled:opacity-40 text-[#fcd34d] border border-[#f59e0b]/50 cursor-pointer disabled:cursor-not-allowed"
            >
              {fpB ? 'RE-CAPTURE WINDOW B' : 'CAPTURE WINDOW B'}
            </button>
          )}

          {(fpA || fpB) && (
            <button
              type="button"
              onClick={onReset}
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
    </>
  );
}

function WindowSummaries({
  fpA,
  fpB,
}: {
  fpA: EnvironmentalFingerprint | null;
  fpB: EnvironmentalFingerprint | null;
}) {
  return (
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
                {fp.excludedFrameCount > 0 && (
                  <> · {fp.excludedFrameCount} off-grid excluded</>
                )}
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
  );
}

function ComparisonResults({
  comparison,
  comparisonError,
}: {
  comparison: FingerprintComparison | null;
  comparisonError: string | null;
}) {
  return (
    <>
      {comparisonError && (
        <div
          role="alert"
          className="border border-[#ef4444]/60 bg-[#210c0c] text-[#fecaca] px-3 py-2 text-[11px] rounded-sm"
        >
          COMPARISON FAILED: {comparisonError}
        </div>
      )}
      {comparison && !comparison.comparable && (
        <div
          role="alert"
          className="border border-[#f59e0b]/50 bg-[#181207] text-[#fcd34d] px-3 py-2 text-[11px] rounded-sm"
        >
          NOT COMPARABLE — {comparison.incompatibilityReasons.join(' ')}
        </div>
      )}
      {comparison && (
        <div className="space-y-3">
          {comparison.comparable && (
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
              value={signed(comparison.noiseFloorDeltaDb, 1)}
              unit="dB"
              subtext={`Centroid Δ ${signed(comparison.centroidDeltaHz, 0)} Hz`}
            />
            <MetricTile
              label="Band Shift (L/M/H)"
              value={`${signed(comparison.bandDeltas.lowDeltaPct, 0)}%`}
              subtext={`M:${signed(comparison.bandDeltas.midDeltaPct, 0)}% H:${signed(comparison.bandDeltas.highDeltaPct, 0)}%`}
            />
          </div>
          )}

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
    </>
  );
}

export function ExperimentA({ mode, latestFrame }: ExperimentAProps) {
  const [comparison, setComparison] = useState<FingerprintComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const clearComparison = useCallback(() => {
    setComparison(null);
    setComparisonError(null);
    setComparing(false);
  }, []);
  const capture = useWindowCapture(mode, latestFrame, clearComparison);

  useFingerprintComparison(
    capture.fpA,
    capture.fpB,
    setComparison,
    setComparing,
    setComparisonError
  );

  const liveObs = buildLiveObservations(
    capture.fpA,
    capture.fpB,
    comparison
  );

  return (
    <div className="space-y-4">
      <CaptureControls
        mode={mode}
        capturingSlot={capture.capturingSlot}
        captureBufferCount={capture.captureBufferCount}
        fpA={capture.fpA}
        fpB={capture.fpB}
        onStart={capture.startCapture}
        onFinish={capture.finishCapture}
        onReset={capture.resetWindows}
      />
      <WindowSummaries fpA={capture.fpA} fpB={capture.fpB} />
      <FingerprintCanvas
        fpA={capture.fpA}
        fpB={capture.fpB}
        comparing={comparing}
      />
      <ComparisonResults comparison={comparison} comparisonError={comparisonError} />
      <ProtocolCard
        protocol={EXPERIMENT_PROTOCOLS.A}
        liveObservations={liveObs}
      />
    </div>
  );
}
