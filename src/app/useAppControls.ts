import { useCallback } from 'react';
import type {
  AppSettings,
  FrequencyScale,
  MicConstraintPreferences,
  SyntheticSignalConfig,
  TransformConfig,
} from '../types/acoustic';
import { buildMeasurementSession } from '../utils/exportSession';
import type { AppControls } from './types';
import type { GhostwireState } from './useGhostwireState';
import {
  clearStoredSessions,
  disablePersistence,
  enablePersistence,
} from './useSessionPersistence';

function resetSessionDraft(state: GhostwireState): void {
  state.activeSamplesRef.current = [];
  state.sessionFingerprintFramesRef.current = [];
  state.setActiveSampleCount(0);
  state.setActiveSessionDurationSec(0);
}

function finalizeRecordingSession(
  state: GhostwireState,
  notice?: string
): void {
  const provenance = state.sessionProvenanceRef.current;
  if (state.recordingStateRef.current === 'idle' || !provenance) return;

  const activeSec =
    state.recordingStateRef.current === 'recording'
      ? (Date.now() - state.sessionStartMsRef.current) / 1000
      : 0;
  const totalDur = state.sessionElapsedAccumSecRef.current + activeSec;

  const session = buildMeasurementSession({
    id: `sess-${Date.now().toString(36)}`,
    name: provenance.name,
    startedAtIso: provenance.startedAtIso,
    endedAtIso: new Date().toISOString(),
    durationSec: Math.max(0.1, totalDur),
    sourceMode: provenance.sourceMode,
    sampleRate: provenance.sampleRate,
    fftSize: provenance.fftSize,
    samples: state.activeSamplesRef.current,
    framesForFingerprint: state.sessionFingerprintFramesRef.current,
  });

  state.setSavedSessions((prev) => [session, ...prev]);
  state.setActiveSessionName(
    `Session ${String(state.savedSessionsRef.current.length + 2).padStart(2, '0')}`
  );
  state.setRecordingState('idle');
  state.sessionProvenanceRef.current = null;
  resetSessionDraft(state);
  if (notice) state.setSessionNotice(notice);
}

function useSettingsControls(state: GhostwireState) {
  const updateSettings = useCallback(
    (next: AppSettings) => {
      const wasPersisting = state.settingsRef.current.persistSessionsLocally;
      state.setSettings(next);
      state.engineRef.current?.updateSettings(next);

      if (next.persistSessionsLocally && !wasPersisting) {
        // Opt-in: write the consent marker, then restore stored sessions.
        enablePersistence(state);
      } else if (!next.persistSessionsLocally && wasPersisting) {
        // Intentional opt-out is the only non-explicit-clear path that
        // deletes stored data.
        disablePersistence(state);
      }
    },
    [state]
  );

  const setFrequencyScale = useCallback(
    (scale: FrequencyScale) => {
      updateSettings({ ...state.settingsRef.current, frequencyScale: scale });
    },
    [state, updateSettings]
  );

  const updateMicConstraints = useCallback(
    (next: MicConstraintPreferences) => {
      updateSettings({ ...state.settingsRef.current, micConstraints: next });
    },
    [state, updateSettings]
  );

  const dismissError = useCallback(() => {
    state.setErrorBanner(null);
  }, [state]);

  const enableMicrophone = useCallback(() => {
    void state.engineRef.current?.enableMicrophone(
      state.settingsRef.current.micConstraints
    );
  }, [state]);

  const stopCapture = useCallback(() => {
    state.engineRef.current?.stopCapture();
  }, [state]);

  const inspectSupportedOnly = useCallback(() => {
    void state.engineRef.current?.inspectMetadata(false);
  }, [state]);

  const enumerateDevices = useCallback(() => {
    void state.engineRef.current?.inspectMetadata(true);
  }, [state]);

  const changeTransform = useCallback(
    (next: TransformConfig) => {
      state.setTransformConfig(next);
      state.engineRef.current?.updateTransformConfig(next);
    },
    [state]
  );

  return {
    updateSettings,
    setFrequencyScale,
    updateMicConstraints,
    dismissError,
    enableMicrophone,
    stopCapture,
    inspectSupportedOnly,
    enumerateDevices,
    changeTransform,
  };
}

function useSyntheticControls(state: GhostwireState) {
  const startSynthetic = useCallback(
    (cfg?: SyntheticSignalConfig) => {
      const target = cfg ?? state.syntheticConfig;
      void state.engineRef.current?.startSynthetic(target);
    },
    [state]
  );

  const startSyntheticDefault = useCallback(() => {
    startSynthetic();
  }, [startSynthetic]);

  const changeSyntheticConfig = useCallback(
    (next: SyntheticSignalConfig, restartIfRunning = false) => {
      const onlyMonitorChanged =
        next.monitorAudio !== state.syntheticConfig.monitorAudio ||
        next.monitorGain !== state.syntheticConfig.monitorGain;

      state.setSyntheticConfig(next);

      if (onlyMonitorChanged && state.mode === 'synthetic') {
        state.engineRef.current?.updateSyntheticMonitor(
          next.monitorAudio,
          next.monitorGain
        );
      } else if (restartIfRunning) {
        void state.engineRef.current?.startSynthetic(next);
      }
    },
    [state]
  );

  return { startSynthetic, startSyntheticDefault, changeSyntheticConfig };
}

function useSessionRecorder(state: GhostwireState) {
  const startSession = useCallback(() => {
    if (state.mode === 'idle') return;
    resetSessionDraft(state);
    state.sessionElapsedAccumSecRef.current = 0;
    state.sessionStartMsRef.current = Date.now();
    state.lastSessionSampleMsRef.current = 0;
    // Freeze provenance now; later source or FFT changes cannot relabel this run.
    state.sessionProvenanceRef.current = {
      name:
        state.activeSessionName.trim() ||
        `Session ${state.savedSessionsRef.current.length + 1}`,
      startedAtIso: new Date().toISOString(),
      sourceMode: state.mode,
      sampleRate: state.latestFrame?.sampleRate ?? null,
      fftSize: state.settingsRef.current.fftSize,
    };
    state.setSessionNotice(null);
    state.setSessionSampleLimitReached(false);
    state.setRecordingState('recording');
  }, [state]);

  const finalizeActiveSession = useCallback(
    (notice?: string) => {
      finalizeRecordingSession(state, notice);
    },
    [state]
  );

  // Let the audio-engine mode-change handler auto-finalise a recording when
  // the capture source changes, using the same finalisation path.
  state.finalizeSessionRef.current = finalizeActiveSession;

  const pauseToggle = useCallback(() => {
    if (state.recordingState === 'recording') {
      state.sessionElapsedAccumSecRef.current +=
        (Date.now() - state.sessionStartMsRef.current) / 1000;
      state.sessionStartMsRef.current = Date.now();
      state.setRecordingState('paused');
    } else if (state.recordingState === 'paused') {
      const provenance = state.sessionProvenanceRef.current;
      if (
        state.mode === 'idle' ||
        !provenance ||
        provenance.sourceMode !== state.mode
      ) {
        finalizeActiveSession(
          'Session finalised: resuming requires the same input source it was started with.'
        );
        return;
      }
      state.sessionStartMsRef.current = Date.now();
      state.setRecordingState('recording');
    }
  }, [state, finalizeActiveSession]);

  const stopSession = useCallback(() => {
    finalizeActiveSession();
  }, [finalizeActiveSession]);

  const clearAllSessionData = useCallback(() => {
    state.setRecordingState('idle');
    state.sessionProvenanceRef.current = null;
    resetSessionDraft(state);
    state.recentFramesRef.current = [];
    state.setSessionNotice(null);
    state.setSessionSampleLimitReached(false);
    state.setSavedSessions([]);
    clearStoredSessions(state);
  }, [state]);

  return { startSession, pauseToggle, stopSession, clearAllSessionData };
}

export function useAppControls(state: GhostwireState): AppControls {
  const settingsControls = useSettingsControls(state);
  const syntheticControls = useSyntheticControls(state);
  const sessionControls = useSessionRecorder(state);

  return {
    ...settingsControls,
    ...syntheticControls,
    ...sessionControls,
  };
}
