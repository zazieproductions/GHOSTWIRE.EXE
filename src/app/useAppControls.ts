import { useCallback } from 'react';
import type {
  AppSettings,
  FrequencyScale,
  MeasurementSession,
  MicConstraintPreferences,
  SyntheticSignalConfig,
  TransformConfig,
} from '../types/acoustic';
import { buildMeasurementSession } from '../utils/exportSession';
import type { AppControls } from './types';
import type { GhostwireState } from './useGhostwireState';
import {
  clearStoredSessions,
  restoreSavedSessions,
} from './useSessionPersistence';

function createSessionFromRecording(
  state: GhostwireState
): MeasurementSession {
  const totalDurationSec =
    state.recordingState === 'recording'
      ? state.sessionElapsedAccumSecRef.current +
        (Date.now() - state.sessionStartMsRef.current) / 1000
      : state.sessionElapsedAccumSecRef.current;

  return buildMeasurementSession({
    id: `sess-${Date.now().toString(36)}`,
    name:
      state.activeSessionName.trim() ||
      `Session ${state.savedSessions.length + 1}`,
    startedAtIso:
      state.activeSamplesRef.current[0]?.timestampIso ??
      new Date().toISOString(),
    endedAtIso: new Date().toISOString(),
    durationSec: Math.max(0.1, totalDurationSec),
    sourceMode: state.mode,
    sampleRate: state.latestFrame?.sampleRate ?? 48000,
    fftSize: state.settings.fftSize,
    samples: state.activeSamplesRef.current,
    framesForFingerprint: state.sessionFingerprintFramesRef.current,
  });
}

function resetSessionDraft(state: GhostwireState): void {
  state.activeSamplesRef.current = [];
  state.sessionFingerprintFramesRef.current = [];
  state.setActiveSamples([]);
  state.setActiveSessionDurationSec(0);
}

function useSettingsControls(state: GhostwireState) {
  const updateSettings = useCallback(
    (next: AppSettings) => {
      state.setSettings(next);
      state.engineRef.current?.updateSettings(next);
      if (
        next.persistSessionsLocally &&
        !state.settingsRef.current.persistSessionsLocally
      ) {
        restoreSavedSessions(state);
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
    state.activeSamplesRef.current = [];
    state.sessionFingerprintFramesRef.current = [];
    state.sessionElapsedAccumSecRef.current = 0;
    state.sessionStartMsRef.current = Date.now();
    state.lastSessionSampleMsRef.current = 0;
    state.setActiveSamples([]);
    state.setActiveSessionDurationSec(0);
    state.setRecordingState('recording');
  }, [state]);

  const pauseToggle = useCallback(() => {
    if (state.recordingState === 'recording') {
      state.sessionElapsedAccumSecRef.current +=
        (Date.now() - state.sessionStartMsRef.current) / 1000;
      state.setRecordingState('paused');
    } else if (state.recordingState === 'paused') {
      state.sessionStartMsRef.current = Date.now();
      state.setRecordingState('recording');
    }
  }, [state]);

  const stopSession = useCallback(() => {
    if (state.recordingState === 'idle') return;
    const session = createSessionFromRecording(state);
    state.setSavedSessions((prev) => [session, ...prev]);
    state.setActiveSessionName(
      `Session ${String(state.savedSessions.length + 2).padStart(2, '0')}`
    );
    state.setRecordingState('idle');
    resetSessionDraft(state);
  }, [state]);

  const clearAllSessionData = useCallback(() => {
    state.setRecordingState('idle');
    resetSessionDraft(state);
    state.setSavedSessions([]);
    clearStoredSessions();
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
