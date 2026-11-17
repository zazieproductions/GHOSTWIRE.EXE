# GHOSTWIRE.EXE

> **Tagline:** *Your microphone reveals more than your words.*

**GHOSTWIRE.EXE** is a 100% client-side, consent-based acoustic privacy research and digital signal processing (DSP) laboratory built with React, TypeScript, Tailwind CSS, and the Web Audio API. It investigates what environmental, behavioral, and hardware metadata can be inferred from microphone signals and browser audio APIs—even without recording conversations, running speech transcription, or transmitting audio.

---

## Features & Research Modules

### 1. Real-Time Signal Analysis (`LIVE MONITOR`)
- Explicit, user-initiated microphone capture (`Enable Microphone` / immediate `Stop Microphone`)
- Live Oscilloscope waveform, Hann-windowed FFT spectrum (Logarithmic or Linear scale, Peak Hold), and GPU-accelerated scrolling spectrogram
- Real computed DSP measurements with documented units:
  - RMS amplitude (`FS`), Peak amplitude (`FS`), and relative digital levels (`dBFS`, explicitly distinguished from calibrated physical `dB SPL`)
  - Crest factor (`dB`), Dominant frequency (`Hz`, with 3-point parabolic log-magnitude interpolation)
  - Spectral centroid (`Hz`), Spectral bandwidth (`Hz`), Spectral flatness (Wiener entropy)
  - Zero-crossing rate (normalized ratio and estimated crossing frequency in `Hz`)
  - Adaptive 10th-percentile noise floor estimation & activity/silence state
  - Low (`20–250 Hz`), Mid (`250–2,000 Hz`), and High (`2,000 Hz–Nyquist`) frequency energy distribution

### 2. Privacy Exposure Laboratory (`EXPOSURE LAB`)
Five independently runnable experiments, each documented with Research Question, Hypothesis, Procedure, Measured Variables, Observations, Limitations, Confounding Factors, and Reproducibility Notes:
- **Experiment A — Environmental Fingerprint:** Captures two independent ephemeral 32-band log-spectral profiles (no raw audio saved) and compares them off-thread in a Web Worker (cosine similarity, spectral RMSE, noise-floor delta, band shifts), with explicit limits on location/identity claims.
- **Experiment B — Activity Inference:** Transparent, threshold-documented heuristics detecting relative quiet, sustained tonal activity, broadband noise, transient/impulsive sounds, and repetitive cadence (via RMS envelope autocorrelation).
- **Experiment C — Microphone Metadata Leakage:** Demonstrates browser permission boundaries (`getSupportedConstraints`, explicit `enumerateDevices` label redaction before vs. after permission, `MediaStreamTrack.getSettings()` vs. requested constraints).
- **Experiment D — Signal Transformation:** Real-time dual-analyser Web Audio chain (`preAnalyser` vs. `postAnalyser`) with Gain (`±24 dB`), High-Pass filter, Low-Pass filter, Noise Gate, and optional Broadband Noise Injection.
- **Experiment E — Privacy Leakage Demonstrator:** Aggregates observable acoustic and metadata channels into potential broad inferences, explicit non-conclusions, mitigations, and a clearly labeled **Educational Heuristic Index** (non-validated).

### 3. Synthetic Signal Laboratory (`SYNTHETIC SIGNALS`)
- Works **without microphone permission**
- Routes locally synthesized signals (`sine`, `white`, `pink`, `sweep`, `impulse`, `mixed`, `hum`) through the **exact same Web Audio `AnalyserNode` and DSP engine**
- Includes 5 one-click presets: *Electrical Hum*, *Broadband Noise*, *Tonal Interference*, *Repetitive Transients*, and *Frequency Masking*
- Built-in deterministic **DSP Numerical Self-Verification** checks

### 4. Session Recording, Comparison & Exports (`SESSION ANALYSIS`)
- Explicit Start / Pause / Stop measurement sessions retaining **only numerical feature aggregates and timestamps** (zero raw audio)
- Local off-thread session comparison
- Export **CSV**, **JSON**, and self-contained **HTML Research Reports**, each embedding a privacy warning that aggregate features themselves can reveal sensitive information
- **Clear All Session Data** control and strict volatile RAM retention by default (local persistence is off unless explicitly opted in)

---

## Quick Start

### Prerequisites
- Node.js `>= 20` and npm `>= 10`
- A modern desktop browser (Chrome, Edge, Firefox, or Safari on macOS / Linux / Windows)
- Microphone access requires a secure context (`http://localhost` / `http://127.0.0.1` or `https://`)

### Installation & Commands

```bash
npm install
npm run dev
npm run build
npm test
```

- `npm run dev` — Starts the local Vite development server (`0.0.0.0:5173`)
- `npm run build` — Runs `tsc -b` type-checking and produces the static production bundle in `dist/` (with strict `connect-src 'none'` CSP meta tag)
- `npm run preview` — Previews the production `dist/` build locally
- `npm test` — Runs the Vitest unit & integration test suite
- `npm run test:e2e` — Runs Playwright browser integration tests (requires `npx playwright install chromium` first)

---

## Reproducing Experiments (Without a Microphone)

1. Run `npm run dev` and open the app in your browser.
2. Navigate to **SYNTHETIC SIGNALS** and click **Electrical Hum (60 Hz + Harmonics)**.
3. Click **RUN DSP NUMERICAL CHECKS** to verify low-band concentration (`>80%`) and fundamental frequency detection (`~60 Hz`).
4. Navigate to **EXPOSURE LAB → EXP A**, capture **Window A** while Electrical Hum is active, switch to **Broadband Noise** and capture **Window B**, and verify low spectral cosine similarity and noise-floor/band deltas.
5. Switch to **Frequency Masking (150 Hz Masking 240 Hz)**, open **EXP D**, enable the Transformation Pipeline, and toggle a **200 Hz High-Pass Filter** to observe the dominant frequency shift from `~150 Hz` to `~240 Hz`.
6. Switch to **Repetitive Transients (4 Hz Impulses)** and open **EXP B** to observe transient detection and `~4.0 Hz` envelope periodicity.

---

## Platform-Specific Limitations

- **macOS / Apple Silicon & Safari:** Safari may restrict `MediaStreamTrack.getCapabilities()` or resample hardware input to 44.1/48 kHz independently of requested constraints. macOS Control Center's orange microphone indicator remains authoritative over any browser UI.
- **Browser Audio Processing Overrides:** Chromium, Firefox, and Safari may honor or ignore `echoCancellation`, `noiseSuppression`, and `autoGainControl` flags depending on OS audio drivers or Bluetooth headset profiles (HFP/A2DP). Always compare *Requested Constraints* against *Actual Settings* in Experiment C.
- **Uncalibrated dBFS vs. dB SPL:** Browsers cannot read physical microphone capsule sensitivity or analog preamp gain. All levels in `dBFS` are relative to digital full scale (`±1.0` PCM), never physical sound pressure level (`dB SPL`).
- **Static Deployment:** Built with `base: './'` for zero-config static hosting on GitHub Pages, Cloudflare Pages, or Gitea Pages. Note that `connect-src 'none'` in the production CSP prevents any outbound fetch/XHR/WebSocket calls.

---

## Example Test Results

Actual command output from `npm test` (Vitest v3.2.7):

```text
 ✓ src/dsp/__tests__/dsp.test.ts (8 tests) 97ms
 ✓ src/__tests__/app.integration.test.tsx (5 tests) 835ms

 Test Files  2 passed (2)
      Tests  13 passed (13)
```

Actual build verification (`npm run lint && npm run build`):

```text
dist/index.html                       0.93 kB
dist/assets/dsp.worker-BoLclnY2.js    3.07 kB
dist/assets/index-e1gsebSj.css       22.03 kB
dist/assets/index-C8CPi5h0.js       370.34 kB
✓ built in 1.43s
```

*Note on Playwright E2E (`e2e/ghostwire.spec.ts`):* The Playwright suite could not be executed in the offline sandbox because the Chromium binary (`npx playwright install chromium`) requires external CDN downloads outside the sandbox network allowlist. Run `npx playwright install chromium && npm run test:e2e` locally to execute the full browser E2E spec.

---

## License

MIT License — see [LICENSE](./LICENSE).
