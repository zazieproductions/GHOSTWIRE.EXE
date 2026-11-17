import { useEffect, useRef, useState } from 'react';
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
  activeSamples: SessionSamplePoint[];
  savedSessions: MeasurementSession[];
  persistLocally: boolean;
  onChangeSessionName: (name: string) => void;
  onStartSession: () => void;
  onPauseToggle: () => void;
  onStopSession: () => void;
  onClearAllSessions: () => void;
}

export function SessionAnalysisView({
  mode,
  recordingState,
  activeSessionName,
  activeSessionDurationSec,
  activeSamples,
  savedSessions,
  persistLocally,
  onChangeSessionName,
  onStartSession,
  onPauseToggle,
  onStopSession,
  onClearAllSessions,
}: SessionAnalysisViewProps) {
  const [selectedIdA, setSelectedIdA] = useState<string>('');
  const [selectedIdB, setSelectedIdB] = useState<string>('');
  const [comparison, setComparison] = useState<SessionComparisonResult | null>(
    null
  );
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (savedSessions.length >= 1 && !selectedIdA) {
      setSelectedIdA(savedSessions[0].id);
    }
    if (savedSessions.length >= 2 && !selectedIdB) {
      setSelectedIdB(savedSessions[1].id);
    }
  }, [savedSessions, selectedIdA, selectedIdB]);

  useEffect(() => {
    const sessA = savedSessions.find((s) => s.id === selectedIdA);
    const sessB = savedSessions.find((s) => s.id === selectedIdB);
    if (!sessA || !sessB) {
      setComparison(null);
      return;
    }
    void dspWorkerClient.compareSessions(sessA, sessB).then(setComparison);
  }, [savedSessions, selectedIdA, selectedIdB]);

  // Draw timeline of active or selected session
  const previewSamples =
    activeSamples.length > 0
      ? activeSamples
      : savedSessions.find((s) => s.id === selectedIdA)?.samples ?? [];

  useEffect(() => {
    const canvas = timelineCanvasRef.current;
    if (!canvas) return;
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
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const dbToY = (db: number) =>
      padT + (1 - (Math.max(-100, Math.min(0, db)) + 100) / 100) * plotH;

    ctx.strokeStyle = '#132018';
    ctx.fillStyle = '#627d6c';
    ctx.font = '10px monospace';
    for (const db of [0, -30, -60, -90]) {
      const y = Math.round(dbToY(db)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(`${db}`, 4, y + 3);
    }

    if (previewSamples.length > 1) {
      // RMS trace
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      previewSamples.forEach((pt, i) => {
        const x = padL + (i / (previewSamples.length - 1)) * plotW;
        const y = dbToY(pt.rmsDbfs);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Noise floor trace
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      previewSamples.forEach((pt, i) => {
        const x = padL + (i / (previewSamples.length - 1)) * plotW;
        const y = dbToY(pt.noiseFloorDbfs);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else {
      ctx.fillStyle = '#52695b';
      ctx.font = '11px monospace';
      ctx.fillText(
        'START A MEASUREMENT SESSION TO RECORD TIMESTAMPED FEATURE TIMELINE',
        padL + 12,
        padT + plotH / 2
      );
    }

    ctx.restore();
  }, [previewSamples]);

  const handleExport = (
    session: MeasurementSession,
    format: 'csv' | 'json' | 'html'
  ) => {
    const safeName = session.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (format === 'csv') {
      triggerFileDownload(
        exportSessionToCsv(session),
        `ghostwire-${safeName}-${session.id}.csv`,
        'text/csv;charset=utf-8'
      );
    } else if (format === 'json') {
      triggerFileDownload(
        exportSessionToJson(session),
        `ghostwire-${safeName}-${session.id}.json`,
        'application/json;charset=utf-8'
      );
    } else {
      triggerFileDownload(
        exportSessionToHtmlReport(session),
        `ghostwire-${safeName}-${session.id}.html`,
        'text/html;charset=utf-8'
      );
    }
  };

  return (
    <div className="space-y-4">
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

      {/* Recorder Controls */}
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
            <span
              className={
                recordingState === 'recording'
                  ? 'text-[#4ade80] font-bold'
                  : recordingState === 'paused'
                    ? 'text-[#fbbf24] font-bold'
                    : 'text-[#86a390]'
              }
            >
              {recordingState.toUpperCase()}
            </span>
          </div>
          <div className="tabular-nums">
            <span className="text-[#6e8a78]">DURATION: </span>
            <span>{activeSessionDurationSec.toFixed(1)} s</span>
          </div>
          <div className="tabular-nums">
            <span className="text-[#6e8a78]">FRAMES: </span>
            <span>{activeSamples.length}</span>
          </div>
        </div>
      </div>

      {/* Timeline Canvas */}
      <div className="panel-border rounded-sm overflow-hidden">
        <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px] text-[#86a390]">
          <span>FEATURE TIMELINE // RMS (GREEN) &amp; NOISE FLOOR (AMBER) dBFS</span>
          <span>{previewSamples.length} logged points</span>
        </div>
        <canvas ref={timelineCanvasRef} className="w-full block" style={{ height: 160 }} />
      </div>

      {/* Saved Sessions Table */}
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
                        onClick={() => handleExport(sess, 'csv')}
                        className="px-2 py-0.5 rounded-xs border border-[#24322a] bg-[#0f171c] hover:bg-[#17252c] text-[#86efac] cursor-pointer"
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExport(sess, 'json')}
                        className="px-2 py-0.5 rounded-xs border border-[#24322a] bg-[#0f171c] hover:bg-[#17252c] text-[#93c5fd] cursor-pointer"
                      >
                        JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExport(sess, 'html')}
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

      {/* Local Session Comparison */}
      {savedSessions.length >= 2 && (
        <div className="panel-border rounded-sm p-3 space-y-3">
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            LOCAL SESSION COMPARISON (COMPUTED OFF-THREAD IN DSP WORKER)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-[#7a9384] block">Baseline Session A</span>
              <select
                value={selectedIdA}
                onChange={(e) => setSelectedIdA(e.target.value)}
                className="w-full bg-[#06090b] border border-[#1f2e25] px-2 py-1.5 rounded-xs text-xs"
              >
                {savedSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationSec.toFixed(1)}s, {s.sourceMode})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-[#7a9384] block">Comparison Session B</span>
              <select
                value={selectedIdB}
                onChange={(e) => setSelectedIdB(e.target.value)}
                className="w-full bg-[#06090b] border border-[#1f2e25] px-2 py-1.5 rounded-xs text-xs"
              >
                {savedSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationSec.toFixed(1)}s, {s.sourceMode})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {comparison && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <MetricTile
                label="Mean RMS Δ (B-A)"
                value={`${comparison.rmsDeltaDb >= 0 ? '+' : ''}${comparison.rmsDeltaDb.toFixed(1)}`}
                unit="dB"
              />
              <MetricTile
                label="Noise Floor Δ"
                value={`${comparison.noiseFloorDeltaDb >= 0 ? '+' : ''}${comparison.noiseFloorDeltaDb.toFixed(1)}`}
                unit="dB"
              />
              <MetricTile
                label="Centroid Δ"
                value={`${comparison.centroidDeltaHz >= 0 ? '+' : ''}${comparison.centroidDeltaHz.toFixed(0)}`}
                unit="Hz"
              />
              <MetricTile
                label="Spectral Similarity"
                value={
                  comparison.fingerprintComparison
                    ? `${(comparison.fingerprintComparison.cosineSimilarity * 100).toFixed(1)}%`
                    : 'N/A'
                }
                accent={
                  comparison.fingerprintComparison &&
                  comparison.fingerprintComparison.cosineSimilarity >= 0.85
                    ? 'green'
                    : 'amber'
                }
                subtext={
                  comparison.fingerprintComparison
                    ? `RMSE ${comparison.fingerprintComparison.spectralDistanceDb.toFixed(1)} dB`
                    : undefined
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
