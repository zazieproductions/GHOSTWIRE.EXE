import {
  AdaptiveNoiseFloorTracker,
  analyzeTimeDomainFrame,
} from '../dsp/metrics';
import { generateSyntheticSamples } from '../dsp/synthetic';
import type {
  AppSettings,
  DeviceMetadataSnapshot,
  DspFrame,
  InputMode,
  MicConstraintPreferences,
  SyntheticSignalConfig,
  TransformConfig,
} from '../types/acoustic';

export const DEFAULT_TRANSFORM_CONFIG: TransformConfig = {
  enabled: false,
  gainDb: 0,
  highPassEnabled: false,
  highPassHz: 180,
  lowPassEnabled: false,
  lowPassHz: 4000,
  noiseGateEnabled: false,
  noiseGateThresholdDbfs: -45,
  noiseInjectionEnabled: false,
  noiseInjectionDbfs: -30,
};

export const INITIAL_METADATA_SNAPSHOT: DeviceMetadataSnapshot = {
  enumerationTriggered: false,
  permissionState: 'prompt',
  supportedConstraints: [],
  devices: [],
  requestedConstraints: null,
  actualSettings: null,
  capabilities: null,
  errorMessage: null,
};

export interface AudioEngineCallbacks {
  onFrame: (preFrame: DspFrame, postFrame: DspFrame | null) => void;
  onModeChange: (mode: InputMode) => void;
  onMetadataChange: (snapshot: DeviceMetadataSnapshot) => void;
  onError: (message: string | null) => void;
}


function hasMediaDevicesSupport(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);
}

function getSupportedConstraintNames(): string[] {
  return typeof navigator.mediaDevices.getSupportedConstraints === 'function'
    ? Object.keys(navigator.mediaDevices.getSupportedConstraints())
    : [];
}

function withDeviceFallback(value: string, fallback: string): string {
  return value || fallback;
}

function isRelevantAudioDevice(device: MediaDeviceInfo): boolean {
  return device.kind === 'audioinput' || device.kind === 'audiooutput';
}

function normalizeEnumeratedDevice(
  device: MediaDeviceInfo
): DeviceMetadataSnapshot['devices'][number] {
  return {
    deviceId: withDeviceFallback(device.deviceId, '(redacted/empty)'),
    groupId: withDeviceFallback(device.groupId, '(redacted/empty)'),
    kind: device.kind,
    label: withDeviceFallback(
      device.label,
      '(redacted prior to microphone permission)'
    ),
    labelRedacted: !device.label,
  };
}

function mapEnumeratedDevices(
  rawDevices: MediaDeviceInfo[]
): DeviceMetadataSnapshot['devices'] {
  return rawDevices.filter(isRelevantAudioDevice).map(normalizeEnumeratedDevice);
}

function activeAudioTrack(stream: MediaStream | null): MediaStreamTrack | null {
  if (!stream) return null;
  return stream.getAudioTracks()[0] ?? null;
}

function resolveTrackSettings(
  track: MediaStreamTrack | null,
  previous: MediaTrackSettings | null
): MediaTrackSettings | null {
  return track ? track.getSettings() : previous;
}

function resolveTrackCapabilities(
  track: MediaStreamTrack | null,
  previous: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (track && typeof track.getCapabilities === 'function') {
    return track.getCapabilities() as Record<string, unknown>;
  }
  return previous;
}

export class AcousticAudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private syntheticSource: AudioBufferSourceNode | null = null;
  private monitorGainNode: GainNode | null = null;

  // Processing & dual-analyser chain (Experiment D)
  private preAnalyser: AnalyserNode | null = null;
  private postAnalyser: AnalyserNode | null = null;
  private transformGain: GainNode | null = null;
  private highPassFilter: BiquadFilterNode | null = null;
  private lowPassFilter: BiquadFilterNode | null = null;
  private gateGain: GainNode | null = null;
  private noiseInjectSource: AudioBufferSourceNode | null = null;
  private noiseInjectGain: GainNode | null = null;

  private rafId: number | null = null;
  private mode: InputMode = 'idle';
  private settings: AppSettings;
  private transformConfig: TransformConfig = { ...DEFAULT_TRANSFORM_CONFIG };
  private syntheticConfig: SyntheticSignalConfig | null = null;

  private preTracker = new AdaptiveNoiseFloorTracker();
  private postTracker = new AdaptiveNoiseFloorTracker();
  private prevPreMag: Float32Array | null = null;
  private prevPostMag: Float32Array | null = null;
  private preBuf: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private postBuf: Float32Array<ArrayBuffer> = new Float32Array(2048);

  private metadata: DeviceMetadataSnapshot = { ...INITIAL_METADATA_SNAPSHOT };
  private callbacks: AudioEngineCallbacks;

  constructor(settings: AppSettings, callbacks: AudioEngineCallbacks) {
    this.settings = settings;
    this.callbacks = callbacks;
  }

  getMode(): InputMode {
    return this.mode;
  }

  getMetadata(): DeviceMetadataSnapshot {
    return this.metadata;
  }

  updateSettings(next: AppSettings): void {
    const fftChanged = next.fftSize !== this.settings.fftSize;
    this.settings = next;
    if (fftChanged) {
      this.preBuf = new Float32Array(next.fftSize);
      this.postBuf = new Float32Array(next.fftSize);
      this.prevPreMag = null;
      this.prevPostMag = null;
      if (this.preAnalyser) this.preAnalyser.fftSize = next.fftSize;
      if (this.postAnalyser) this.postAnalyser.fftSize = next.fftSize;
    }
  }

  updateTransformConfig(next: TransformConfig): void {
    this.transformConfig = { ...next };
    this.applyTransformNodes();
  }

  private ensureAudioContext(): AudioContext {
    if (typeof window === 'undefined') {
      throw new Error('Web Audio API is unavailable outside a browser context.');
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API (AudioContext) is not supported in this browser.');
    }
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  private buildAnalysisGraph(ctx: AudioContext): void {
    this.disconnectAnalysisGraph();

    this.preAnalyser = ctx.createAnalyser();
    this.preAnalyser.fftSize = this.settings.fftSize;
    this.preAnalyser.smoothingTimeConstant = 0;

    this.postAnalyser = ctx.createAnalyser();
    this.postAnalyser.fftSize = this.settings.fftSize;
    this.postAnalyser.smoothingTimeConstant = 0;

    this.transformGain = ctx.createGain();
    this.highPassFilter = ctx.createBiquadFilter();
    this.highPassFilter.type = 'highpass';

    this.lowPassFilter = ctx.createBiquadFilter();
    this.lowPassFilter.type = 'lowpass';

    this.gateGain = ctx.createGain();
    this.gateGain.gain.value = 1;

    // Noise injection source for Experiment D (local buffer, never leaves browser)
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = Math.random() * 2 - 1;
    }
    this.noiseInjectSource = ctx.createBufferSource();
    this.noiseInjectSource.buffer = noiseBuf;
    this.noiseInjectSource.loop = true;

    this.noiseInjectGain = ctx.createGain();
    this.noiseInjectGain.gain.value = 0;

    // Graph: preAnalyser -> transformGain -> highPass -> lowPass -> gateGain -> postAnalyser
    //                                                      noiseInjectSource -> noiseInjectGain -> postAnalyser
    this.preAnalyser.connect(this.transformGain);
    this.transformGain.connect(this.highPassFilter);
    this.highPassFilter.connect(this.lowPassFilter);
    this.lowPassFilter.connect(this.gateGain);
    this.gateGain.connect(this.postAnalyser);

    this.noiseInjectSource.connect(this.noiseInjectGain);
    this.noiseInjectGain.connect(this.postAnalyser);
    this.noiseInjectSource.start();

    this.preBuf = new Float32Array(this.settings.fftSize);
    this.postBuf = new Float32Array(this.settings.fftSize);
    this.applyTransformNodes();
  }

  private applyTransformNodes(): void {
    if (
      !this.ctx ||
      !this.transformGain ||
      !this.highPassFilter ||
      !this.lowPassFilter ||
      !this.noiseInjectGain
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const cfg = this.transformConfig;

    if (!cfg.enabled) {
      this.transformGain.gain.setTargetAtTime(1, now, 0.015);
      this.highPassFilter.frequency.setTargetAtTime(10, now, 0.015);
      this.highPassFilter.Q.setTargetAtTime(0.707, now, 0.015);
      this.lowPassFilter.frequency.setTargetAtTime(
        Math.min(22000, this.ctx.sampleRate * 0.48),
        now,
        0.015
      );
      this.lowPassFilter.Q.setTargetAtTime(0.707, now, 0.015);
      this.noiseInjectGain.gain.setTargetAtTime(0, now, 0.015);
      this.gateGain?.gain.setTargetAtTime(1, now, 0.015);
      return;
    }

    const linearGain = Math.pow(10, cfg.gainDb / 20);
    this.transformGain.gain.setTargetAtTime(linearGain, now, 0.015);

    this.highPassFilter.frequency.setTargetAtTime(
      cfg.highPassEnabled ? cfg.highPassHz : 10,
      now,
      0.015
    );

    const maxSafeLowPass = Math.min(20000, this.ctx.sampleRate * 0.48);
    this.lowPassFilter.frequency.setTargetAtTime(
      cfg.lowPassEnabled ? Math.min(cfg.lowPassHz, maxSafeLowPass) : maxSafeLowPass,
      now,
      0.015
    );

    const noiseLinear = cfg.noiseInjectionEnabled
      ? Math.pow(10, cfg.noiseInjectionDbfs / 20)
      : 0;
    this.noiseInjectGain.gain.setTargetAtTime(noiseLinear, now, 0.015);
  }

  private disconnectAnalysisGraph(): void {
    try {
      this.noiseInjectSource?.stop();
    } catch {
      // Ignore already stopped
    }
    this.noiseInjectSource?.disconnect();
    this.noiseInjectGain?.disconnect();
    this.preAnalyser?.disconnect();
    this.transformGain?.disconnect();
    this.highPassFilter?.disconnect();
    this.lowPassFilter?.disconnect();
    this.gateGain?.disconnect();
    this.postAnalyser?.disconnect();

    this.noiseInjectSource = null;
    this.noiseInjectGain = null;
    this.preAnalyser = null;
    this.transformGain = null;
    this.highPassFilter = null;
    this.lowPassFilter = null;
    this.gateGain = null;
    this.postAnalyser = null;
  }

  async enableMicrophone(
    constraintsOverride?: MicConstraintPreferences
  ): Promise<boolean> {
    this.stopCapture();
    this.callbacks.onError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      const msg =
        'Microphone capture requires a secure context (HTTPS or localhost) and navigator.mediaDevices.getUserMedia support.';
      this.metadata = {
        ...this.metadata,
        permissionState: 'denied',
        errorMessage: msg,
      };
      this.callbacks.onMetadataChange(this.metadata);
      this.callbacks.onError(msg);
      return false;
    }

    const prefs = constraintsOverride ?? this.settings.micConstraints;
    const requestedConstraints: MediaTrackConstraints = {
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGainControl,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: requestedConstraints,
        video: false,
      });

      this.stream = stream;
      const ctx = this.ensureAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      this.buildAnalysisGraph(ctx);
      this.micSource = ctx.createMediaStreamSource(stream);
      // IMPORTANT: Never connect micSource to ctx.destination to avoid feedback/monitoring.
      this.micSource.connect(this.preAnalyser!);

      const track = stream.getAudioTracks()[0] ?? null;
      const actualSettings = track ? track.getSettings() : null;
      const capabilities =
        track && typeof track.getCapabilities === 'function'
          ? (track.getCapabilities() as Record<string, unknown>)
          : null;

      const supported =
        typeof navigator.mediaDevices.getSupportedConstraints === 'function'
          ? Object.keys(navigator.mediaDevices.getSupportedConstraints())
          : [];

      this.metadata = {
        ...this.metadata,
        permissionState: 'granted',
        supportedConstraints: supported,
        requestedConstraints,
        actualSettings,
        capabilities,
        errorMessage: null,
      };
      this.callbacks.onMetadataChange(this.metadata);

      this.preTracker.reset();
      this.postTracker.reset();
      this.prevPreMag = null;
      this.prevPostMag = null;
      this.mode = 'microphone';
      this.callbacks.onModeChange('microphone');
      this.startLoop();
      return true;
    } catch (err) {
      const domErr = err as DOMException | Error;
      let msg = domErr?.message || 'Failed to access microphone.';
      if (domErr?.name === 'NotAllowedError' || domErr?.name === 'PermissionDeniedError') {
        msg =
          'Microphone permission denied by user or browser policy. Switch to SYNTHETIC SIGNALS to run all DSP experiments locally without microphone access.';
      } else if (domErr?.name === 'NotFoundError') {
        msg = 'No audio input hardware detected by the browser.';
      } else if (domErr?.name === 'NotReadableError') {
        msg = 'Microphone hardware is busy or blocked at the OS privacy level.';
      }

      this.stopCapture();
      this.metadata = {
        ...this.metadata,
        permissionState: 'denied',
        requestedConstraints,
        actualSettings: null,
        capabilities: null,
        errorMessage: msg,
      };
      this.callbacks.onMetadataChange(this.metadata);
      this.callbacks.onError(msg);
      return false;
    }
  }

  async inspectMetadata(triggerEnumeration: boolean): Promise<DeviceMetadataSnapshot> {
    if (!hasMediaDevicesSupport()) {
      this.metadata = {
        ...this.metadata,
        errorMessage: 'navigator.mediaDevices is unavailable in this environment.',
      };
      this.callbacks.onMetadataChange(this.metadata);
      return this.metadata;
    }

    const supported = getSupportedConstraintNames();
    let devices = this.metadata.devices;
    let enumerationTriggered = this.metadata.enumerationTriggered;

    if (
      triggerEnumeration &&
      typeof navigator.mediaDevices.enumerateDevices === 'function'
    ) {
      const rawDevices = await navigator.mediaDevices.enumerateDevices();
      enumerationTriggered = true;
      devices = mapEnumeratedDevices(rawDevices);
    }

    const track = activeAudioTrack(this.stream);
    this.metadata = {
      ...this.metadata,
      enumerationTriggered,
      supportedConstraints: supported,
      devices,
      actualSettings: resolveTrackSettings(track, this.metadata.actualSettings),
      capabilities: resolveTrackCapabilities(track, this.metadata.capabilities),
    };
    this.callbacks.onMetadataChange(this.metadata);
    return this.metadata;
  }

  async startSynthetic(config: SyntheticSignalConfig): Promise<void> {
    // If transitioning from mic, shut mic down first
    if (this.mode === 'microphone') {
      this.stopCapture();
    } else {
      this.stopSyntheticNodesOnly();
    }

    this.callbacks.onError(null);
    this.syntheticConfig = { ...config };

    const ctx = this.ensureAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (!this.preAnalyser) {
      this.buildAnalysisGraph(ctx);
    }

    // Generate clean loopable local buffer (align sweep duration or 4 seconds)
    const bufferDurationSec =
      config.type === 'sweep'
        ? Math.max(1, config.sweepDurationSec)
        : 4;
    const sampleCount = Math.floor(ctx.sampleRate * bufferDurationSec);
    const samples = generateSyntheticSamples(config, ctx.sampleRate, sampleCount, 0, 1337);

    const audioBuffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    audioBuffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = true;

    const monitorGain = ctx.createGain();
    monitorGain.gain.value = config.monitorAudio
      ? Math.min(0.3, Math.max(0, config.monitorGain))
      : 0;

    source.connect(this.preAnalyser!);
    source.connect(monitorGain);
    monitorGain.connect(ctx.destination);
    source.start();

    this.syntheticSource = source;
    this.monitorGainNode = monitorGain;

    this.preTracker.reset();
    this.postTracker.reset();
    this.prevPreMag = null;
    this.prevPostMag = null;
    this.mode = 'synthetic';
    this.callbacks.onModeChange('synthetic');
    this.startLoop();
  }

  updateSyntheticMonitor(monitorAudio: boolean, monitorGain: number): void {
    if (this.ctx && this.monitorGainNode) {
      const target = monitorAudio ? Math.min(0.3, Math.max(0, monitorGain)) : 0;
      this.monitorGainNode.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
    if (this.syntheticConfig) {
      this.syntheticConfig = {
        ...this.syntheticConfig,
        monitorAudio,
        monitorGain,
      };
    }
  }

  private stopSyntheticNodesOnly(): void {
    try {
      this.syntheticSource?.stop();
    } catch {
      // ignore
    }
    this.syntheticSource?.disconnect();
    this.monitorGainNode?.disconnect();
    this.syntheticSource = null;
    this.monitorGainNode = null;
  }

  stopCapture(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.stream = null;
    }

    this.micSource?.disconnect();
    this.micSource = null;

    this.stopSyntheticNodesOnly();
    this.disconnectAnalysisGraph();

    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => undefined);
    }
    this.ctx = null;

    this.prevPreMag = null;
    this.prevPostMag = null;

    if (this.mode !== 'idle') {
      this.mode = 'idle';
      this.callbacks.onModeChange('idle');
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }

    const tick = () => {
      if (this.mode === 'idle' || !this.ctx || !this.preAnalyser) {
        this.rafId = null;
        return;
      }

      const sampleRate = this.ctx.sampleRate;
      const fftSize = this.settings.fftSize;
      if (this.preBuf.length !== fftSize) {
        this.preBuf = new Float32Array(fftSize);
        this.postBuf = new Float32Array(fftSize);
      }

      this.preAnalyser.getFloatTimeDomainData(this.preBuf);
      const nowMs = Date.now();

      const preRes = analyzeTimeDomainFrame(this.preBuf, {
        sampleRate,
        fftSize,
        timestampMs: nowMs,
        activityThresholdDbfs: this.settings.activityThresholdDbfs,
        noiseFloorTracker: this.preTracker,
        previousMagnitude: this.prevPreMag,
        smoothingTimeConstant: this.settings.smoothingTimeConstant,
      });
      this.prevPreMag = preRes.smoothedMagnitude;

      // Apply real-time noise gate envelope when Experiment D transform is enabled
      if (
        this.transformConfig.enabled &&
        this.transformConfig.noiseGateEnabled &&
        this.gateGain
      ) {
        const open =
          preRes.frame.rmsDbfs >= this.transformConfig.noiseGateThresholdDbfs;
        this.gateGain.gain.setTargetAtTime(
          open ? 1 : 0.0001,
          this.ctx.currentTime,
          open ? 0.008 : 0.035
        );
      }

      let postFrame: DspFrame | null = null;
      if (this.transformConfig.enabled && this.postAnalyser) {
        this.postAnalyser.getFloatTimeDomainData(this.postBuf);
        const postRes = analyzeTimeDomainFrame(this.postBuf, {
          sampleRate,
          fftSize,
          timestampMs: nowMs,
          activityThresholdDbfs: this.settings.activityThresholdDbfs,
          noiseFloorTracker: this.postTracker,
          previousMagnitude: this.prevPostMag,
          smoothingTimeConstant: this.settings.smoothingTimeConstant,
        });
        this.prevPostMag = postRes.smoothedMagnitude;
        postFrame = postRes.frame;
      }

      this.callbacks.onFrame(preRes.frame, postFrame);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }
}
