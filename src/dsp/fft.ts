/**
 * Pure TypeScript Radix-2 Cooley-Tukey FFT & Hann Window utilities.
 *
 * Windowing Convention:
 *   Hann window: w[n] = 0.5 * (1 - cos(2 * pi * n / (N - 1)))
 *   Coherent Gain (CG) = (1 / N) * sum(w[n]) ≈ 0.5
 *
 * Single-Sided Amplitude Normalization:
 *   For 0 < k < N/2: A[k] = (2 * |X[k]|) / (N * CG)
 *   For k = 0, N/2:  A[k] = |X[k]| / (N * CG)
 *   A unit-amplitude bin-centered sine wave (peak = 1.0) yields A[k0] = 1.0 (0 dBFS peak).
 *   Single-sided mean-square power bin: P[k] = 0.5 * A[k]^2 (0 < k < N/2), A[k]^2 (DC/Nyquist).
 */

const hannCache = new Map<number, { window: Float32Array; coherentGain: number }>();

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

function getHannWindow(size: number): { window: Float32Array; coherentGain: number } {
  const cached = hannCache.get(size);
  if (cached) return cached;

  const window = new Float32Array(size);
  let sum = 0;
  const denom = size > 1 ? size - 1 : 1;
  for (let n = 0; n < size; n++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / denom));
    window[n] = w;
    sum += w;
  }
  const coherentGain = sum / size;
  const entry = { window, coherentGain };
  hannCache.set(size, entry);
  return entry;
}

/**
 * In-place iterative Radix-2 Cooley-Tukey FFT.
 * `real` and `imag` must have identical power-of-two length N.
 */
function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (n !== imag.length || !isPowerOfTwo(n)) {
    throw new Error(`FFT length must be a power of two >= 2 (got ${n}, ${imag.length})`);
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;

      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    const wMulReal = Math.cos(angleStep);
    const wMulImag = Math.sin(angleStep);

    for (let start = 0; start < n; start += len) {
      let wReal = 1;
      let wImag = 0;
      for (let k = 0; k < halfLen; k++) {
        const evenIdx = start + k;
        const oddIdx = evenIdx + halfLen;

        const oddReal = real[oddIdx];
        const oddImag = imag[oddIdx];

        const tReal = wReal * oddReal - wImag * oddImag;
        const tImag = wReal * oddImag + wImag * oddReal;

        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] += tReal;
        imag[evenIdx] += tImag;

        const nextWReal = wReal * wMulReal - wImag * wMulImag;
        wImag = wReal * wMulImag + wImag * wMulReal;
        wReal = nextWReal;
      }
    }
  }
}

export interface SpectrumResult {
  magnitude: Float32Array; // Single-sided peak amplitude [0..N/2]
  power: Float32Array; // Single-sided mean-square power [0..N/2]
  spectrumDbfs: Float32Array; // 20*log10(max(magnitude, eps)) [0..N/2]
}

const EPSILON = 1e-7; // -140 dBFS floor

export function computeHannSpectrum(
  samples: Float32Array,
  fftSize: number = samples.length
): SpectrumResult {
  if (!isPowerOfTwo(fftSize)) {
    throw new Error(`fftSize must be a power of two (got ${fftSize})`);
  }

  const { window, coherentGain } = getHannWindow(fftSize);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);

  const copyLen = Math.min(samples.length, fftSize);
  for (let i = 0; i < copyLen; i++) {
    real[i] = samples[i] * window[i];
  }

  fftInPlace(real, imag);

  const numBins = (fftSize >> 1) + 1;
  const magnitude = new Float32Array(numBins);
  const power = new Float32Array(numBins);
  const spectrumDbfs = new Float32Array(numBins);

  const normSingle = 1 / (fftSize * coherentGain);
  const normDouble = 2 * normSingle;

  for (let k = 0; k < numBins; k++) {
    const magRaw = Math.hypot(real[k], imag[k]);
    const isEdge = k === 0 || k === fftSize >> 1;
    const amp = magRaw * (isEdge ? normSingle : normDouble);
    magnitude[k] = amp;
    power[k] = isEdge ? amp * amp : 0.5 * amp * amp;
    spectrumDbfs[k] = 20 * Math.log10(Math.max(amp, EPSILON));
  }

  return { magnitude, power, spectrumDbfs };
}
