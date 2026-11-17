import type { ExperimentId, ScientificProtocol } from '../types/acoustic';

export const EXPERIMENT_PROTOCOLS: Record<ExperimentId, ScientificProtocol> = {
  A: {
    title: 'Experiment A — Environmental Acoustic Fingerprint',
    researchQuestion:
      'Can short-window aggregate spectral distributions and noise-floor estimates distinguish or correlate acoustic environments without storing raw audio?',
    hypothesis:
      'Two measurement windows captured in the same steady acoustic environment will exhibit high 32-band cosine similarity (>= 0.88) and small noise-floor delta (< 4 dB), whereas introducing new sources or changing environments shifts both metrics.',
    procedure: [
      'Activate either Synthetic Signals (for reproducible baseline verification) or Microphone input.',
      'Click "Capture Window A" to record numerical spectral frames over an explicit measurement window (3–8 seconds recommended).',
      'Optionally alter the synthetic preset, move the microphone, or change background appliances, then click "Capture Window B".',
      'Execute "Compare Windows" (computed in the DSP Web Worker) and inspect cosine similarity, per-band deltas, and noise-floor shift.',
    ],
    measuredVariables: [
      '32 log-spaced frequency band dBFS & normalized spectral distribution (20 Hz – Nyquist)',
      '10th-percentile RMS noise floor (dBFS)',
      'Mean spectral centroid (Hz), bandwidth (Hz), and Wiener flatness',
      'Cosine similarity [0..1] and spectral RMSE (dB)',
    ],
    limitations: [
      'Similarity is NOT proof of a unique physical location, room, or identity.',
      'Two distinct rooms with similar quiet ambient noise or identical HVAC models can score > 0.90 similarity.',
      'Uncalibrated dBFS varies across microphones, preamps, and browser gain settings.',
    ],
    confoundingFactors: [
      'Browser Automatic Gain Control (AGC) compressing noise-floor differences',
      'Transient speech or door slams during one capture window',
      'Microphone orientation and proximity to reflective surfaces or cooling fans',
    ],
    reproducibilityNotes:
      'To reproduce deterministically without microphone hardware, capture Window A on Synthetic "Broadband Noise", switch to "Electrical Hum", capture Window B, and verify low cosine similarity (< 0.50) and high low-band shift.',
  },
  B: {
    title: 'Experiment B — Broad Activity State Inference',
    researchQuestion:
      'Which broad acoustic states (quiet, sustained tonal, broadband noise, transient impulses, repetitive cadence) can be transparently inferred from short-window DSP features without ASR or ML?',
    hypothesis:
      'Combining Wiener spectral flatness, crest factor, frame-to-frame onset jumps, and RMS envelope autocorrelation separates tonal, broadband, impulsive, and periodic states with inspectable thresholds.',
    procedure: [
      'Observe the rolling 3-second classification panel under Live Monitor or Synthetic Signals.',
      'Test each Synthetic Preset ("Electrical Hum", "Broadband Noise", "Repetitive Transients") and compare the measured numbers against the stated heuristic rules.',
      'If using a live microphone, observe how silence, clapping/tapping, or whistling triggers transient vs tonal detectors.',
    ],
    measuredVariables: [
      'Mean RMS (dBFS) and active-frame fraction',
      'Spectral flatness (Wiener entropy) and dominant frequency coefficient of variation',
      'Crest factor (Peak/RMS in dB) and frame-to-frame RMS onset jumps (dB)',
      'Normalized autocorrelation of the RMS envelope across 0.7–12.5 Hz lags',
    ],
    limitations: [
      'Transparent heuristics cannot identify specific real-world activities (e.g., typing vs. tapping vs. footsteps vs. cooking).',
      'Simultaneous speech and music or overlapping transients can trigger multiple broad states at once.',
    ],
    confoundingFactors: [
      'Browser noise suppression attenuating steady broadband noise before Web Audio receives it',
      'Short measurement windows (< 1.5 s) reducing autocorrelation reliability for slow repetitive events',
    ],
    reproducibilityNotes:
      'Run Synthetic Preset "Repetitive Transients (4 Hz Impulses)" and verify Transient + Repetitive Events activate with detected rate ~4.0 Hz.',
  },
  C: {
    title: 'Experiment C — Microphone Metadata & Capability Leakage',
    researchQuestion:
      'What hardware, driver, and DSP pipeline metadata does the browser MediaDevices API expose before and after explicit microphone permission?',
    hypothesis:
      'Prior to permission, device labels are redacted by the browser; once permission is granted, device labels, group/device IDs, sample rate, channel count, and actual DSP flags become readable and may diverge from requested constraints.',
    procedure: [
      'Before enabling the microphone, click "Inspect Supported Constraints" and "Enumerate Devices" to observe redaction boundaries.',
      'Toggle requested constraints (Echo Cancellation, Noise Suppression, AGC) in Settings or Experiment C.',
      'Enable the microphone and compare Requested Constraints vs Actual MediaStreamTrack Settings and Capabilities.',
    ],
    measuredVariables: [
      'navigator.mediaDevices.getSupportedConstraints()',
      'enumerateDevices() deviceId, groupId, kind, and label redaction status',
      'MediaStreamTrack.getSettings() & getCapabilities(): sampleRate, channelCount, echoCancellation, noiseSuppression, autoGainControl',
    ],
    limitations: [
      'Browser privacy models vary: Safari, Firefox, and Chromium expose different subsets of capabilities and deviceIds.',
      'OS-level audio drivers or virtual routing tools may report default sample rates regardless of requested constraints.',
    ],
    confoundingFactors: [
      'Previously granted persistent site permission in the user browser profile',
      'Bluetooth HFP/A2DP profile switching altering sampleRate and channelCount dynamically',
    ],
    reproducibilityNotes:
      'Test in a fresh private/incognito window first to verify label redaction prior to permission, then grant permission and re-run enumeration.',
  },
  D: {
    title: 'Experiment D — Controlled Signal Transformation',
    researchQuestion:
      'How do gain, high-pass/low-pass filtering, noise gating, and additive noise injection alter measurable acoustic side-channel features?',
    hypothesis:
      'High-pass filtering removes low-frequency electrical hum while preserving mid/high spectral shape; noise gating suppresses quiet-state leakage while distorting temporal dynamics; broadband noise injection masks weak narrowband tones.',
    procedure: [
      'Start Synthetic Preset "Frequency Masking" or "Electrical Hum" (or live microphone).',
      'Enable the Experiment D Signal Transformation pipeline.',
      'Toggle High-Pass (e.g., 200 Hz), Low-Pass, Noise Gate, or Noise Injection and compare the Pre-Transform (green) vs Post-Transform (amber) spectra and metrics table.',
    ],
    measuredVariables: [
      'Pre- vs Post-Transform RMS (dBFS), Spectral Centroid (Hz), Bandwidth (Hz), Flatness, and Low/Mid/High energy ratios',
      'Single-sided FFT dBFS spectrum overlay (original vs processed)',
    ],
    limitations: [
      'Biquad filters have finite roll-off slope (12 dB/octave), so strong tones near cutoff are attenuated rather than eliminated.',
      'Real-time Web Audio gain-based gating introduces brief attack/release smoothing.',
    ],
    confoundingFactors: [
      'Pre-existing browser noiseSuppression/AGC if running on live microphone input',
      'Digital clipping if excessive positive gain (+24 dB) pushes high-amplitude signals past 0 dBFS',
    ],
    reproducibilityNotes:
      'Activate Synthetic Preset "Frequency Masking (150 Hz Masking 240 Hz)", enable Transformation with High-Pass at 200 Hz, and verify the dominant frequency shifts from ~150 Hz to ~240 Hz.',
  },
  E: {
    title: 'Experiment E — Privacy Leakage Demonstrator',
    researchQuestion:
      'How much environmental and hardware context can an application infer solely from aggregate numerical audio features and track metadata without storing intelligible speech?',
    hypothesis:
      'Even with zero raw audio storage or transcription, aggregate noise floors, band ratios, cadence periodicity, and MediaDevices metadata allow broad inferences about occupancy shifts, machinery hum, interaction cadence, and hardware class.',
    procedure: [
      'Run Synthetic Signals or Microphone input while monitoring the Live Exposure Dashboard.',
      'Optionally enumerate devices in Experiment C to observe how hardware metadata amplifies acoustic inferences.',
      'Review the "What Cannot Reasonably Be Concluded" boundary list and evaluate the recommended mitigations.',
    ],
    measuredVariables: [
      'Adaptive noise floor (dBFS), mean RMS, spectral flatness, low/high band ratios',
      'Active state / cadence indicators from Experiment B',
      'Enumerated device label exposure count and track settings',
    ],
    limitations: [
      'The displayed Educational Heuristic Index (0–100) is an instructional summary of exposed feature channels, NOT a validated privacy risk probability.',
    ],
    confoundingFactors: [
      'Background media playback or street traffic outside the user’s room',
      'Virtual audio devices masking physical microphone hardware strings',
    ],
    reproducibilityNotes:
      'Compare the Exposure Dashboard under "Idle", "Synthetic Electrical Hum", and "Synthetic Repetitive Transients" to observe real-time shifts in observable features and inferred side channels.',
  },
};
