export function ResearchNotesView() {
  return (
    <div className="space-y-4 text-xs">
      <div className="panel-border rounded-sm p-3">
        <div className="text-xs font-semibold text-[#86efac] tracking-wider">
          RESEARCH NOTES // DSP METHODOLOGY, UNITS &amp; PRIVACY THREAT MODEL
        </div>
        <p className="text-[11px] text-[#7a9384] mt-1">
          Reference specification for GHOSTWIRE.EXE signal calculations, calibration boundaries, and reproducible side-channel experiments.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="panel-border rounded-sm p-3.5 space-y-2">
          <div className="text-[#4ade80] font-semibold tracking-wider">
            1. MATHEMATICAL DSP DEFINITIONS &amp; UNITS
          </div>
          <ul className="space-y-1.5 text-[11px] text-[#c5d4ca]">
            <li>
              <strong>Windowing &amp; FFT:</strong> Hann window{' '}
              <code>w[n] = 0.5*(1 - cos(2πn/(N-1)))</code> with coherent-gain normalization{' '}
              <code>CG ≈ 0.5</code> before Radix-2 Cooley-Tukey FFT. Default{' '}
              <code>N = 2048</code> gives <code>Δf = fs/N ≈ 23.4 Hz</code> at 48 kHz.
            </li>
            <li>
              <strong>RMS &amp; Peak (FS):</strong>{' '}
              <code>RMS = sqrt((1/N) Σ x[n]²)</code>,{' '}
              <code>Peak = max|x[n]|</code> in normalized PCM <code>[-1, +1]</code>.
            </li>
            <li>
              <strong>dBFS (Uncalibrated):</strong>{' '}
              <code>20·log10(max(amp, 1e-6))</code> with <code>-120 dBFS</code> digital floor. A full-scale unit sine wave has <code>0 dBFS</code> peak and <code>-3.01 dBFS</code> RMS.
            </li>
            <li>
              <strong>Spectral Centroid &amp; Bandwidth (Hz):</strong> Magnitude-weighted first moment and standard deviation across bins <code>k = 1..N/2</code> (DC excluded).
            </li>
            <li>
              <strong>Spectral Flatness (Wiener Entropy):</strong> Ratio of geometric mean to arithmetic mean of bin power. Near <code>0</code> for pure sinusoids; <code>~0.56</code> for single-frame Gaussian white noise.
            </li>
            <li>
              <strong>Zero-Crossing Rate (ZCR):</strong> Normalized sign transitions per sample across a <code>±1e-6</code> noise deadband.
            </li>
            <li>
              <strong>Band Energy Distribution:</strong> Power ratio across Low (<code>20–250 Hz</code>), Mid (<code>250–2,000 Hz</code>), and High (<code>2,000 Hz–Nyquist</code>).
            </li>
          </ul>
        </div>

        <div className="panel-border rounded-sm p-3.5 space-y-2">
          <div className="text-[#fbbf24] font-semibold tracking-wider">
            2. dBFS IS NOT PHYSICAL dB SPL
          </div>
          <p className="text-[11px] text-[#c5d4ca]">
            Consumer microphones, USB audio interfaces, and operating-system mixers do not expose calibrated acoustic sensitivity (mV/Pa) or analog preamp gain to the browser. Therefore, <code>-30 dBFS</code> on one laptop can correspond to a completely different physical sound pressure level (dB SPL) than <code>-30 dBFS</code> on another device.
          </p>
          <p className="text-[11px] text-[#c5d4ca]">
            GHOSTWIRE.EXE reports strictly relative digital full-scale ratios (dBFS) and decibel differences (dB) within a single hardware/gain configuration.
          </p>

          <div className="text-[#4ade80] font-semibold tracking-wider pt-2">
            3. AUTHORITATIVE PERMISSION INDICATORS
          </div>
          <p className="text-[11px] text-[#c5d4ca]">
            While GHOSTWIRE.EXE displays a prominent in-app active-microphone indicator and terminates all <code>MediaStreamTrack</code> instances immediately on stop or unmount, <strong>browser tab indicators and OS hardware/menu-bar privacy indicators (e.g., macOS Control Center orange dot) always remain the authoritative ground truth</strong> for physical microphone access.
          </p>
        </div>

        <div className="panel-border rounded-sm p-3.5 space-y-2 lg:col-span-2">
          <div className="text-[#4ade80] font-semibold tracking-wider">
            4. ACOUSTIC SIDE-CHANNEL THREAT MODEL &amp; EPISTEMIC BOUNDARIES
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-[#c5d4ca]">
            <div>
              <div className="font-semibold text-[#86efac] mb-1">
                What Aggregate Features Can Reveal (Without Speech Recording)
              </div>
              <ul className="list-disc list-inside space-y-1">
                <li>Room occupancy changes via long-term noise-floor shifts</li>
                <li>Nearby electrical hum (50/60 Hz harmonics) or HVAC/fan spectra</li>
                <li>Rhythmic interaction cadence via RMS envelope periodicity</li>
                <li>Hardware device class &amp; driver routing via MediaDevices metadata</li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-[#f87171] mb-1">
                What Cannot Be Claimed Without Independent Ground Truth
              </div>
              <ul className="list-disc list-inside space-y-1">
                <li>Unique geographic location or street/building identification</li>
                <li>Speaker identity, age, or biometric verification</li>
                <li>Exact semantic activity labels (e.g., typing vs. tapping vs. cooking)</li>
                <li>Calibrated physical loudness in dB SPL</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
