# RESEARCH.md — Methodology, DSP Specification & Epistemic Boundaries

## 1. Scientific Scope

**GHOSTWIRE.EXE** investigates acoustic side-channel exposure in web browsers: what an application can learn from microphone signal statistics and `MediaDevices` metadata *without* saving raw PCM recordings, streaming audio, or performing speech recognition.

Every displayed metric is computed in real time from time-domain PCM frames (`Float32Array`) captured via Web Audio `AnalyserNode` (`getFloatTimeDomainData`) or generated deterministically by the local synthetic signal engine.

---

## 2. Digital Signal Processing (DSP) Formulas & Conventions

Let $x[n] \in [-1, 1]$ denote a frame of $N \in \{1024, 2048, 4096, 8192\}$ samples at sample rate $f_s$ (Hz).

### 2.1 Time-Domain Measurements
- **RMS Amplitude (Full Scale):**
  $$\text{RMS} = \sqrt{\frac{1}{N} \sum_{n=0}^{N-1} x[n]^2}$$
- **Peak Amplitude (Full Scale):**
  $$\text{Peak} = \max_{0 \le n < N} |x[n]|$$
- **Relative Digital Level (dBFS):**
  $$\text{dBFS} = 20 \log_{10}(\max(\text{amplitude}, 10^{-6}))$$
  Clamped at a $-120\text{ dBFS}$ floor. A full-scale sinusoid $x[n] = \sin(\omega n)$ yields $\text{Peak} = 0\text{ dBFS}$ and $\text{RMS} \approx -3.01\text{ dBFS}$.
- **Crest Factor (dB):**
  $$\text{CF}_{\text{dB}} = 20 \log_{10}\left(\frac{\text{Peak}}{\text{RMS}}\right)$$
- **Zero-Crossing Rate (ZCR):**
  Sign transitions per sample across a $\pm 10^{-6}$ ($-120\text{ dBFS}$) deadband to avoid digital zero-jitter inflation during silence. For a pure tone of frequency $f$, $\text{ZCR} \approx 2f / f_s$.

### 2.2 Windowing & Single-Sided FFT Spectrum
- **Hann Window:**
  $$w[n] = 0.5 \left(1 - \cos\left(\frac{2\pi n}{N - 1}\right)\right), \quad CG = \frac{1}{N}\sum_{n=0}^{N-1} w[n] \approx 0.5$$
- **Radix-2 Cooley-Tukey FFT:**
  Computes $X[k] = \sum_{n=0}^{N-1} x[n] w[n] e^{-j 2\pi k n / N}$.
- **Single-Sided Peak Magnitude & Power:**
  $$M[k] = \frac{2 |X[k]|}{N \cdot CG} \quad (0 < k < N/2), \qquad P[k] = \frac{1}{2} M[k]^2$$
  Edge bins ($k = 0, N/2$) omit the factor of $2$.

### 2.3 Spectral Shape & Band Energy (DC bin $k=0$ excluded)
- **Dominant Frequency (Hz):** Peak bin $k_{\max} = \arg\max_{k \ge 1} M[k]$ refined via 3-point parabolic interpolation on $\ln M[k]$. Resolution prior to interpolation is $\Delta f = f_s / N$.
- **Spectral Centroid (Hz):**
  $$C = \frac{\sum_{k=1}^{N/2} f_k M[k]}{\sum_{k=1}^{N/2} M[k]}$$
- **Spectral Bandwidth (Hz):**
  $$B = \sqrt{\frac{\sum_{k=1}^{N/2} (f_k - C)^2 M[k]}{\sum_{k=1}^{N/2} M[k]}}$$
- **Spectral Flatness (Wiener Entropy, $[0, 1]$):**
  $$\text{SFM} = \frac{\exp\left(\frac{1}{K}\sum_{k=1}^{K} \ln(P[k] + \epsilon)\right)}{\frac{1}{K}\sum_{k=1}^{K} P[k]}$$
  For single-frame Hann-windowed Gaussian white noise, bin powers follow an exponential distribution, giving $\mathbb{E}[\text{SFM}] \approx e^{-\gamma} \approx 0.56$. Pure sinusoids yield $\text{SFM} < 0.03$.
- **Frequency Bands:**
  - **Low:** $20\text{ Hz} \le f < 250\text{ Hz}$
  - **Mid:** $250\text{ Hz} \le f < 2000\text{ Hz}$
  - **High:** $2000\text{ Hz} \le f \le f_s/2$

### 2.4 Adaptive Noise Floor
Asymmetric exponential tracker over `rmsDbfs`: tracks downward rapidly ($\alpha = 0.12$) when ambient levels fall and upward slowly ($\alpha = 0.008$, step-clamped at $+6\text{ dB}$) to resist absorbing transient speech/events into the noise floor.

### 2.5 Fingerprint Log-Band Integration (Experiment A)

Each single-sided FFT bin $k \ge 1$ is assigned to **at most one** of the 32 log-spaced bands by its centre frequency $f_k = k f_s / N$. Band power is the sum of that band's assigned bins, so bands are disjoint and the summed band power equals the summed power of the analysed bins. Bands narrower than one bin contain no bins and are reported at the $-120\text{ dBFS}$ floor; no power is counted twice.

A window whose summed band power is $\le 10^{-14}$ has no spectral evidence: its normalised distribution is all zeros, and comparisons report **not comparable** instead of a spuriously high similarity between two silent windows.

---

## 3. Experimental Designs & Limitations

### Experiment A — Environmental Fingerprint
- Summarizes an explicit capture window into 32 log-spaced frequency bands ($20\text{ Hz}$ to Nyquist), 10th-percentile RMS noise floor, and spectral moments.
- Compares Window A vs. Window B in the Web Worker using cosine similarity of normalized band distributions and spectral RMSE (dB).
- Band powers are disjoint (one FFT bin per band). Windows measured at different sample rates or FFT sizes, or with no measurable spectral power, are reported as **non-comparable** rather than scored; frames from a mismatched analysis grid are excluded and counted.
- The **Low/Moderate/High** label is a frame-count heuristic (25 and 60 frames), not a statistical confidence interval.
- **Epistemic Limit:** High similarity does **not** prove two recordings occurred in the same room or on the same device.
- **Sampling interval:** session fingerprints summarize the first 180 sampled frames of a recording (approximately 36 s at the 5 Hz session sampler), so they characterize the beginning of a long session rather than the whole of it.

### Experiment B — Broad Activity Inference
- Evaluates rolling ~3-second windows using explicit, auditable thresholds for Quiet, Sustained Tonal, Broadband Noise, Transient/Impulsive, and Repetitive Events (normalized RMS envelope autocorrelation across $0.7\text{–}12.5\text{ Hz}$ lags).
- **Epistemic Limit:** Broad acoustic morphology cannot establish specific real-world semantics (e.g., typing vs. tapping vs. walking).

### Experiment C — Microphone Metadata Leakage
- Inspects `getSupportedConstraints()`, explicit `enumerateDevices()`, and active track `getSettings()` / `getCapabilities()`.
- Demonstrates how permission unlocks unredacted hardware strings and actual DSP configuration.

### Experiment D — Controlled Signal Transformation
- Measures how real-time Web Audio `GainNode`, `BiquadFilterNode` (high-pass/low-pass), envelope-driven noise gating, and additive broadband noise modify observable side-channel features.

### Experiment E — Privacy Leakage Demonstrator
- Connects real live acoustic and metadata measurements to broad potential inferences, explicit non-conclusions, and defensive mitigations.
- The **Educational Heuristic Index** (`0–100`) is a teaching summary of exposed side-channel dimensions and must **never** be interpreted as a validated probability.

---

## 4. Known Confounding Factors

1. **Uncalibrated dBFS:** Different microphones, preamps, and OS gain sliders shift absolute dBFS arbitrarily.
2. **Browser DSP Pipelines:** OS/browser `echoCancellation`, `noiseSuppression`, and `autoGainControl` distort noise floors, transient crests, and broadband flatness unless disabled and verified via `getSettings()`.
3. **Window Boundary Leakage:** Non-bin-aligned tones leak slightly across adjacent Hann sidelobes (~$-31.5\text{ dB}$ first sidelobe).
4. **Frame-Timing Jitter:** Activity features and envelope periodicity are computed from `requestAnimationFrame` samples. Refresh rate, CPU load and background-tab throttling change the effective sample interval. The cadence estimator uses per-frame timestamps and splits the envelope at gaps larger than ~3× the median inter-frame interval (analysing only the longest continuous segment), but refresh-rate drift and short gaps still limit precision, so reported periods are indicative rather than exact.
