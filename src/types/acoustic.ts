export type InputMode = 'idle' | 'microphone' | 'synthetic';

export type NavTab =
  | 'live'
  | 'lab'
  | 'synthetic'
  | 'sessions'
  | 'notes'
  | 'settings';

export type ExperimentId = 'A' | 'B' | 'C' | 'D' | 'E';

export type FftSize = 1024 | 2048 | 4096 | 8192;

export type FrequencyScale = 'log' | 'linear';

export interface BandEnergy {
  lowRatio: number; // 20 - 250 Hz fraction [0..1]
  midRatio: number; // 250 - 2000 Hz fraction [0..1]
  highRatio: number; // 2000 Hz - Nyquist fraction [0..1]
  lowDbfs: number;
  midDbfs: number;
  highDbfs: number;
}

export interface DspFrame {
  timestampMs: number;
  sampleRate: number;
  fftSize: number;
  binWidthHz: number;
  rms: number;
  peak: number;
  rmsDbfs: number;
  peakDbfs: number;
  crestFactorDb: number;
  dominantFrequencyHz: number;
  spectralCentroidHz: number;
  spectralBandwidthHz: number;
  spectralFlatness: number; // [0..1]
  zeroCrossingRate: number; // [0..1] crossings per sample
  zcrFrequencyHz: number;
  bandEnergy: BandEnergy;
  noiseFloorDbfs: number;
  snrDb: number;
  isActive: boolean;
  /** Time-domain samples for waveform visualization */
  waveform: Float32Array;
  /** Single-sided magnitude spectrum in dBFS [0..N/2] */
  spectrumDbfs: Float32Array;
  /** Single-sided linear power spectrum [0..N/2] */
  powerSpectrum: Float32Array;
}

/**
 * Frame projection that keeps only derived scalar features. It deliberately
 * carries no time-domain PCM and no spectral arrays, so long-lived rolling
 * buffers cannot retain raw waveform samples.
 */
export type ActivityFrame = Omit<
  DspFrame,
  'waveform' | 'spectrumDbfs' | 'powerSpectrum'
>;

/**
 * Frame projection used for fingerprinting: derived spectra are retained,
 * time-domain PCM is not.
 */
export type FeatureFrame = Omit<DspFrame, 'waveform'>;

export interface ActivityClassification {
  id:
    | 'quiet'
    | 'sustained_tonal'
    | 'broadband_noise'
    | 'transient_impulse'
    | 'repetitive_events';
  label: string;
  detected: boolean;
  confidence: 'low' | 'moderate' | 'high';
  measuredEvidence: string;
  thresholdRule: string;
  reasoning: string;
}

export interface ActivityInferenceResult {
  windowDurationSec: number;
  frameCount: number;
  dominantState: string;
  classifications: ActivityClassification[];
  detectedPeriodHz: number | null;
  periodicityStrength: number;
  transientCount: number;
}

export interface EnvironmentalFingerprint {
  id: string;
  label: string;
  capturedAtIso: string;
  durationSec: number;
  frameCount: number;
  sampleRate: number;
  fftSize: number;
  sourceMode: InputMode;
  meanRmsDbfs: number;
  rmsStdDevDb: number;
  noiseFloorDbfs: number; // 10th percentile RMS dBFS
  peakDbfsMax: number;
  meanCentroidHz: number;
  meanBandwidthHz: number;
  meanFlatness: number;
  meanZcr: number;
  meanBandEnergy: {
    lowRatio: number;
    midRatio: number;
    highRatio: number;
  };
  /** 32 log-spaced frequency bands from 20 Hz to Nyquist, mean dBFS */
  logBandCentersHz: number[];
  logBandDbfs: number[];
  /**
   * Normalized spectral energy distribution across the 32 log bands (sum = 1
   * when measurable spectral power exists, all zeros for a silent window).
   */
  logBandDistribution: number[];
  /** Frames dropped because they used a different sample rate or FFT size. */
  excludedFrameCount: number;
}

export interface FingerprintComparison {
  cosineSimilarity: number; // [0..1] on normalized log-band distribution
  spectralDistanceDb: number; // RMSE across 32 log bands in dB
  noiseFloorDeltaDb: number; // B - A
  centroidDeltaHz: number; // B - A
  flatnessDelta: number; // B - A
  bandDeltas: {
    lowDeltaPct: number;
    midDeltaPct: number;
    highDeltaPct: number;
  };
  perBandDeltaDb: number[]; // B - A per log band
  /** False when the windows used different grids or had no spectral evidence. */
  comparable: boolean;
  incompatibilityReasons: string[];
  /** Frame-count heuristic, not a statistical confidence interval. */
  confidenceLabel: 'Low' | 'Moderate' | 'High';
  interpretation: string;
  limitations: string[];
}

export type SyntheticSignalType =
  | 'sine'
  | 'white'
  | 'pink'
  | 'sweep'
  | 'impulse'
  | 'mixed'
  | 'hum';

export interface SyntheticSignalConfig {
  type: SyntheticSignalType;
  frequencyHz: number;
  secondaryFrequencyHz: number;
  amplitude: number; // 0.01 .. 0.95
  noiseAmplitude: number; // 0 .. 0.5 (for mixed/hum)
  sweepStartHz: number;
  sweepEndHz: number;
  sweepDurationSec: number;
  impulseRateHz: number;
  humMainsHz: 50 | 60;
  monitorAudio: boolean;
  monitorGain: number; // 0 .. 0.3 safety cap
}

export interface TransformConfig {
  enabled: boolean;
  gainDb: number; // -24 .. +24
  highPassEnabled: boolean;
  highPassHz: number; // 20 .. 2000
  lowPassEnabled: boolean;
  lowPassHz: number; // 500 .. 16000
  noiseGateEnabled: boolean;
  noiseGateThresholdDbfs: number; // -80 .. -10
  noiseInjectionEnabled: boolean;
  noiseInjectionDbfs: number; // -60 .. -6
}

export interface MicConstraintPreferences {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface AppSettings {
  fftSize: FftSize;
  smoothingTimeConstant: number; // 0 .. 0.85
  activityThresholdDbfs: number; // -80 .. -15
  frequencyScale: FrequencyScale;
  persistSessionsLocally: boolean; // default false
  micConstraints: MicConstraintPreferences;
}

export interface DeviceMetadataSnapshot {
  enumerationTriggered: boolean;
  permissionState: 'prompt' | 'granted' | 'denied' | 'unknown';
  supportedConstraints: string[];
  devices: Array<{
    deviceId: string;
    groupId: string;
    kind: string;
    label: string;
    labelRedacted: boolean;
  }>;
  requestedConstraints: MediaTrackConstraints | null;
  actualSettings: MediaTrackSettings | null;
  capabilities: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface SessionSamplePoint {
  elapsedSec: number;
  timestampIso: string;
  rmsDbfs: number;
  peakDbfs: number;
  noiseFloorDbfs: number;
  dominantFrequencyHz: number;
  spectralCentroidHz: number;
  spectralBandwidthHz: number;
  spectralFlatness: number;
  zeroCrossingRate: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  isActive: boolean;
}

export interface MeasurementSession {
  id: string;
  name: string;
  startedAtIso: string;
  endedAtIso: string | null;
  durationSec: number;
  /** Input source captured when the session started, not the source at save time. */
  sourceMode: InputMode;
  /** Sample rate observed when the session started; null if none was known. */
  sampleRate: number | null;
  /** FFT size configured when the session started. */
  fftSize: number;
  samples: SessionSamplePoint[];
  summary: {
    sampleCount: number;
    meanRmsDbfs: number;
    minRmsDbfs: number;
    maxRmsDbfs: number;
    noiseFloorDbfs: number;
    meanCentroidHz: number;
    meanBandwidthHz: number;
    meanFlatness: number;
    meanZcr: number;
    activityDutyCyclePct: number;
    meanBandEnergy: {
      lowRatio: number;
      midRatio: number;
      highRatio: number;
    };
  };
  fingerprint: EnvironmentalFingerprint | null;
}

export interface ScientificProtocol {
  title: string;
  researchQuestion: string;
  hypothesis: string;
  procedure: string[];
  measuredVariables: string[];
  limitations: string[];
  confoundingFactors: string[];
  reproducibilityNotes: string;
}
