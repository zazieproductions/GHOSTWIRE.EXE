import { useEffect, useRef } from 'react';
import type { DspFrame, FrequencyScale } from '../../types/acoustic';

interface SpectrumCanvasProps {
  frame: DspFrame | null;
  secondaryFrame?: DspFrame | null;
  scale?: FrequencyScale;
  showPeakHold?: boolean;
  height?: number;
  label?: string;
}

export function SpectrumCanvas({
  frame,
  secondaryFrame = null,
  scale = 'log',
  showPeakHold = true,
  height = 210,
  label = 'FFT MAGNITUDE SPECTRUM // dBFS (UNCALIBRATED DIGITAL LEVEL)',
}: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHoldRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    if (!frame) {
      peakHoldRef.current = null;
      return;
    }
    if (
      !peakHoldRef.current ||
      peakHoldRef.current.length !== frame.spectrumDbfs.length
    ) {
      peakHoldRef.current = new Float32Array(frame.spectrumDbfs);
    } else if (showPeakHold) {
      const hold = peakHoldRef.current;
      for (let i = 0; i < hold.length; i++) {
        hold[i] = Math.max(hold[i] - 0.35, frame.spectrumDbfs[i]);
      }
    }
  }, [frame, showPeakHold]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 640;
    const targetW = Math.floor(width * dpr);
    const targetH = Math.floor(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#06090b';
    ctx.fillRect(0, 0, width, height);

    const padLeft = 38;
    const padRight = 10;
    const padTop = 12;
    const padBottom = 22;
    const plotW = Math.max(40, width - padLeft - padRight);
    const plotH = Math.max(40, height - padTop - padBottom);

    const minDb = -100;
    const maxDb = 0;
    const sampleRate = frame?.sampleRate ?? 48000;
    const nyquist = sampleRate / 2;
    const minFreq = 20;

    const freqToX = (freq: number): number => {
      if (scale === 'linear') {
        return padLeft + (Math.min(nyquist, Math.max(0, freq)) / nyquist) * plotW;
      }
      const clamped = Math.max(minFreq, Math.min(nyquist, freq));
      const norm =
        (Math.log10(clamped) - Math.log10(minFreq)) /
        (Math.log10(nyquist) - Math.log10(minFreq));
      return padLeft + norm * plotW;
    };

    const dbToY = (db: number): number => {
      const clamped = Math.max(minDb, Math.min(maxDb, db));
      const norm = (clamped - minDb) / (maxDb - minDb);
      return padTop + (1 - norm) * plotH;
    };

    // Horizontal dB grid
    ctx.strokeStyle = '#132018';
    ctx.fillStyle = '#5c7867';
    ctx.font = '10px monospace';
    ctx.lineWidth = 1;
    for (const db of [0, -20, -40, -60, -80, -100]) {
      const y = Math.round(dbToY(db)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      ctx.fillText(`${db}`, 4, y + 3);
    }

    // Vertical frequency grid
    const ticks =
      scale === 'log'
        ? [20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000]
        : [0, 2000, 5000, 10000, 15000, 20000];
    for (const freq of ticks) {
      if (freq > nyquist) continue;
      const x = Math.round(freqToX(freq)) + 0.5;
      ctx.strokeStyle = '#132018';
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
      const labelTxt = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      ctx.fillStyle = '#5c7867';
      ctx.fillText(labelTxt, Math.min(width - 24, x - 8), height - 6);
    }

    // Band divider highlights (250 Hz, 2000 Hz)
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.2)';
    ctx.setLineDash([3, 3]);
    for (const bandEdge of [250, 2000]) {
      const x = freqToX(bandEdge);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const drawSpectrumTrace = (
      spectrumDbfs: Float32Array,
      binWidthHz: number,
      stroke: string,
      fill: string | null,
      lineWidth = 1.4
    ) => {
      ctx.beginPath();
      let started = false;
      for (let k = 1; k < spectrumDbfs.length; k++) {
        const freq = k * binWidthHz;
        if (scale === 'log' && freq < minFreq) continue;
        const x = freqToX(freq);
        const y = dbToY(spectrumDbfs[k]);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      if (fill && started) {
        ctx.lineTo(padLeft + plotW, padTop + plotH);
        ctx.lineTo(padLeft, padTop + plotH);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
    };

    if (frame) {
      if (showPeakHold && peakHoldRef.current) {
        drawSpectrumTrace(
          peakHoldRef.current,
          frame.binWidthHz,
          'rgba(134, 239, 172, 0.28)',
          null,
          1
        );
      }

      drawSpectrumTrace(
        frame.spectrumDbfs,
        frame.binWidthHz,
        '#22c55e',
        'rgba(34, 197, 94, 0.12)',
        1.5
      );

      if (secondaryFrame) {
        drawSpectrumTrace(
          secondaryFrame.spectrumDbfs,
          secondaryFrame.binWidthHz,
          '#f59e0b',
          null,
          1.5
        );
      }

      // Dominant frequency marker
      if (frame.dominantFrequencyHz >= 20) {
        const dx = freqToX(frame.dominantFrequencyHz);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)';
        ctx.beginPath();
        ctx.moveTo(dx, padTop);
        ctx.lineTo(dx, padTop + plotH);
        ctx.stroke();
        ctx.fillStyle = '#86efac';
        ctx.fillText(
          `DOM ${frame.dominantFrequencyHz.toFixed(0)}Hz`,
          Math.min(width - 80, dx + 4),
          padTop + 11
        );
      }
    } else {
      ctx.fillStyle = '#4e6355';
      ctx.font = '11px monospace';
      ctx.fillText('SPECTRUM STANDBY — NO ACTIVE SIGNAL', padLeft + 14, padTop + plotH / 2);
    }

    ctx.restore();
  }, [frame, secondaryFrame, scale, showPeakHold, height]);

  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px] tracking-wider text-[#86a390]">
        <span>{label}</span>
        <span className="text-[#5e7a68]">
          {frame
            ? `Δf=${frame.binWidthHz.toFixed(1)}Hz | Scale=${scale.toUpperCase()}`
            : `Scale=${scale.toUpperCase()}`}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Real-time FFT frequency spectrum"
        className="w-full block"
        style={{ height }}
      />
    </div>
  );
}
