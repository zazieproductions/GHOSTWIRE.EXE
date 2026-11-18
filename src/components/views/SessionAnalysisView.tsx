import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  InputMode,
  MeasurementSession,
  SessionSamplePoint,
} from '../../types/acoustic';
import {
  SESSION_PRIVACY_NOTICE,
  exportSessionToCsv,
  exportSessionToHtmlReport,
  exportSessionToJson,
  triggerFileDownload,
} from '../../utils/exportSession';
import type { SessionComparisonResult } from '../../workers/dsp.worker';
import { dspWorkerClient } from '../../workers/dspWorkerClient';
import { MetricTile } from '../common/MetricTile';

interface SessionAnalysisViewProps {
  mode: InputMode;
  recordingState: 'idle' | 'recording' | 'paused';
  activeSessionName: string;
  activeSessionDurationSec: number;
  activeSampleCount: number;
  activeSamplesRef: RefObject<readonly SessionSamplePoint[]>;
  savedSessions: MeasurementSession[];
  persistLocally: boolean;
  sessionNotice: string | null;
  onChangeSessionName: (name: string) => void;
  onStartSession: () => void;
  onPauseToggle: () => void;
  onStopSession: () => void;
  onClearAllSessions: () => void;
}

type ExportFormat = 'csv' | 'json' | 'html';

const EXPORT_SERIALIZERS: Record<
  ExportFormat,
  (session: MeasurementSession) => string
> = {
  csv: exportSessionToCsv,
  json: exportSessionToJson,
  html: exportSessionToHtmlReport,
};

const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  html: 'text/html;charset=utf-8',
};

function downloadSessionExport(
  session: MeasurementSession,
  format: ExportFormat
): void {
  const safeName = session.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  triggerFileDownload(
    EXPORT_SERIALIZERS[format](session),
    `ghostwire-${safeName}-${session.id}.${format}`,
    EXPORT_MIME_TYPES[format]
  );
}

function useSessionSelection(savedSessions: MeasurementSession[]) {
  const [selectedIdA, setSelectedIdA] = useState<string>('');
  const [selectedIdB, setSelectedIdB] = useState<string>('');

  useEffect(() => {
    if (savedSessions.length >= 1 && !selectedIdA) {
      setSelectedIdA(savedSessions[0].id);
    }
    if (savedSessions.length >= 2 && !selectedIdB) {
      setSelectedIdB(savedSessions[1].id);
    }
  }, [savedSessions, selectedIdA, selectedIdB]);

  return { selectedIdA, setSelectedIdA, selectedIdB, setSelectedIdB };
}

function useSessionComparison(
  savedSessions: MeasurementSession[],
  selectedIdA: string,
  selectedIdB: string
): {
  comparison: SessionComparisonResult | null;
  comparisonError: string | null;
} {
  const [comparison, setComparison] = useState<SessionComparisonResult | null>(
    null
  );
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const sessA = savedSessions.find((s) => s.id === selectedIdA);
    const sessB = savedSessions.find((s) => s.id === selectedIdB);
    setComparison(null);
    if (!sessA || !sessB) {
      setComparisonError(null);
      return () => {
        active = false;
      };
    }
    // Ignore results from a stale selection and surface worker failures
    // instead of leaving an unhandled rejection.
    setComparisonError(null);
    void dspWorkerClient
      .compareSessions(sessA, sessB)
      .then((result) => {
        if (active) setComparison(result);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // Surface worker / session comparison failures without leaving a
        // stale result visible (AUDIT F9).
        console.error('[SessionAnalysisView] session comparison failed:', err);
        setComparison(null);
        setComparisonError(
          err instanceof Error ? err.message : 'Session comparison failed.'
        );
      });
    return () => {
      // A newer selection invalidates an in-flight comparison response.
      active = false;
    };
  }, [savedSessions, selectedIdA, selectedIdB]);

  return { comparison, comparisonError };
}

interface TimelineGeometry {
  width: number;
  height: number;
  padL: number;
  padT: number;
  plotW: number;
  plotH: number;
}

function timelineDbToY(db: number, padT: number, plotH: number): number {
  return padT + (1 - (Math.max(-100, Math.min(0, db)) + 100) / 100) * plotH;
}

function drawTimelineGrid(
  ctx: CanvasRenderingContext2D,
  geometry: TimelineGeometry
): void {
  const { width, padL, padT, plotW, plotH } = geometry;
  ctx.strokeStyle = '#132018';
  ctx.fillStyle = '#627d6c';
  ctx.font = '10px monospace';
  for (const db of [0, -30, -60, -90]) {
    const y = Math.round(timelineDbToY(db, padT, plotH)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(`${db}`, 4, y + 3);
  }
  void width;
}

function drawSampleTrace(
  ctx: CanvasRenderingContext2D,
  samples: readonly SessionSamplePoint[],
  geometry: TimelineGeometry,
  accessor: (point: SessionSamplePoint) => number,
  color: string,
  lineWidth: number
): void {
  const { padL, padT, plotW, plotH } = geometry;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  samples.forEach((pt, i) => {
    const x = padL + (i / (samples.length - 1)) * plotW;
    const y = timelineDbToY(accessor(pt), padT, plotH);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawEmptyTimeline(
  ctx: CanvasRenderingContext2D,
  geometry: TimelineGeometry
): void {
  const { padL, padT, plotH } = geometry;
  ctx.fillStyle = '#52695b';
  ctx.font = '11px monospace';
  ctx.fillText(
    'START A MEASUREMENT SESSION TO RECORD TIMESTAMPED FEATURE TIMELINE',
    padL + 12,
    padT + plotH / 2
  );
}

function drawSessionTimeline(
  canvas: HTMLCanvasElement,
  samples: readonly SessionSamplePoint[]
): void {
  const width = canvas.clientWidth || 640;
  const height = 160;
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
  const padR = 12;
  const padT = 14;
  const padB = 20;
  const geometry: TimelineGeometry = {
    width,
    height,
    padL,
    padT,
    plotW: width - padL - padR,
    plotH: height - padT - padB,
  };

  drawTimelineGrid(ctx, geometry);

  if (samples.length > 1) {
    drawSampleTrace(
      ctx,
      samples,
      geometry,
      (pt) => pt.rmsDbfs,
      '#22c55e',
      1.6
    );
    drawSampleTrace(
      ctx,
      samples,
      geometry,
      (pt) => pt.noiseFloorDbfs,
      '#f59e0b',
      1.2
    );
  } else {
    drawEmptyTimeline(ctx, geometry);
  }

  ctx.restore();
}

function TimelineCanvas({
  activeSamplesRef,
  activeSampleCount,
  savedPreviewSamples,
}: Pick<SessionAnalysisViewProps, 'activeSamplesRef' | 'activeSampleCount'> & {
  savedPreviewSamples: readonly SessionSamplePoint[] | undefined;
}) {
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCount = activeSampleCount || (savedPreviewSamples?.length ?? 0);

  useEffect(() => {
    const canvas = timelineCanvasRef.current;
    if (!canvas) return;
    // The count changes on each append. Read the draft only when drawing so
    // advancing the timeline does not require copying the entire sample buffer.
    const samples = activeSampleCount > 0
      ? activeSamplesRef.current
      : savedPreviewSamples ?? [];
    drawSessionTimeline(canvas, samples);
  }, [activeSampleCount, activeSamplesRef, savedPreviewSamples]);

  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px] text-[#86a390]">
        <span>FEATURE TIMELINE // RMS (GREEN) &amp; NOISE FLOOR (AMBER) dBFS</span>
        <span>{sampleCount} logged points</span>
      </div>
      <canvas ref={timelineCanvasRef} className="w-full block" style={{ height: 160 }} />
    </div>
  );
}

function SessionHeader({
  persistLocally,
  onClearAllSessions,
}: Pick<SessionAnalysisViewProps, 'persistLocally' | 'onClearAllSessions'>) {
  return (
    <>
      <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            SESSION ANALYSIS // NUMERICAL AGGREGATE CAPTURE &amp; EXPORT
          </div>
          <div className="text-[11px] text-[#7a9384]">
            Retains ONLY timestamped numerical features in memory ({persistLocally ? 'LocalStorage opt-in ENABLED' : 'ephemeral RAM only — clears on reload'}). Zero raw audio recorded.
          </div>
        </div>

        <button
          type="button"
          onClick={onClearAllSessions}
          className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#3b1212] hover:bg-[#571818] text-[#fecaca] border border-[#ef4444]/50 cursor-pointer"
        >
          CLEAR ALL SESSION DATA
        </button>
      </div>

      <div className="border border-[#f59e0b]/40 bg-[#181207] text-[#fcd34d] px-3 py-2 text-[11px] rounded-sm">
        {SESSION_PRIVACY_NOTICE}
      </div>
    </>
  );
}

function recordingStateClass(recordingState: SessionAnalysisViewProps['recordingState']) {
  return recordingState === 'recording'
    ? 'text-[#4ade80] font-bold'
    : recordingState === 'paused'
      ? 'text-[#fbbf24] font-bold'
      : 'text-[#86a390]';
}

function SessionRecorderControls({
  mode,
  recordingState,
  activeSessionName,
  activeSessionDurationSec,
  activeSampleCount,
  onChangeSessionName,
  onStartSession,
  onPauseToggle,
  onStopSession,
}: Pick<
  SessionAnalysisViewProps,
  | 'mode'
  | 'recordingState'
  | 'activeSessionName'
  | 'activeSessionDurationSec'
  | 'activeSampleCount'
  | 'onChangeSessionName'
  | 'onStartSession'
  | 'onPauseToggle'
  | 'onStopSession'
>) {
  return (
    <div className="panel-border rounded-sm p-3 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs">
          <span className="text-[11px] text-[#7a9384] block">Session Label</span>
          <input
            type="text"
            value={activeSessionName}
            onChange={(e) => onChangeSessionName(e.target.value)}
            disabled={recordingState !== 'idle'}
            className="bg-[#06090b] border border-[#1f2e25] px-2.5 py-1.5 rounded-xs text-xs text-[#e2efe6] w-56 disabled:opacity-60"
          />
        </label>

        {recordingState === 'idle' ? (
          <button
            type="button"
            disabled={mode === 'idle'}
            onClick={onStartSession}
            className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#14532d] hover:bg-[#166534] disabled:opacity-40 text-[#bbf7d0] border border-[#22c55e]/50 cursor-pointer disabled:cursor-not-allowed"
          >
            START SESSION
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onPauseToggle}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] hover:bg-[#92400e] text-[#fde68a] border border-[#f59e0b]/60 cursor-pointer"
            >
              {recordingState === 'paused' ? 'RESUME SESSION' : 'PAUSE SESSION'}
            </button>
            <button
              type="button"
              onClick={onStopSession}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#7f1d1d] hover:bg-[#991b1b] text-[#fecaca] border border-[#ef4444]/60 cursor-pointer"
            >
              STOP &amp; SAVE SESSION
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div>
          <span className="text-[#6e8a78]">STATE: </span>
          <span className={recordingStateClass(recordingState)}>
            {recordingState.toUpperCase()}
          </span>
        </div>
        <div className="tabular-nums">
          <span className="text-[#6e8a78]">DURATION: </span>
          <span>{activeSessionDurationSec.toFixed(1)} s</span>
        </div>
        <div className="tabular-nums">
          <span className="text-[#6e8a78]">FRAMES: </span>
          <span>{activeSampleCount}</span>
        </div>
      </div>
    </div>
  );
}

function SavedSessionsTable({
  savedSessions,
}: {
  savedSessions: MeasurementSession[];
}) {
  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 text-[11px] font-semibold text-[#86efac]">
        RECORDED FEATURE SESSIONS ({savedSessions.length})
      </div>
      {savedSessions.length === 0 ? (
        <div className="p-4 text-xs text-[#6e8a78]">
          No saved sessions yet. Start an audio stream (Synthetic or Microphone) and click &ldquo;Start Session&rdquo; to log aggregate numerical features.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#18231d] text-[11px] text-[#6e8a78]">
                <th className="text-left px-3 py-1.5">Session</th>
                <th className="text-left px-3 py-1.5">Source</th>
                <th className="text-right px-3 py-1.5">Duration</th>
                <th className="text-right px-3 py-1.5">Mean RMS</th>
                <th className="text-right px-3 py-1.5">Floor</th>
                <th className="text-right px-3 py-1.5">Centroid</th>
                <th className="text-right px-3 py-1.5">Duty</th>
                <th className="text-right px-3 py-1.5">Exports</th>
              </tr>
            </thead>
            <tbody>
              {savedSessions.map((sess) => (
                <tr key={sess.id} className="border-b border-[#121c16] text-[11px]">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[#e2efe6]">{sess.name}</div>
                    <div className="text-[10px] text-[#6e8a78]">{sess.startedAtIso}</div>
                  </td>
                  <td className="px-3 py-2 text-[#86efac] uppercase">{sess.sourceMode}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sess.durationSec.toFixed(1)}s</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sess.summary.meanRmsDbfs.toFixed(1)} dBFS</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sess.summary.noiseFloorDbfs.toFixed(1)} dBFS</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sess.summary.meanCentroidHz.toFixed(0)} Hz</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sess.summary.activityDutyCyclePct.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => downloadSessionExport(sess, 'csv')}
                      className="px-2 py-0.5 rounded-xs border border-[#24322a] bg-[#0f171c] hover:bg-[#17252c] text-[#86efac] cursor-pointer"
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadSessionExport(sess, 'json')}
                      className="px-2 py-0.5 rounded-xs border border-[#24322a] bg-[#0f171c] hover:bg-[#17252c] text-[#93c5fd] cursor-pointer"
                    >
                      JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadSessionExport(sess, 'html')}
                      className="px-2 py-0.5 rounded-xs border border-[#24322a] bg-[#0f171c] hover:bg-[#17252c] text-[#fcd34d] cursor-pointer"
                    >
                      HTML
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SessionSelector({
  label,
  value,
  savedSessions,
  onChange,
}: {
  label: string;
  value: string;
  savedSessions: MeasurementSession[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-[#7a9384] block">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#06090b] border border-[#1f2e25] px-2 py-1.5 rounded-xs text-xs"
      >
        {savedSessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.durationSec.toFixed(1)}s, {s.sourceMode})
          </option>
        ))}
      </select>
    </label>
  );
}

function formatSigned(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function ComparisonMetrics({
  comparison,
}: {
  comparison: SessionComparisonResult;
}) {
  const fingerprint = comparison.fingerprintComparison;
  const comparable = fingerprint ? fingerprint.comparable : true;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      <MetricTile
        label="Mean RMS Δ (B-A)"
        value={formatSigned(comparison.rmsDeltaDb, 1)}
        unit="dB"
      />
      <MetricTile
        label="Noise Floor Δ"
        value={formatSigned(comparison.noiseFloorDeltaDb, 1)}
        unit="dB"
      />
      <MetricTile
        label="Centroid Δ"
        value={formatSigned(comparison.centroidDeltaHz, 0)}
        unit="Hz"
      />
      <MetricTile
        label="Spectral Similarity"
        value={
          fingerprint && comparable
            ? `${(fingerprint.cosineSimilarity * 100).toFixed(1)}%`
            : 'N/A'
        }
        accent={
          fingerprint && comparable && fingerprint.cosineSimilarity >= 0.85
            ? 'green'
            : 'amber'
        }
        subtext={
          fingerprint && comparable
            ? `RMSE ${fingerprint.spectralDistanceDb.toFixed(1)} dB`
            : 'Grids not comparable'
        }
      />
    </div>
  );
}

function SessionComparisonPanel({
  savedSessions,
  selectedIdA,
  selectedIdB,
  comparison,
  comparisonError,
  setSelectedIdA,
  setSelectedIdB,
}: {
  savedSessions: MeasurementSession[];
  selectedIdA: string;
  selectedIdB: string;
  comparison: SessionComparisonResult | null;
  comparisonError: string | null;
  setSelectedIdA: (value: string) => void;
  setSelectedIdB: (value: string) => void;
}) {
  return (
    <>
      {savedSessions.length >= 2 && (
        <div className="panel-border rounded-sm p-3 space-y-3">
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            LOCAL SESSION COMPARISON (COMPUTED OFF-THREAD IN DSP WORKER)
          </div>

          {comparisonError && (
            <div
              role="alert"
              className="border border-[#ef4444]/60 bg-[#210c0c] text-[#fecaca] px-3 py-2 text-[11px] rounded-sm"
            >
              COMPARISON FAILED: {comparisonError}
            </div>
          )}

          {comparison?.fingerprintComparison &&
            !comparison.fingerprintComparison.comparable && (
              <div className="border border-[#f59e0b]/50 bg-[#181207] text-[#fcd34d] px-3 py-2 text-[11px] rounded-sm">
                Spectral similarity is not reported: {comparison.fingerprintComparison.incompatibilityReasons.join(' ')}
              </div>
            )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <SessionSelector
              label="Baseline Session A"
              value={selectedIdA}
              savedSessions={savedSessions}
              onChange={setSelectedIdA}
            />
            <SessionSelector
              label="Comparison Session B"
              value={selectedIdB}
              savedSessions={savedSessions}
              onChange={setSelectedIdB}
            />
          </div>

          {comparison && <ComparisonMetrics comparison={comparison} />}
        </div>
      )}
    </>
  );
}

export function SessionAnalysisView({
  mode,
  recordingState,
  activeSessionName,
  activeSessionDurationSec,
  activeSampleCount,
  activeSamplesRef,
  savedSessions,
  persistLocally,
  sessionNotice,
  onChangeSessionName,
  onStartSession,
  onPauseToggle,
  onStopSession,
  onClearAllSessions,
}: SessionAnalysisViewProps) {
  const selection = useSessionSelection(savedSessions);
  const { comparison, comparisonError } = useSessionComparison(
    savedSessions,
    selection.selectedIdA,
    selection.selectedIdB
  );
  const savedPreviewSamples = activeSampleCount > 0
    ? undefined
    : savedSessions.find((s) => s.id === selection.selectedIdA)?.samples;

  return (
    <div className="space-y-4">
      <SessionHeader
        persistLocally={persistLocally}
        onClearAllSessions={onClearAllSessions}
      />
      {sessionNotice && (
        <div
          role="status"
          className="border border-[#f59e0b]/50 bg-[#181207] text-[#fcd34d] px-3 py-2 text-[11px] rounded-sm flex items-start justify-between gap-3"
        >
          <span>{sessionNotice}</span>
        </div>
      )}
      <SessionRecorderControls
        mode={mode}
        recordingState={recordingState}
        activeSessionName={activeSessionName}
        activeSessionDurationSec={activeSessionDurationSec}
        activeSampleCount={activeSampleCount}
        onChangeSessionName={onChangeSessionName}
        onStartSession={onStartSession}
        onPauseToggle={onPauseToggle}
        onStopSession={onStopSession}
      />
      <TimelineCanvas
        activeSamplesRef={activeSamplesRef}
        activeSampleCount={activeSampleCount}
        savedPreviewSamples={savedPreviewSamples}
      />
      <SavedSessionsTable savedSessions={savedSessions} />
      <SessionComparisonPanel
        savedSessions={savedSessions}
        selectedIdA={selection.selectedIdA}
        selectedIdB={selection.selectedIdB}
        comparison={comparison}
        comparisonError={comparisonError}
        setSelectedIdA={selection.setSelectedIdA}
        setSelectedIdB={selection.setSelectedIdB}
      />
    </div>
  );
}
