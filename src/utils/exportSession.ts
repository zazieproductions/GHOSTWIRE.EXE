import { buildEnvironmentalFingerprint } from '../dsp/analysis';
import type {
  DspFrame,
  InputMode,
  MeasurementSession,
  SessionSamplePoint,
} from '../types/acoustic';

export const SESSION_PRIVACY_NOTICE =
  'PRIVACY NOTICE: Although this export contains NO raw audio recordings, speech transcripts, or waveform samples, timestamped aggregate acoustic features (such as noise floor shifts, cadence/activity duty cycles, and spectral profiles) can themselves reveal sensitive environmental or behavioral patterns.';

export function frameToSessionSample(
  frame: DspFrame,
  elapsedSec: number
): SessionSamplePoint {
  return {
    elapsedSec: Number(elapsedSec.toFixed(3)),
    timestampIso: new Date(frame.timestampMs).toISOString(),
    rmsDbfs: Number(frame.rmsDbfs.toFixed(3)),
    peakDbfs: Number(frame.peakDbfs.toFixed(3)),
    noiseFloorDbfs: Number(frame.noiseFloorDbfs.toFixed(3)),
    dominantFrequencyHz: Number(frame.dominantFrequencyHz.toFixed(2)),
    spectralCentroidHz: Number(frame.spectralCentroidHz.toFixed(2)),
    spectralBandwidthHz: Number(frame.spectralBandwidthHz.toFixed(2)),
    spectralFlatness: Number(frame.spectralFlatness.toFixed(4)),
    zeroCrossingRate: Number(frame.zeroCrossingRate.toFixed(5)),
    lowRatio: Number(frame.bandEnergy.lowRatio.toFixed(4)),
    midRatio: Number(frame.bandEnergy.midRatio.toFixed(4)),
    highRatio: Number(frame.bandEnergy.highRatio.toFixed(4)),
    isActive: frame.isActive,
  };
}

export function buildMeasurementSession(params: {
  id: string;
  name: string;
  startedAtIso: string;
  endedAtIso: string | null;
  durationSec: number;
  sourceMode: InputMode;
  sampleRate: number;
  fftSize: number;
  samples: SessionSamplePoint[];
  framesForFingerprint?: DspFrame[];
}): MeasurementSession {
  const { samples } = params;
  const count = samples.length;

  if (count === 0) {
    return {
      id: params.id,
      name: params.name,
      startedAtIso: params.startedAtIso,
      endedAtIso: params.endedAtIso,
      durationSec: params.durationSec,
      sourceMode: params.sourceMode,
      sampleRate: params.sampleRate,
      fftSize: params.fftSize,
      samples: [],
      summary: {
        sampleCount: 0,
        meanRmsDbfs: -120,
        minRmsDbfs: -120,
        maxRmsDbfs: -120,
        noiseFloorDbfs: -120,
        meanCentroidHz: 0,
        meanBandwidthHz: 0,
        meanFlatness: 0,
        meanZcr: 0,
        activityDutyCyclePct: 0,
        meanBandEnergy: { lowRatio: 0, midRatio: 0, highRatio: 0 },
      },
      fingerprint: null,
    };
  }

  let sumRms = 0;
  let minRms = Infinity;
  let maxRms = -Infinity;
  let sumCentroid = 0;
  let sumBandwidth = 0;
  let sumFlatness = 0;
  let sumZcr = 0;
  let sumLow = 0;
  let sumMid = 0;
  let sumHigh = 0;
  let activeCount = 0;

  const rmsSorted = samples.map((s) => s.rmsDbfs).sort((a, b) => a - b);
  const noiseFloorDbfs =
    rmsSorted[Math.max(0, Math.floor(0.1 * (count - 1)))];

  for (const s of samples) {
    sumRms += s.rmsDbfs;
    if (s.rmsDbfs < minRms) minRms = s.rmsDbfs;
    if (s.rmsDbfs > maxRms) maxRms = s.rmsDbfs;
    sumCentroid += s.spectralCentroidHz;
    sumBandwidth += s.spectralBandwidthHz;
    sumFlatness += s.spectralFlatness;
    sumZcr += s.zeroCrossingRate;
    sumLow += s.lowRatio;
    sumMid += s.midRatio;
    sumHigh += s.highRatio;
    if (s.isActive) activeCount++;
  }

  const fingerprint =
    params.framesForFingerprint && params.framesForFingerprint.length > 0
      ? buildEnvironmentalFingerprint(
          params.framesForFingerprint,
          params.name,
          params.sourceMode
        )
      : null;

  return {
    id: params.id,
    name: params.name,
    startedAtIso: params.startedAtIso,
    endedAtIso: params.endedAtIso,
    durationSec: Number(params.durationSec.toFixed(2)),
    sourceMode: params.sourceMode,
    sampleRate: params.sampleRate,
    fftSize: params.fftSize,
    samples,
    summary: {
      sampleCount: count,
      meanRmsDbfs: Number((sumRms / count).toFixed(2)),
      minRmsDbfs: Number(minRms.toFixed(2)),
      maxRmsDbfs: Number(maxRms.toFixed(2)),
      noiseFloorDbfs: Number(noiseFloorDbfs.toFixed(2)),
      meanCentroidHz: Number((sumCentroid / count).toFixed(1)),
      meanBandwidthHz: Number((sumBandwidth / count).toFixed(1)),
      meanFlatness: Number((sumFlatness / count).toFixed(4)),
      meanZcr: Number((sumZcr / count).toFixed(5)),
      activityDutyCyclePct: Number(((activeCount / count) * 100).toFixed(1)),
      meanBandEnergy: {
        lowRatio: Number((sumLow / count).toFixed(4)),
        midRatio: Number((sumMid / count).toFixed(4)),
        highRatio: Number((sumHigh / count).toFixed(4)),
      },
    },
    fingerprint,
  };
}

export function exportSessionToCsv(session: MeasurementSession): string {
  const headerLines = [
    `# GHOSTWIRE.EXE Acoustic Feature Session Export`,
    `# ${SESSION_PRIVACY_NOTICE}`,
    `# Session: ${session.name} (${session.id})`,
    `# Source: ${session.sourceMode} | Sample Rate: ${session.sampleRate} Hz | FFT Size: ${session.fftSize}`,
    `# Started: ${session.startedAtIso} | Duration: ${session.durationSec.toFixed(2)} s | Samples: ${session.summary.sampleCount}`,
    `# Note: dBFS is digital full-scale relative amplitude, NOT calibrated physical dB SPL.`,
  ];

  const columns = [
    'elapsed_sec',
    'timestamp_iso',
    'rms_dbfs',
    'peak_dbfs',
    'noise_floor_dbfs',
    'dominant_freq_hz',
    'spectral_centroid_hz',
    'spectral_bandwidth_hz',
    'spectral_flatness',
    'zero_crossing_rate',
    'low_band_ratio',
    'mid_band_ratio',
    'high_band_ratio',
    'is_active',
  ];

  const rows = session.samples.map((s) =>
    [
      s.elapsedSec,
      s.timestampIso,
      s.rmsDbfs,
      s.peakDbfs,
      s.noiseFloorDbfs,
      s.dominantFrequencyHz,
      s.spectralCentroidHz,
      s.spectralBandwidthHz,
      s.spectralFlatness,
      s.zeroCrossingRate,
      s.lowRatio,
      s.midRatio,
      s.highRatio,
      s.isActive ? 1 : 0,
    ].join(',')
  );

  return [...headerLines, columns.join(','), ...rows].join('\n');
}

export function exportSessionToJson(session: MeasurementSession): string {
  const payload = {
    schema: 'ghostwire.exe/session-export/v1',
    exportedAtIso: new Date().toISOString(),
    privacyNotice: SESSION_PRIVACY_NOTICE,
    scientificNote:
      'dBFS values represent uncalibrated digital full-scale ratios relative to PCM +/-1.0, not physical dB SPL.',
    containsRawAudio: false,
    session,
  };
  return JSON.stringify(payload, null, 2);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportSessionToHtmlReport(session: MeasurementSession): string {
  const s = session.summary;
  const sampleRows = session.samples
    .slice(0, 250)
    .map(
      (pt) => `<tr>
        <td>${pt.elapsedSec.toFixed(2)}</td>
        <td>${pt.rmsDbfs.toFixed(1)}</td>
        <td>${pt.peakDbfs.toFixed(1)}</td>
        <td>${pt.noiseFloorDbfs.toFixed(1)}</td>
        <td>${pt.dominantFrequencyHz.toFixed(1)}</td>
        <td>${pt.spectralCentroidHz.toFixed(0)}</td>
        <td>${pt.spectralFlatness.toFixed(3)}</td>
        <td>${(pt.lowRatio * 100).toFixed(0)}/${(pt.midRatio * 100).toFixed(0)}/${(pt.highRatio * 100).toFixed(0)}%</td>
        <td>${pt.isActive ? 'ACTIVE' : 'QUIET'}</td>
      </tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>GHOSTWIRE.EXE Report — ${escapeHtml(session.name)}</title>
<style>
  body { background:#07090b; color:#d1ddd4; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; line-height: 1.5; }
  h1, h2 { color:#4ade80; margin-bottom: 6px; }
  .notice { border:1px solid #d97706; background:#1c1407; color:#fcd34d; padding:12px; margin:16px 0; font-size:13px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:10px; margin:16px 0; }
  .card { border:1px solid #1f2d24; background:#0c1114; padding:10px; }
  .label { color:#7a9384; font-size:11px; text-transform:uppercase; }
  .val { font-size:16px; color:#e5f2e9; font-weight:bold; }
  table { width:100%; border-collapse:collapse; margin-top:12px; font-size:12px; }
  th, td { border:1px solid #1f2d24; padding:6px 8px; text-align:right; }
  th { background:#0f161a; color:#86efac; }
  td:first-child, th:first-child { text-align:left; }
</style>
</head>
<body>
  <h1>GHOSTWIRE.EXE — Acoustic Feature Research Report</h1>
  <p>Session: <strong>${escapeHtml(session.name)}</strong> (${escapeHtml(session.id)}) | Source: <strong>${escapeHtml(session.sourceMode)}</strong> | Started: ${escapeHtml(session.startedAtIso)}</p>
  <div class="notice"><strong>${escapeHtml(SESSION_PRIVACY_NOTICE)}</strong><br/>Measurements in dBFS are uncalibrated digital levels relative to full scale, not physical dB SPL.</div>
  <h2>Aggregate Feature Summary</h2>
  <div class="grid">
    <div class="card"><div class="label">Duration</div><div class="val">${session.durationSec.toFixed(2)} s</div></div>
    <div class="card"><div class="label">Feature Frames</div><div class="val">${s.sampleCount}</div></div>
    <div class="card"><div class="label">Mean RMS Level</div><div class="val">${s.meanRmsDbfs.toFixed(1)} dBFS</div></div>
    <div class="card"><div class="label">Estimated Noise Floor</div><div class="val">${s.noiseFloorDbfs.toFixed(1)} dBFS</div></div>
    <div class="card"><div class="label">Mean Centroid</div><div class="val">${s.meanCentroidHz.toFixed(0)} Hz</div></div>
    <div class="card"><div class="label">Mean Bandwidth</div><div class="val">${s.meanBandwidthHz.toFixed(0)} Hz</div></div>
    <div class="card"><div class="label">Mean Flatness</div><div class="val">${s.meanFlatness.toFixed(3)}</div></div>
    <div class="card"><div class="label">Activity Duty Cycle</div><div class="val">${s.activityDutyCyclePct.toFixed(1)}%</div></div>
    <div class="card"><div class="label">Low / Mid / High Energy</div><div class="val">${(s.meanBandEnergy.lowRatio * 100).toFixed(0)}% / ${(s.meanBandEnergy.midRatio * 100).toFixed(0)}% / ${(s.meanBandEnergy.highRatio * 100).toFixed(0)}%</div></div>
  </div>
  <h2>Timestamped Feature Log (up to 250 samples)</h2>
  <table>
    <thead>
      <tr>
        <th>Elapsed (s)</th><th>RMS dBFS</th><th>Peak dBFS</th><th>Floor dBFS</th>
        <th>Dom Hz</th><th>Centroid Hz</th><th>Flatness</th><th>L/M/H %</th><th>State</th>
      </tr>
    </thead>
    <tbody>
      ${sampleRows}
    </tbody>
  </table>
</body>
</html>`;
}

export function triggerFileDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
