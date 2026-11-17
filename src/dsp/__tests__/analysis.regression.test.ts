import { describe, expect, it } from 'vitest';
import baseline from './fixtures/analysis-baseline.json';
import { evaluatePrivacyLeakage, inferBroadActivity } from '../analysis';
import { analyzeTimeDomainFrame } from '../metrics';
import { DEFAULT_SYNTHETIC_CONFIG, generateSyntheticSamples } from '../synthetic';
import type {
  ActivityInferenceResult,
  DeviceMetadataSnapshot,
  DspFrame,
  SyntheticSignalConfig,
} from '../../types/acoustic';

const sampleRate = 48000;
const fftSize = 2048;

function framesFor(
  config: SyntheticSignalConfig,
  count: number,
  timestampStepMs: number,
  hopSamples = fftSize
): DspFrame[] {
  const frames: DspFrame[] = [];
  for (let i = 0; i < count; i++) {
    const buffer = generateSyntheticSamples(config, sampleRate, fftSize, i * hopSamples);
    const { frame } = analyzeTimeDomainFrame(buffer, {
      sampleRate,
      fftSize,
      timestampMs: i * timestampStepMs,
    });
    frames.push(frame);
  }
  return frames;
}

const quietFrames = Array.from({ length: 20 }, (_, i) =>
  analyzeTimeDomainFrame(new Float32Array(fftSize), {
    sampleRate,
    fftSize,
    timestampMs: i * 50,
  }).frame
);

const tonalFrames = framesFor(
  { ...DEFAULT_SYNTHETIC_CONFIG, type: 'sine', frequencyHz: 880, amplitude: 0.4 },
  25,
  45
);
const whiteFrames = framesFor(
  { ...DEFAULT_SYNTHETIC_CONFIG, type: 'white', amplitude: 0.5 },
  30,
  45
);
const impulseFrames = framesFor(
  { ...DEFAULT_SYNTHETIC_CONFIG, type: 'impulse', frequencyHz: 2400, amplitude: 0.8, impulseRateHz: 4 },
  60,
  42,
  Math.round(sampleRate * 0.042)
);

const emptyMetadata: DeviceMetadataSnapshot = {
  enumerationTriggered: false,
  permissionState: 'prompt',
  supportedConstraints: ['echoCancellation', 'sampleRate'],
  devices: [],
  requestedConstraints: null,
  actualSettings: null,
  capabilities: null,
  errorMessage: null,
};

const exposedMetadata: DeviceMetadataSnapshot = {
  enumerationTriggered: true,
  permissionState: 'granted',
  supportedConstraints: ['echoCancellation', 'sampleRate'],
  devices: [
    { deviceId: 'mic-1', groupId: 'group-1', kind: 'audioinput', label: 'USB Mic', labelRedacted: false },
    { deviceId: '', groupId: '', kind: 'audiooutput', label: '', labelRedacted: true },
  ],
  requestedConstraints: { echoCancellation: false },
  actualSettings: { sampleRate, channelCount: 1, echoCancellation: false },
  capabilities: { sampleRate: { min: 44100, max: 48000 } },
  errorMessage: null,
};

const settingsOnlyMetadata: DeviceMetadataSnapshot = {
  ...emptyMetadata,
  actualSettings: { sampleRate, channelCount: 2 },
};

const scenarios: Array<{
  name: string;
  frames: DspFrame[];
  metadata: DeviceMetadataSnapshot;
  activity: ActivityInferenceResult | null;
}> = [
  { name: 'empty', frames: [], metadata: emptyMetadata, activity: null },
  { name: 'quiet', frames: quietFrames, metadata: emptyMetadata, activity: inferBroadActivity(quietFrames, -50) },
  { name: 'tonal', frames: tonalFrames, metadata: exposedMetadata, activity: inferBroadActivity(tonalFrames, -50) },
  { name: 'white', frames: whiteFrames, metadata: settingsOnlyMetadata, activity: inferBroadActivity(whiteFrames, -50) },
  { name: 'impulse', frames: impulseFrames, metadata: exposedMetadata, activity: inferBroadActivity(impulseFrames, -50) },
];

describe('Analysis refactor regression', () => {
  it('preserves deterministic activity and privacy-leakage outputs', () => {
    const output = {
      activity: {
        empty: inferBroadActivity([], -50),
        quiet: inferBroadActivity(quietFrames, -50),
        tonal: inferBroadActivity(tonalFrames, -50),
        white: inferBroadActivity(whiteFrames, -50),
        impulse: inferBroadActivity(impulseFrames, -50),
      },
      privacy: Object.fromEntries(
        scenarios.map((scenario) => [
          scenario.name,
          evaluatePrivacyLeakage(
            scenario.frames,
            scenario.metadata,
            scenario.activity
          ),
        ])
      ),
    };

    expect(output).toEqual(baseline);
  });
});
