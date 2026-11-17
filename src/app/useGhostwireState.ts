import { useRef, useState } from 'react';
import {
  AcousticAudioEngine,
  DEFAULT_TRANSFORM_CONFIG,
  INITIAL_METADATA_SNAPSHOT,
} from '../audio/audioEngine';
import { DEFAULT_SYNTHETIC_CONFIG } from '../dsp/synthetic';
import type {
  ActivityInferenceResult,
  AppSettings,
  DeviceMetadataSnapshot,
  DspFrame,
  ExperimentId,
  InputMode,
  MeasurementSession,
  NavTab,
  SessionSamplePoint,
  SyntheticSignalConfig,
  TransformConfig,
} from '../types/acoustic';

export const STORAGE_KEY_SESSIONS = 'ghostwire.exe:sessions:v1';

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
  const recentFramesRef = useRef<DspFrame[]>([]);
  const lastUiCommitMsRef = useRef<number>(0);

  const [recordingState, setRecordingState] = useState<
    'idle' | 'recording' | 'paused'
  >('idle');
  const [activeSessionName, setActiveSessionName] = useState('Session 01');
  const [activeSessionDurationSec, setActiveSessionDurationSec] = useState(0);
  const [activeSamples, setActiveSamples] = useState<SessionSamplePoint[]>([]);
  const [savedSessions, setSavedSessions] = useState<MeasurementSession[]>([]);

  const recordingStateRef = useRef(recordingState);
  recordingStateRef.current = recordingState;
  const sessionStartMsRef = useRef<number>(0);
  const sessionElapsedAccumSecRef = useRef<number>(0);
  const lastSessionSampleMsRef = useRef<number>(0);
  const activeSamplesRef = useRef<SessionSamplePoint[]>([]);
  const sessionFingerprintFramesRef = useRef<DspFrame[]>([]);
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
    activeSessionName,
    setActiveSessionName,
    activeSessionDurationSec,
    setActiveSessionDurationSec,
    activeSamples,
    setActiveSamples,
    savedSessions,
    setSavedSessions,
    recordingStateRef,
    sessionStartMsRef,
    sessionElapsedAccumSecRef,
    lastSessionSampleMsRef,
    activeSamplesRef,
    sessionFingerprintFramesRef,
    settingsRef,
    engineRef,
  };
}

export type GhostwireState = ReturnType<typeof useGhostwireState>;
