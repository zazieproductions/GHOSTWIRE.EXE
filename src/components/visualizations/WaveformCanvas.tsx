import { useEffect, useRef } from 'react';
import type { DspFrame } from '../../types/acoustic';

interface WaveformCanvasProps {
  frame: DspFrame | null;
  secondaryFrame?: DspFrame | null;
  height?: number;
  label?: string;
}

export function WaveformCanvas({
  frame,
  secondaryFrame = null,
  height = 170,
  label = 'OSCILLOSCOPE // TIME DOMAIN (PCM [-1.0, +1.0])',
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

    // Background
    ctx.fillStyle = '#06090b';
    ctx.fillRect(0, 0, width, height);

    // Graticule
    ctx.strokeStyle = '#132018';
    ctx.lineWidth = 1;
    const rows = 4;
    for (let r = 1; r < rows; r++) {
      const y = Math.round((height * r) / rows) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const cols = 8;
    for (let c = 1; c < cols; c++) {
      const x = Math.round((width * c) / cols) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Center 0 line
    ctx.strokeStyle = '#1f3629';
    ctx.beginPath();
    ctx.moveTo(0, height / 2 + 0.5);
    ctx.lineTo(width, height / 2 + 0.5);
    ctx.stroke();

    const drawTrace = (samples: Float32Array, strokeStyle: string, lineWidth: number) => {
      const n = samples.length;
      if (n === 0) return;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();

      // Downsample cleanly by min/max per pixel column when n > width
      if (n > width * 2) {
        const step = n / width;
        for (let px = 0; px < width; px++) {
          const start = Math.floor(px * step);
          const end = Math.min(n, Math.floor((px + 1) * step));
          let min = 1;
          let max = -1;
          for (let i = start; i < end; i++) {
            const v = samples[i];
            if (v < min) min = v;
            if (v > max) max = v;
          }
          const yMin = height / 2 - max * (height * 0.44);
          const yMax = height / 2 - min * (height * 0.44);
          ctx.moveTo(px, yMin);
          ctx.lineTo(px, Math.max(yMin + 1, yMax));
        }
      } else {
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * width;
          const y = height / 2 - samples[i] * (height * 0.44);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    if (frame) {
      drawTrace(frame.waveform, '#34d399', 1.4);
    } else {
      ctx.fillStyle = '#4e6355';
      ctx.font = '11px monospace';
      ctx.fillText('NO ACTIVE SIGNAL — ENABLE MICROPHONE OR START SYNTHETIC GENERATOR', 14, height / 2 - 8);
    }

    if (secondaryFrame) {
      drawTrace(secondaryFrame.waveform, '#f59e0b', 1.3);
    }

    // Scale annotations
    ctx.fillStyle = '#5c7867';
    ctx.font = '10px monospace';
    ctx.fillText('+1.0', 6, 12);
    ctx.fillText(' 0.0', 6, height / 2 - 4);
    ctx.fillText('-1.0', 6, height - 5);

    ctx.restore();
  }, [frame, secondaryFrame, height]);

  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px] tracking-wider text-[#86a390]">
        <span>{label}</span>
        <span className="text-[#5e7a68]">
          {frame
            ? `N=${frame.fftSize} | Peak ${frame.peak.toFixed(3)} | RMS ${frame.rmsDbfs.toFixed(1)} dBFS`
            : 'IDLE'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Real-time waveform oscilloscope"
        className="w-full block"
        style={{ height }}
      />
    </div>
  );
}
