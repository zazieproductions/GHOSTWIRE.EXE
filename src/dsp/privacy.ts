import type {
  ActivityFrame,
  ActivityInferenceResult,
  DeviceMetadataSnapshot,
} from '../types/acoustic';

export interface PrivacyLeakageAssessment {
  educationalHeuristicScore: number; // 0..100 explicitly labeled non-validated heuristic
  heuristicTier: 'Minimal' | 'Low' | 'Moderate' | 'Elevated';
  observableFeatures: Array<{ name: string; value: string; source: string }>;
  potentialInferences: Array<{
    inference: string;
    confidence: 'Low' | 'Moderate' | 'High';
    basis: string;
  }>;
  cannotBeConcluded: string[];
  mitigations: string[];
}

type PrivacyInference = PrivacyLeakageAssessment['potentialInferences'][number];

interface FrameFeatureSummary {
  hasFrames: boolean;
  latest: ActivityFrame | null;
  meanRmsDb: number;
  meanFlatness: number;
  meanLowRatio: number;
  meanHighRatio: number;
}

interface InferenceAccumulator {
  points: number;
  inferences: PrivacyInference[];
}

const CANNOT_BE_CONCLUDED = [
  'Spoken words, semantic conversation content, or transcripts (no ASR/recording is performed).',
  'Unique speaker identity, age, gender, or biometric verification.',
  'Exact physical location, street address, or room identity from spectral profiles alone.',
  'Specific real-world actions (e.g., typing vs. tapping vs. kitchen noises) without ground-truth calibration.',
];

const MITIGATIONS = [
  'Revoke site microphone permissions when not actively needed; treat OS hardware mute LEDs as authoritative.',
  'Use physical microphone disconnect/mute switches rather than relying solely on software mute.',
  'Apply high-pass filtering (e.g., 150–250 Hz) or noise gating in privacy-preserving virtual audio routes to strip low-frequency mains/machinery side channels.',
  'Avoid granting persistent microphone access across origins, as permission unlocks device label enumeration for hardware fingerprinting.',
];

function meanFrameFeature(
  frames: ActivityFrame[],
  select: (frame: ActivityFrame) => number,
  fallback: number
): number {
  if (frames.length === 0) return fallback;
  return frames.reduce((sum, frame) => sum + select(frame), 0) / frames.length;
}

function summarizeFrameFeatures(frames: ActivityFrame[]): FrameFeatureSummary {
  const hasFrames = frames.length > 0;
  return {
    hasFrames,
    latest: hasFrames ? frames[frames.length - 1] : null,
    meanRmsDb: meanFrameFeature(frames, (frame) => frame.rmsDbfs, -120),
    meanFlatness: meanFrameFeature(frames, (frame) => frame.spectralFlatness, 0),
    meanLowRatio: meanFrameFeature(
      frames,
      (frame) => frame.bandEnergy.lowRatio,
      0
    ),
    meanHighRatio: meanFrameFeature(
      frames,
      (frame) => frame.bandEnergy.highRatio,
      0
    ),
  };
}

function countExposedLabels(metadata: DeviceMetadataSnapshot): number {
  return metadata.devices.filter((d) => !d.labelRedacted).length;
}

function formatObserved(
  hasFrames: boolean,
  observed: string,
  fallback: string
): string {
  return hasFrames ? observed : fallback;
}

function formatDeviceSurface(metadata: DeviceMetadataSnapshot): string {
  if (metadata.devices.length === 0) return 'Not enumerated / suppressed';
  return `${metadata.devices.length} device(s), ${countExposedLabels(metadata)} labeled`;
}

function buildObservableFeatures(
  summary: FrameFeatureSummary,
  metadata: DeviceMetadataSnapshot
): PrivacyLeakageAssessment['observableFeatures'] {
  return [
    {
      name: 'Estimated Noise Floor',
      value: summary.latest
        ? `${summary.latest.noiseFloorDbfs.toFixed(1)} dBFS`
        : 'No active stream',
      source: 'Adaptive 10th-percentile tracker',
    },
    {
      name: 'Mean Signal Level',
      value: formatObserved(
        summary.hasFrames,
        `${summary.meanRmsDb.toFixed(1)} dBFS`,
        'No active stream'
      ),
      source: 'Time-domain RMS',
    },
    {
      name: 'Spectral Flatness (Mean)',
      value: formatObserved(
        summary.hasFrames,
        summary.meanFlatness.toFixed(3),
        '—'
      ),
      source: 'Wiener entropy across FFT bins',
    },
    {
      name: 'Low / High Band Balance',
      value: formatObserved(
        summary.hasFrames,
        `${(summary.meanLowRatio * 100).toFixed(0)}% Low / ${(summary.meanHighRatio * 100).toFixed(0)}% High`,
        '—'
      ),
      source: '20–250 Hz vs >=2000 Hz power',
    },
    {
      name: 'Browser Device Surface',
      value: formatDeviceSurface(metadata),
      source: 'navigator.mediaDevices',
    },
  ];
}

function addInference(
  accumulator: InferenceAccumulator,
  points: number,
  inference: PrivacyInference
): void {
  accumulator.points += points;
  accumulator.inferences.push(inference);
}

function addSignalStateInference(
  accumulator: InferenceAccumulator,
  latest: ActivityFrame
): void {
  if (latest.isActive) {
    addInference(accumulator, 20, {
      inference: 'Presence of active acoustic energy above baseline noise floor',
      confidence: latest.snrDb > 10 ? 'High' : 'Moderate',
      basis: `Measured SNR +${latest.snrDb.toFixed(1)} dB over ${latest.noiseFloorDbfs.toFixed(1)} dBFS floor.`,
    });
  } else {
    addInference(accumulator, 8, {
      inference: 'Baseline ambient floor characterization (quiet state)',
      confidence: 'Moderate',
      basis: `Steady baseline near ${latest.noiseFloorDbfs.toFixed(1)} dBFS enables occupancy-change detection if monitored over time.`,
    });
  }
}

function addLowFrequencyInference(
  accumulator: InferenceAccumulator,
  summary: FrameFeatureSummary
): void {
  if (summary.meanLowRatio > 0.55 && summary.meanFlatness < 0.25) {
    addInference(accumulator, 18, {
      inference: 'Low-frequency tonal/harmonic coupling (e.g., mains hum, motor, or HVAC rumble)',
      confidence: 'Moderate',
      basis: `${(summary.meanLowRatio * 100).toFixed(0)}% energy below 250 Hz with low spectral flatness (${summary.meanFlatness.toFixed(3)}).`,
    });
  }
}

function addCadenceInference(
  accumulator: InferenceAccumulator,
  activity: ActivityInferenceResult | null
): void {
  const repetitive = activity?.classifications.some(
    (c) => c.id === 'repetitive_events' && c.detected
  );
  const transient = activity?.classifications.some(
    (c) => c.id === 'transient_impulse' && c.detected
  );

  if (repetitive) {
    addInference(accumulator, 22, {
      inference: `Cadence / event-rate leakage (~${activity?.detectedPeriodHz?.toFixed(2) ?? '?'} Hz repetitive pattern)`,
      confidence: 'Moderate',
      basis: `Envelope autocorrelation r=${activity?.periodicityStrength.toFixed(2)} reveals rhythmic acoustic timing without recording speech.`,
    });
  } else if (transient) {
    addInference(accumulator, 15, {
      inference: 'Intermittent impulsive activity timing (bursts of physical interaction)',
      confidence: 'Moderate',
      basis: `${activity?.transientCount} impulsive frame(s) detected in rolling window.`,
    });
  }
}

function addBroadbandInference(
  accumulator: InferenceAccumulator,
  summary: FrameFeatureSummary
): void {
  if (summary.meanFlatness >= 0.35) {
    addInference(accumulator, 10, {
      inference: 'Broadband airflow / diffuse noise floor profile',
      confidence: 'Low',
      basis: `Elevated spectral flatness (${summary.meanFlatness.toFixed(3)}) suggests broadband environmental noise.`,
    });
  }
}

function collectAcousticInferences(
  accumulator: InferenceAccumulator,
  summary: FrameFeatureSummary,
  activity: ActivityInferenceResult | null
): void {
  const latest = summary.latest;
  if (!latest) return;
  addSignalStateInference(accumulator, latest);
  addLowFrequencyInference(accumulator, summary);
  addCadenceInference(accumulator, activity);
  addBroadbandInference(accumulator, summary);
}

function addDeviceInference(
  accumulator: InferenceAccumulator,
  metadata: DeviceMetadataSnapshot
): void {
  const exposedLabels = countExposedLabels(metadata);
  if (exposedLabels > 0 || metadata.actualSettings) {
    addInference(accumulator, exposedLabels > 0 ? 22 : 10, {
      inference: 'Hardware class, audio-routing, or peripheral configuration fingerprinting',
      confidence: exposedLabels > 0 ? 'High' : 'Moderate',
      basis: exposedLabels > 0
        ? `${exposedLabels} device label(s) + track settings (e.g. ${metadata.actualSettings?.sampleRate ?? '?'} Hz) exposed by MediaDevices API.`
        : 'Track settings expose sample rate and DSP flags.',
    });
  }
}

function addIdleInference(accumulator: InferenceAccumulator): void {
  if (accumulator.inferences.length === 0) {
    addInference(accumulator, 0, {
      inference: 'No active audio stream or enumerated device metadata observed yet',
      confidence: 'High',
      basis: 'Enable Synthetic Signals or Microphone to observe live side-channel feature leakage.',
    });
  }
}

function buildPotentialInferences(
  summary: FrameFeatureSummary,
  metadata: DeviceMetadataSnapshot,
  activity: ActivityInferenceResult | null
): InferenceAccumulator {
  const accumulator: InferenceAccumulator = { points: 0, inferences: [] };
  collectAcousticInferences(accumulator, summary, activity);
  addDeviceInference(accumulator, metadata);
  addIdleInference(accumulator);
  return accumulator;
}

function tierForScore(score: number): PrivacyLeakageAssessment['heuristicTier'] {
  const tiers: Array<{
    min: number;
    tier: PrivacyLeakageAssessment['heuristicTier'];
  }> = [
    { min: 65, tier: 'Elevated' },
    { min: 40, tier: 'Moderate' },
    { min: 15, tier: 'Low' },
    { min: 0, tier: 'Minimal' },
  ];
  return tiers.find(({ min }) => score >= min)?.tier ?? 'Minimal';
}

export function evaluatePrivacyLeakage(
  frames: ActivityFrame[],
  metadata: DeviceMetadataSnapshot,
  activity: ActivityInferenceResult | null
): PrivacyLeakageAssessment {
  const summary = summarizeFrameFeatures(frames);
  const observableFeatures = buildObservableFeatures(summary, metadata);
  const { points, inferences } = buildPotentialInferences(
    summary,
    metadata,
    activity
  );
  const educationalHeuristicScore = Math.min(100, Math.max(0, points));

  return {
    educationalHeuristicScore,
    heuristicTier: tierForScore(educationalHeuristicScore),
    observableFeatures,
    potentialInferences: inferences,
    cannotBeConcluded: [...CANNOT_BE_CONCLUDED],
    mitigations: [...MITIGATIONS],
  };
}
