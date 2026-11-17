import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AcousticAudioEngine,
  DEFAULT_TRANSFORM_CONFIG,
  INITIAL_METADATA_SNAPSHOT,
} from './audio/audioEngine';
import { ExposureLabView } from './components/views/ExposureLabView';
import { LiveMonitorView } from './components/views/LiveMonitorView';
import { ResearchNotesView } from './components/views/ResearchNotesView';
import { SessionAnalysisView } from './components/views/SessionAnalysisView';
import { SettingsView } from './components/views/SettingsView';
import { SyntheticSignalsView } from './components/views/SyntheticSignalsView';
import { inferBroadActivity } from './dsp/analysis';
import { toActivityFrame, toFeatureFrame } from './dsp/metrics';
import { DEFAULT_SYNTHETIC_CONFIG } from './dsp/synthetic';
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
  SessionSamplePoint,
  SyntheticSignalConfig,
  TransformConfig,
} from './types/acoustic';
import {
  buildMeasurementSession,
  frameToSessionSample,
} from './utils/exportSession';
import {
  clearPersistedSessions,
  grantPersistenceConsent,
  hasPersistenceConsent,
  loadPersistedSessions,
  revokePersistenceConsent,
  savePersistedSessions,
} from './utils/sessionStorage';
import { dspWorkerClient } from './workers/dspWorkerClient';

/** Session metadata frozen when recording starts, so later source or setting changes cannot relabel it. */
interface SessionProvenance {
  name: string;
  startedAtIso: string;
  sourceMode: InputMode;
  sampleRate: number | null;
  fftSize: number;
}

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

const NAV_TABS: Array<{ id: NavTab; label: string }> = [
  { id: 'live', label: 'LIVE MONITOR' },
  { id: 'lab', label: 'EXPOSURE LAB' },
  { id: 'synthetic', label: 'SYNTHETIC SIGNALS' },
  { id: 'sessions', label: 'SESSION ANALYSIS' },
  { id: 'notes', label: 'RESEARCH NOTES' },
  { id: 'settings', label: 'SETTINGS' },
];

export default function App() {
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
  // Activity buffer holds scalar features only — deliberately no PCM samples.
  // F8: bound retained frame buffers so a long-running or stalled session
  // cannot grow without limit. 90 frames ≈ 3.5s at typical 25 fps UI commit;
  // the constant makes the bound explicit.
  const MAX_RECENT_FRAMES = 90;
  const recentFramesRef = useRef<ActivityFrame[]>([]);
  const lastUiCommitMsRef = useRef<number>(0);

  // Session recording state (ephemeral RAM by default)
  const [recordingState, setRecordingState] = useState<
    'idle' | 'recording' | 'paused'
  >('idle');
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [micRequestPending, setMicRequestPending] = useState(false);
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
  // Fingerprint frames keep derived spectra only: no time-domain PCM.
  const sessionFingerprintFramesRef = useRef<FeatureFrame[]>([]);
  const sessionProvenanceRef = useRef<SessionProvenance | null>(null);
  const finalizeSessionRef = useRef<(notice?: string) => void>(() => {});
  const savedSessionsRef = useRef<MeasurementSession[]>([]);
  savedSessionsRef.current = savedSessions;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const engineRef = useRef<AcousticAudioEngine | null>(null);

  // Initialize engine once and dispose strictly on unmount
  useEffect(() => {
    const engine = new AcousticAudioEngine(settingsRef.current, {
      onFrame: (pre, post) => {
        const now = performance.now();

        // Keep rolling ~3.5s feature buffer for Experiment B & E.
        // ActivityFrame carries scalar features only — no PCM. MAX_RECENT_FRAMES
        // is the explicit bound (F8); retained frames carry no waveform (F1).
        const buf = recentFramesRef.current;
        buf.push(toActivityFrame(pre));
        if (buf.length > MAX_RECENT_FRAMES) {
          buf.shift();
        }

        // Log numerical session sample at ~5 Hz when recording (never raw audio)
        if (recordingStateRef.current === 'recording') {
          const wallNow = Date.now();
          if (wallNow - lastSessionSampleMsRef.current >= 200) {
            lastSessionSampleMsRef.current = wallNow;
            const elapsed =
              sessionElapsedAccumSecRef.current +
              (wallNow - sessionStartMsRef.current) / 1000;
            const pt = frameToSessionSample(pre, elapsed);
            // F8: cap session samples at ~1 hour at 5 Hz (18000 samples).
            // Beyond this, append is skipped rather than growing unbounded.
            // In-place push avoids the per-sample full-array copy.
            if (activeSamplesRef.current.length < 18000) {
              activeSamplesRef.current.push(pt);
            }
            // F1: fingerprint frames keep derived spectra only, never PCM.
            if (sessionFingerprintFramesRef.current.length < 180) {
              sessionFingerprintFramesRef.current.push(toFeatureFrame(pre));
            }
            setActiveSessionDurationSec(elapsed);
            setActiveSamples(activeSamplesRef.current);
          }
        }

        // Throttle UI state updates to ~20 fps for low CPU on laptops
        if (now - lastUiCommitMsRef.current >= 48) {
          lastUiCommitMsRef.current = now;
          setLatestFrame(pre);
          setPostFrame(post);
          setActivity(
            inferBroadActivity(buf, settingsRef.current.activityThresholdDbfs)
          );
        }
      },
      onModeChange: (nextMode) => {
        setMode(nextMode);
        if (nextMode === 'idle') {
          setLatestFrame(null);
          setPostFrame(null);
          setActivity(null);
          recentFramesRef.current = [];
          if (recordingStateRef.current === 'recording') {
            // Freeze elapsed time rather than billing quiet wall-clock time to
            // the measurement, and keep the samples for an explicit save.
            sessionElapsedAccumSecRef.current +=
              (Date.now() - sessionStartMsRef.current) / 1000;
            sessionStartMsRef.current = Date.now();
            setRecordingState('paused');
            setSessionNotice(
              'Session auto-paused: the input source stopped. Restart the same source to resume, or STOP & SAVE to finalise it.'
            );
          }
        } else if (
          recordingStateRef.current !== 'idle' &&
          sessionProvenanceRef.current &&
          nextMode !== sessionProvenanceRef.current.sourceMode
        ) {
          // A recording belongs to the source it started with. Switching source
          // finalises it instead of silently mixing provenance.
          finalizeSessionRef.current(
            'Session auto-finalised: the input source changed, so it was saved with its original provenance before the new source started.'
          );
        }
      },
      onMetadataChange: (snap) => {
        setMetadata(snap);
      },
      onError: (msg) => {
        setErrorBanner(msg);
      },
    });

    engineRef.current = engine;

    const handleBeforeUnload = () => {
      engine.stopCapture();
      dspWorkerClient.dispose();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      engine.stopCapture();
      dspWorkerClient.dispose();
      engineRef.current = null;
      // Release every retained buffer on unmount.
      recentFramesRef.current = [];
      sessionFingerprintFramesRef.current = [];
      activeSamplesRef.current = [];
      sessionProvenanceRef.current = null;
    };
  }, []);

  // Restore a previous explicit opt-in on mount. A stored consent marker — not
  // the default settings value — decides whether saved sessions are restored,
  // so a reload can never delete data the user chose to keep.
  useEffect(() => {
    if (!hasPersistenceConsent()) return;
    const { sessions, error } = loadPersistedSessions();
    if (error) {
      // Never auto-enable writes over data that could not be read: that would
      // replace a future-version or corrupt payload with an empty list.
      setErrorBanner(error);
      return;
    }
    setSettings((prev) => ({ ...prev, persistSessionsLocally: true }));
    if (sessions.length > 0) {
      setSavedSessions((prev) => (prev.length === 0 ? sessions : prev));
    }
  }, []);

  // Write only while persistence is explicitly enabled. Deleting stored data is
  // reserved for an intentional opt-out or "Clear All Session Data".
  useEffect(() => {
    if (!settings.persistSessionsLocally) return;
    const result = savePersistedSessions(savedSessions);
    if (!result.ok) setErrorBanner(result.error);
  }, [settings.persistSessionsLocally, savedSessions]);

  const handleUpdateSettings = useCallback((next: AppSettings) => {
    const wasPersisting = settingsRef.current.persistSessionsLocally;
    setSettings(next);
    engineRef.current?.updateSettings(next);

    if (next.persistSessionsLocally && !wasPersisting) {
      const consent = grantPersistenceConsent();
      if (!consent.ok) setErrorBanner(consent.error);
      const { sessions, error } = loadPersistedSessions();
      if (error) {
        setErrorBanner(error);
      } else if (sessions.length > 0) {
        setSavedSessions((prev) => (prev.length === 0 ? sessions : prev));
      }
    } else if (!next.persistSessionsLocally && wasPersisting) {
      // Intentional opt-out is the only non-explicit-clear path that deletes data.
      revokePersistenceConsent();
      const cleared = clearPersistedSessions();
      if (!cleared.ok) setErrorBanner(cleared.error);
    }
  }, []);

  const handleEnableMicrophone = useCallback(async () => {
    setMicRequestPending(true);
    try {
      await engineRef.current?.enableMicrophone(
        settingsRef.current.micConstraints
      );
    } finally {
      setMicRequestPending(false);
    }
  }, []);

  const handleStopCapture = useCallback(() => {
    engineRef.current?.stopCapture();
  }, []);

  const handleStartSynthetic = useCallback(
    (cfg?: SyntheticSignalConfig) => {
      const target = cfg ?? syntheticConfig;
      void engineRef.current?.startSynthetic(target);
    },
    [syntheticConfig]
  );

  const handleChangeSyntheticConfig = useCallback(
    (next: SyntheticSignalConfig, restartIfRunning = false) => {
      const onlyMonitorChanged =
        next.monitorAudio !== syntheticConfig.monitorAudio ||
        next.monitorGain !== syntheticConfig.monitorGain;

      setSyntheticConfig(next);

      if (onlyMonitorChanged && mode === 'synthetic') {
        engineRef.current?.updateSyntheticMonitor(
          next.monitorAudio,
          next.monitorGain
        );
      } else if (restartIfRunning) {
        void engineRef.current?.startSynthetic(next);
      }
    },
    [mode, syntheticConfig.monitorAudio, syntheticConfig.monitorGain]
  );

  const handleChangeTransform = useCallback((next: TransformConfig) => {
    setTransformConfig(next);
    engineRef.current?.updateTransformConfig(next);
  }, []);

  const handleStartSession = useCallback(() => {
    if (mode === 'idle') return;
    activeSamplesRef.current = [];
    sessionFingerprintFramesRef.current = [];
    sessionElapsedAccumSecRef.current = 0;
    sessionStartMsRef.current = Date.now();
    lastSessionSampleMsRef.current = 0;
    // Freeze provenance now; later source or FFT changes cannot relabel this run.
    sessionProvenanceRef.current = {
      name: activeSessionName.trim() || `Session ${savedSessionsRef.current.length + 1}`,
      startedAtIso: new Date().toISOString(),
      sourceMode: mode,
      sampleRate: latestFrame?.sampleRate ?? null,
      fftSize: settingsRef.current.fftSize,
    };
    setActiveSamples([]);
    setActiveSessionDurationSec(0);
    setSessionNotice(null);
    setRecordingState('recording');
  }, [activeSessionName, latestFrame?.sampleRate, mode]);

  const finalizeActiveSession = useCallback((notice?: string) => {
    const provenance = sessionProvenanceRef.current;
    if (recordingStateRef.current === 'idle' || !provenance) return;

    const activeSec =
      recordingStateRef.current === 'recording'
        ? (Date.now() - sessionStartMsRef.current) / 1000
        : 0;
    const totalDur = sessionElapsedAccumSecRef.current + activeSec;

    const session = buildMeasurementSession({
      id: `sess-${Date.now().toString(36)}`,
      name: provenance.name,
      startedAtIso: provenance.startedAtIso,
      endedAtIso: new Date().toISOString(),
      durationSec: Math.max(0.1, totalDur),
      sourceMode: provenance.sourceMode,
      sampleRate: provenance.sampleRate,
      fftSize: provenance.fftSize,
      samples: activeSamplesRef.current,
      framesForFingerprint: sessionFingerprintFramesRef.current,
    });

    setSavedSessions((prev) => [session, ...prev]);
    setActiveSessionName(
      `Session ${String(savedSessionsRef.current.length + 2).padStart(2, '0')}`
    );
    setRecordingState('idle');
    sessionProvenanceRef.current = null;
    activeSamplesRef.current = [];
    sessionFingerprintFramesRef.current = [];
    setActiveSamples([]);
    setActiveSessionDurationSec(0);
    if (notice) setSessionNotice(notice);
  }, []);

  finalizeSessionRef.current = finalizeActiveSession;

  const handlePauseToggle = useCallback(() => {
    if (recordingState === 'recording') {
      sessionElapsedAccumSecRef.current +=
        (Date.now() - sessionStartMsRef.current) / 1000;
      sessionStartMsRef.current = Date.now();
      setRecordingState('paused');
    } else if (recordingState === 'paused') {
      const provenance = sessionProvenanceRef.current;
      if (mode === 'idle' || !provenance || provenance.sourceMode !== mode) {
        finalizeActiveSession(
          'Session finalised: resuming requires the same input source it was started with.'
        );
        return;
      }
      sessionStartMsRef.current = Date.now();
      setRecordingState('recording');
    }
  }, [finalizeActiveSession, mode, recordingState]);

  const handleStopSession = useCallback(() => {
    finalizeActiveSession();
  }, [finalizeActiveSession]);

  const handleClearAllSessionData = useCallback(() => {
    setRecordingState('idle');
    sessionProvenanceRef.current = null;
    activeSamplesRef.current = [];
    sessionFingerprintFramesRef.current = [];
    recentFramesRef.current = [];
    setActiveSamples([]);
    setActiveSessionDurationSec(0);
    setSessionNotice(null);
    setSavedSessions([]);
    revokePersistenceConsent();
    const cleared = clearPersistedSessions();
    if (!cleared.ok) setErrorBanner(cleared.error);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#07090b] text-[#c9d6cd]">
      {/* Top Instrument Status Bar */}
      <header className="border-b border-[#1b2821] bg-[#0a0f12] px-4 py-2.5">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-7 bg-[#22c55e] rounded-xs" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-widest text-[#86efac] phosphor-glow">
                  GHOSTWIRE.EXE
                </h1>
                <span className="text-[10px] px-1.5 py-0.5 border border-[#1f3428] bg-[#0d1912] text-[#6ee7b7] rounded-xs">
                  CLIENT-SIDE DSP LAB
                </span>
              </div>
              <p className="text-[11px] text-[#7a9384]">
                Your microphone reveals more than your words.
              </p>
            </div>
          </div>

          {/* Authoritative Capture Indicator + Instant Kill Switch */}
          <div className="flex flex-wrap items-center gap-2.5">
            {mode === 'microphone' && (
              <div
                role="status"
                className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#2a0c0c] border border-[#ef4444] text-[#fecaca] text-xs font-bold tracking-wider"
              >
                <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" />
                MIC ACTIVE
              </div>
            )}
            {mode === 'synthetic' && (
              <div
                role="status"
                className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#0b2316] border border-[#22c55e] text-[#86efac] text-xs font-bold tracking-wider"
              >
                <span className="w-2 h-2 rounded-full bg-[#4ade80]" />
                SYNTHETIC SIGNAL ACTIVE
              </div>
            )}
            {mode === 'idle' && (
              <div
                role="status"
                className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#0e1418] border border-[#24322a] text-[#7a9384] text-xs font-semibold tracking-wider"
              >
                <span className="w-2 h-2 rounded-full bg-[#4b5e52]" />
                IDLE // NO CAPTURE
              </div>
            )}

            {mode === 'microphone' ? (
              <button
                type="button"
                onClick={handleStopCapture}
                className="px-3 py-1.5 text-xs font-bold rounded-sm bg-[#991b1b] hover:bg-[#b91c1c] text-white border border-[#f87171] cursor-pointer"
              >
                STOP MICROPHONE
              </button>
            ) : (
              <button
                type="button"
                onClick={handleEnableMicrophone}
                disabled={micRequestPending}
                aria-busy={micRequestPending}
                className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#14532d] hover:bg-[#166534] disabled:opacity-60 text-[#bbf7d0] border border-[#22c55e]/60 cursor-pointer disabled:cursor-wait"
              >
                {micRequestPending ? 'REQUESTING MIC…' : 'ENABLE MICROPHONE'}
              </button>
            )}

            {mode === 'synthetic' && (
              <button
                type="button"
                onClick={handleStopCapture}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-sm bg-[#78350f] hover:bg-[#92400e] text-[#fde68a] border border-[#f59e0b]/60 cursor-pointer"
              >
                STOP SYNTHETIC
              </button>
            )}
          </div>
        </div>

        {/* Navigation Bar */}
        <nav
          aria-label="Primary research navigation"
          className="max-w-[1440px] mx-auto mt-2.5 pt-2 border-t border-[#15201a] flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex flex-wrap gap-1.5">
            {NAV_TABS.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-[11px] font-bold tracking-wider rounded-xs border transition-colors cursor-pointer ${
                    active
                      ? 'border-[#22c55e] bg-[#11271a] text-[#86efac]'
                      : 'border-[#18241d] bg-[#0b1013] text-[#7a9384] hover:text-[#c8d6cc] hover:border-[#293d31]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="text-[10px] text-[#5e7a68]">
            Browser &amp; OS mic indicators remain authoritative | Zero telemetry / Zero uploads
          </div>
        </nav>
      </header>

      {/* Error / Permission Notice Banner */}
      {errorBanner && (
        <div
          role="alert"
          className="max-w-[1440px] w-full mx-auto mt-3 px-4"
        >
          <div className="border border-[#ef4444]/60 bg-[#210c0c] text-[#fecaca] px-3 py-2 rounded-sm text-xs flex items-center justify-between gap-3">
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="px-2 py-0.5 border border-[#ef4444]/50 rounded-xs text-[11px] hover:bg-[#3b1515] cursor-pointer"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* Main Research Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4">
        {activeTab === 'live' && (
          <LiveMonitorView
            mode={mode}
            frame={latestFrame}
            postFrame={transformConfig.enabled ? postFrame : null}
            activity={activity}
            frequencyScale={settings.frequencyScale}
            onFrequencyScaleChange={(scale) =>
              handleUpdateSettings({ ...settings, frequencyScale: scale })
            }
            onEnableMicrophone={handleEnableMicrophone}
            onStopCapture={handleStopCapture}
            onStartSyntheticDefault={() => {
              handleStartSynthetic();
            }}
          />
        )}

        {activeTab === 'lab' && (
          <ExposureLabView
            activeExperiment={activeExperiment}
            onSelectExperiment={setActiveExperiment}
            mode={mode}
            latestFrame={latestFrame}
            postFrame={postFrame}
            recentFrames={recentFramesRef.current}
            activity={activity}
            metadata={metadata}
            micConstraints={settings.micConstraints}
            transformConfig={transformConfig}
            frequencyScale={settings.frequencyScale}
            onUpdateMicConstraints={(next) =>
              handleUpdateSettings({ ...settings, micConstraints: next })
            }
            onInspectSupportedOnly={() => {
              void engineRef.current?.inspectMetadata(false);
            }}
            onEnumerateDevices={() => {
              void engineRef.current?.inspectMetadata(true);
            }}
            onEnableMicrophone={handleEnableMicrophone}
            onStopCapture={handleStopCapture}
            onChangeTransform={handleChangeTransform}
          />
        )}

        {activeTab === 'synthetic' && (
          <SyntheticSignalsView
            mode={mode}
            config={syntheticConfig}
            frame={latestFrame}
            frequencyScale={settings.frequencyScale}
            onChangeConfig={handleChangeSyntheticConfig}
            onStartSynthetic={handleStartSynthetic}
            onStopCapture={handleStopCapture}
          />
        )}

        {activeTab === 'sessions' && (
          <SessionAnalysisView
            mode={mode}
            recordingState={recordingState}
            activeSessionName={activeSessionName}
            activeSessionDurationSec={activeSessionDurationSec}
            activeSamples={activeSamples}
            savedSessions={savedSessions}
            persistLocally={settings.persistSessionsLocally}
            sessionNotice={sessionNotice}
            onChangeSessionName={setActiveSessionName}
            onStartSession={handleStartSession}
            onPauseToggle={handlePauseToggle}
            onStopSession={handleStopSession}
            onClearAllSessions={handleClearAllSessionData}
          />
        )}

        {activeTab === 'notes' && <ResearchNotesView />}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onClearAllSessionData={handleClearAllSessionData}
          />
        )}
      </main>

      <footer className="border-t border-[#15201a] bg-[#090d10] px-4 py-2 text-[10px] text-[#5e7a68]">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>
            GHOSTWIRE.EXE // Defensive Acoustic Side-Channel Research Instrument (MIT License)
          </span>
          <span>
            100% Client-Side Processing • No Audio Recording • No Network Transmission • dBFS ≠ dB SPL
          </span>
        </div>
      </footer>
    </div>
  );
}
