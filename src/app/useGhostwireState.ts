import { useRef, useState } from 'react';
import {
  AcousticAudioEngine,
  DEFAULT_TRANSFORM_CONFIG,
  INITIAL_METADATA_SNAPSHOT,
} from '../audio/audioEngine';
import { DEFAULT_SYNTHETIC_CONFIG } from '../dsp/synthetic';
import type {
  ActivityFrame,
  ActivityInferenceResult,
  AppSettings,
  DeviceMetadataSnapshot,
  DspFrame,
  ExperimentId,
  FeatureFrame,
  InputMode,
  MeasurementSession,
  NavTab,
  SessionProvenance,
  SessionSamplePoint,
  SyntheticSignalConfig,
  TransformConfig,
} from '../types/acoustic';

const DEFAULT_SETTINGS: AppSettings = {
  fftSize: 2048,
  smoothingTimeConstant: 0.3,
  activityThresholdDbfs: -50,
  frequencyScale: 'log',
  persistSessionsLocally: false,
  micConstraints: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

export const NAV_TABS: Array<{ id: NavTab; label: string }> = [
  { id: 'live', label: 'LIVE MONITOR' },
  { id: 'lab', label: 'EXPOSURE LAB' },
  { id: 'synthetic', label: 'SYNTHETIC SIGNALS' },
  { id: 'sessions', label: 'SESSION ANALYSIS' },
  { id: 'notes', label: 'RESEARCH NOTES' },
  { id: 'settings', label: 'SETTINGS' },
];

export function useGhostwireState() {
  const [activeTab, setActiveTab] = useState<NavTab>('live');
  const [activeExperiment, setActiveExperiment] = useState<ExperimentId>('A');
  const [mode, setMode] = useState<InputMode>('idle');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [syntheticConfig, setSyntheticConfig] = useState<SyntheticSignalConfig>(
    DEFAULT_SYNTHETIC_CONFIG
  );
  const [transformConfig, setTransformConfig] = useState<TransformConfig>(
    DEFAULT_TRANSFORM_CONFIG
  );
  const [metadata, setMetadata] = useState<DeviceMetadataSnapshot>(
    INITIAL_METADATA_SNAPSHOT
  );

  const [latestFrame, setLatestFrame] = useState<DspFrame | null>(null);
  const [postFrame, setPostFrame] = useState<DspFrame | null>(null);
  const [activity, setActivity] = useState<ActivityInferenceResult | null>(null);
  // Activity buffer holds scalar-derived projections only — deliberately no PCM.
  const recentFramesRef = useRef<ActivityFrame[]>([]);
  const lastUiCommitMsRef = useRef<number>(0);

  const [recordingState, setRecordingState] = useState<
    'idle' | 'recording' | 'paused'
  >('idle');
  const [activeSessionName, setActiveSessionName] = useState('Session 01');
  const [activeSessionDurationSec, setActiveSessionDurationSec] = useState(0);
  // Publish the count, not the mutable buffer, to drive the live timeline.
  const [activeSampleCount, setActiveSampleCount] = useState(0);
  const [savedSessions, setSavedSessions] = useState<MeasurementSession[]>([]);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  // Keep this separate from pause and save notices so they cannot hide it.
  const [sessionSampleLimitReached, setSessionSampleLimitReached] =
    useState(false);

  const recordingStateRef = useRef(recordingState);
  recordingStateRef.current = recordingState;
  const sessionStartMsRef = useRef<number>(0);
  const sessionElapsedAccumSecRef = useRef<number>(0);
  const lastSessionSampleMsRef = useRef<number>(0);
  const activeSamplesRef = useRef<SessionSamplePoint[]>([]);
  // Fingerprint frames keep derived spectra only: no time-domain PCM.
  const sessionFingerprintFramesRef = useRef<FeatureFrame[]>([]);
  // Provenance of the recording in progress, frozen when recording starts.
  const sessionProvenanceRef = useRef<SessionProvenance | null>(null);
  const finalizeSessionRef = useRef<(notice?: string) => void>(() => {});
  const savedSessionsRef = useRef<MeasurementSession[]>([]);
  savedSessionsRef.current = savedSessions;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const engineRef = useRef<AcousticAudioEngine | null>(null);

  return {
    activeTab,
    setActiveTab,
    activeExperiment,
    setActiveExperiment,
    mode,
    setMode,
    errorBanner,
    setErrorBanner,
    settings,
    setSettings,
    syntheticConfig,
    setSyntheticConfig,
    transformConfig,
    setTransformConfig,
    metadata,
    setMetadata,
    latestFrame,
    setLatestFrame,
    postFrame,
    setPostFrame,
    activity,
    setActivity,
    recentFramesRef,
    lastUiCommitMsRef,
    recordingState,
    setRecordingState,
    sessionNotice,
    setSessionNotice,
    sessionSampleLimitReached,
    setSessionSampleLimitReached,
    activeSessionName,
    setActiveSessionName,
    activeSessionDurationSec,
    setActiveSessionDurationSec,
    activeSampleCount,
    setActiveSampleCount,
    savedSessions,
    setSavedSessions,
    recordingStateRef,
    sessionStartMsRef,
    sessionElapsedAccumSecRef,
    lastSessionSampleMsRef,
    activeSamplesRef,
    sessionFingerprintFramesRef,
    sessionProvenanceRef,
    finalizeSessionRef,
    savedSessionsRef,
    settingsRef,
    engineRef,
  };
}

export type GhostwireState = ReturnType<typeof useGhostwireState>;
