import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcousticAudioEngine } from '../audioEngine';
import type { AppSettings, InputMode } from '../../types/acoustic';

const SETTINGS: AppSettings = {
  fftSize: 2048,
  smoothingTimeConstant: 0,
  activityThresholdDbfs: -50,
  frequencyScale: 'log',
  persistSessionsLocally: false,
  micConstraints: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStream(stop: () => void): MediaStream {
  const track = {
    stop,
    getSettings: () => ({ sampleRate: 48000, channelCount: 1 }),
    getCapabilities: () => ({ sampleRate: { min: 44100, max: 48000 } }),
  };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

function makeAudioContext() {
  const analyser = () => ({
    fftSize: 2048,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((out: Float32Array) => out.fill(0)),
  });
  return {
    sampleRate: 48000,
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createAnalyser: vi.fn(analyser),
    createGain: vi.fn(() => ({
      gain: { value: 1, setTargetAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBiquadFilter: vi.fn(() => ({
      type: 'highpass',
      frequency: { setTargetAtTime: vi.fn() },
      Q: { setTargetAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      copyToChannel: vi.fn(),
      getChannelData: vi.fn(() => new Float32Array(length)),
    })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };
}

function makeEngine() {
  const modes: InputMode[] = [];
  const errors: Array<string | null> = [];
  const engine = new AcousticAudioEngine(SETTINGS, {
    onFrame: vi.fn(),
    onModeChange: (mode) => modes.push(mode),
    onMetadataChange: vi.fn(),
    onError: (message) => errors.push(message),
  });
  return { engine, modes, errors };
}

function stubMediaDevices(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => []),
      getSupportedConstraints: () => ({ echoCancellation: true }),
    },
  });
}

describe('Capture lifecycle race safety (audit F2)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      // Constructible mock: the engine calls `new AudioContext()`.
      value: vi.fn(function () {
        return makeAudioContext();
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops a stream that is granted after the user stopped capture', async () => {
    const permission = deferred<MediaStream>();
    stubMediaDevices(vi.fn(() => permission.promise));
    const trackStop = vi.fn();
    const { engine, modes, errors } = makeEngine();

    const pending = engine.enableMicrophone();
    // User cancels while the permission prompt is still open.
    engine.stopCapture();

    permission.resolve(makeStream(trackStop));

    await expect(pending).resolves.toBe(false);
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(engine.getMode()).toBe('idle');
    expect(modes).not.toContain('microphone');
    expect(errors.filter(Boolean)).toHaveLength(0);
  });

  it('ignores a stale permission rejection instead of tearing down a newer capture', async () => {
    const first = deferred<MediaStream>();
    const second = deferred<MediaStream>();
    const getUserMedia = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    stubMediaDevices(getUserMedia);

    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const { engine, errors } = makeEngine();

    const firstRequest = engine.enableMicrophone();
    const secondRequest = engine.enableMicrophone();

    second.resolve(makeStream(secondStop));
    await expect(secondRequest).resolves.toBe(true);
    expect(engine.getMode()).toBe('microphone');

    // The superseded request fails late. It must not stop or relabel the
    // capture that is now active.
    first.reject(Object.assign(new Error('Permission dismissed'), { name: 'NotAllowedError' }));
    await expect(firstRequest).resolves.toBe(false);

    expect(engine.getMode()).toBe('microphone');
    expect(secondStop).not.toHaveBeenCalled();
    expect(firstStop).not.toHaveBeenCalled();
    expect(errors.filter(Boolean)).toHaveLength(0);

    engine.stopCapture();
    expect(secondStop).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect capture when a synthetic start is stopped mid-await', async () => {
    stubMediaDevices(vi.fn());
    // A suspended context forces a real await before the graph is installed.
    const suspendedContext = makeAudioContext();
    suspendedContext.state = 'suspended';
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: vi.fn(function () {
        return suspendedContext;
      }),
    });
    const { engine, modes } = makeEngine();

    const start = engine.startSynthetic({
      type: 'sine',
      frequencyHz: 440,
      secondaryFrequencyHz: 880,
      amplitude: 0.3,
      noiseAmplitude: 0,
      sweepStartHz: 100,
      sweepEndHz: 8000,
      sweepDurationSec: 4,
      impulseRateHz: 4,
      humMainsHz: 60,
      monitorAudio: false,
      monitorGain: 0,
    });

    // stopCapture invalidates the pending operation before it finishes.
    engine.stopCapture();
    await start;

    expect(engine.getMode()).toBe('idle');
    expect(modes).not.toContain('synthetic');
  });
});
