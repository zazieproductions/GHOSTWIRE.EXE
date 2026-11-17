/** Number of log-spaced bands used for environmental fingerprints. */
export const LOG_BAND_COUNT = 32;

export function computeLogBandEdges(
  minHz: number,
  maxHz: number,
  bandCount = LOG_BAND_COUNT
): Array<{ lowHz: number; centerHz: number; highHz: number }> {
  const safeMin = Math.max(20, minHz);
  const safeMax = Math.max(safeMin * 2, maxHz);
  const logMin = Math.log(safeMin);
  const logMax = Math.log(safeMax);
  const edges: Array<{ lowHz: number; centerHz: number; highHz: number }> = [];

  for (let b = 0; b < bandCount; b++) {
    const lowHz = Math.exp(logMin + ((logMax - logMin) * b) / bandCount);
    const highHz = Math.exp(logMin + ((logMax - logMin) * (b + 1)) / bandCount);
    const centerHz = Math.sqrt(lowHz * highHz);
    edges.push({ lowHz, centerHz, highHz });
  }
  return edges;
}

/**
 * Assign every FFT bin to at most one log band. Band powers are therefore
 * disjoint: no bin is counted twice, and bands narrower than one bin simply
 * contain no bins (their power is reported as the -120 dBFS floor).
 */
export function buildLogBandBinMap(
  fftSize: number,
  sampleRate: number,
  bandEdges: Array<{ lowHz: number; highHz: number }>
): Int16Array {
  const binCount = Math.floor(fftSize / 2) + 1;
  const binToBand = new Int16Array(binCount).fill(-1);
  const binWidth = sampleRate / fftSize;
  const nyquist = sampleRate / 2;

  for (let k = 1; k < binCount; k++) {
    const freq = k * binWidth;
    for (let b = 0; b < bandEdges.length; b++) {
      const isLast = b === bandEdges.length - 1;
      const inBand = isLast
        ? freq >= bandEdges[b].lowHz && freq <= nyquist
        : freq >= bandEdges[b].lowHz && freq < bandEdges[b].highHz;
      if (inBand) {
        binToBand[k] = b;
        break;
      }
    }
  }

  return binToBand;
}
