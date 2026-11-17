import { useEffect, useRef } from 'react';
import type { DspFrame, FrequencyScale } from '../../types/acoustic';

interface SpectrogramCanvasProps {
  frame: DspFrame | null;
  scale?: FrequencyScale;
  height?: number;
}

/**
 * Maps dBFS [-100..0] to phosphor-black -> deep green -> bright green -> amber-hot palette.
 */
function dbfsToRgb(db: number): [number, number, number] {
  const norm = Math.max(0, Math.min(1, (db + 100) / 92));
  if (norm < 0.25) {
    const t = norm / 0.25;
    return [6, Math.round(9 + t * 32), Math.round(11 + t * 18)];
  }
  if (norm < 0.6) {
    const t = (norm - 0.25) / 0.35;
    return [Math.round(6 + t * 28), Math.round(41 + t * 155), Math.round(29 + t * 65)];
  }
  if (norm < 0.85) {
    const t = (norm - 0.6) / 0.25;
    return [Math.round(34 + t * 210), Math.round(196 - t * 25), Math.round(94 - t * 75)];
  }
  const t = (norm - 0.85) / 0.15;
  return [245, Math.round(171 + t * 75), Math.round(19 + t * 140)];
}

export function SpectrogramCanvas({
  frame,
  scale = 'log',
  height = 175,
}: SpectrogramCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth || 640;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenRef.current;
    if (offscreen.width !== width || offscreen.height !== height) {
      offscreen.width = width;
      offscreen.height = height;
      const octx = offscreen.getContext('2d');
      if (octx) {
        octx.fillStyle = '#06090b';
        octx.fillRect(0, 0, width, height);
      }
    }

    const octx = offscreen.getContext('2d');
    const ctx = canvas.getContext('2d');
    if (!octx || !ctx) return;

    if (frame) {
      // Scroll left by 2 pixels using fast GPU blit
      const shift = 2;
      octx.drawImage(offscreen, shift, 0, width - shift, height, 0, 0, width - shift, height);

      const colImg = octx.createImageData(shift, height);
      const data = colImg.data;
      const spec = frame.spectrumDbfs;
      const nyquist = frame.sampleRate / 2;
      const minFreq = 20;

      for (let y = 0; y < height; y++) {
        // y=0 is top (highest freq), y=height-1 is bottom (lowest freq)
        const normY = 1 - y / Math.max(1, height - 1);
        let freq: number;
        if (scale === 'log') {
          freq = minFreq * Math.pow(nyquist / minFreq, normY);
        } else {
          freq = normY * nyquist;
        }
        const bin = Math.min(
          spec.length - 1,
          Math.max(1, Math.round(freq / frame.binWidthHz))
        );
        const [r, g, b] = dbfsToRgb(spec[bin]);
        for (let dx = 0; dx < shift; dx++) {
          const idx = (y * shift + dx) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
      octx.putImageData(colImg, width - shift, 0);
    }

    ctx.drawImage(offscreen, 0, 0);

    // Axis frequency labels overlay
    ctx.fillStyle = 'rgba(6, 9, 11, 0.72)';
    ctx.fillRect(0, 0, 44, height);
    ctx.fillStyle = '#86a390';
    ctx.font = '10px monospace';
    const nyquist = frame ? frame.sampleRate / 2 : 24000;
    const minFreq = 20;
    const markers = scale === 'log' ? [100, 500, 2000, 10000] : [2000, 6000, 12000, 18000];
    for (const f of markers) {
      if (f >= nyquist) continue;
      const norm =
        scale === 'log'
          ? (Math.log10(f) - Math.log10(minFreq)) /
            (Math.log10(nyquist) - Math.log10(minFreq))
          : f / nyquist;
      const y = (1 - norm) * (height - 1);
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 4, Math.max(10, Math.min(height - 4, y + 3)));
    }
  }, [frame, scale, height]);

  return (
    <div className="panel-border rounded-sm overflow-hidden">
      <div className="panel-header px-3 py-1.5 flex items-center justify-between text-[11px] tracking-wider text-[#86a390]">
        <span>SCROLLING SPECTROGRAM // TIME × FREQUENCY × ENERGY</span>
        <span className="text-[#5e7a68]">
          Palette: -100 dBFS (dark) → -8 dBFS (amber)
        </span>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Scrolling frequency spectrogram"
        className="w-full block"
        style={{ height }}
      />
    </div>
  );
}
