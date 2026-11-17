import { useEffect } from 'react';
import {
  AcousticAudioEngine,
  type AudioEngineCallbacks,
} from '../audio/audioEngine';
import { inferBroadActivity } from '../dsp/analysis';
import { toActivityFrame, toFeatureFrame } from '../dsp/metrics';
import type { DspFrame } from '../types/acoustic';
import {
  MAX_RECENT_FRAMES,
  MAX_SESSION_FINGERPRINT_FRAMES,
  MAX_SESSION_SAMPLES,
} from './limits';
import { frameToSessionSample } from '../utils/exportSession';
import { dspWorkerClient } from '../workers/dspWorkerClient';
import type { GhostwireState } from './useGhostwireState';

function recordSessionSample(state: GhostwireState, frame: DspFrame): void {
  const wallNow = Date.now();
  if (wallNow - state.lastSessionSampleMsRef.current >= 200) {
    state.lastSessionSampleMsRef.current = wallNow;
    const elapsed =
      state.sessionElapsedAccumSecRef.current +
      (wallNow - state.sessionStartMsRef.current) / 1000;
    const point = frameToSessionSample(frame, elapsed);
    // AUDIT F8: stop appending once the session sample budget is exhausted.
    // In-place push avoids an O(n) array copy for every 5 Hz sample.
    if (state.activeSamplesRef.current.length < MAX_SESSION_SAMPLES) {
      state.activeSamplesRef.current.push(point);
    }
    // AUDIT F1: fingerprint frames keep derived spectra only, never PCM.
    if (
      state.sessionFingerprintFramesRef.current.length <
      MAX_SESSION_FINGERPRINT_FRAMES
    ) {
      state.sessionFingerprintFramesRef.current.push(toFeatureFrame(frame));
    }
    state.setActiveSessionDurationSec(elapsed);
    state.setActiveSamples(state.activeSamplesRef.current);
  }
}

function createFrameCallback(state: GhostwireState): AudioEngineCallbacks['onFrame'] {
  return (pre, post) => {
    const now = performance.now();

    // Keep rolling ~3.5s feature buffer for Experiment B & E.
    // ActivityFrame carries scalar-derived features only — no PCM, no spectra.
    const buffer = state.recentFramesRef.current;
    // AUDIT F8: shift before appending so the retained buffer never exceeds
    // its frame budget, even transiently.
    if (buffer.length >= MAX_RECENT_FRAMES) {
      buffer.shift();
    }
    buffer.push(toActivityFrame(pre));

    // Log numerical session sample at ~5 Hz when recording (never raw audio)
    if (state.recordingStateRef.current === 'recording') {
      recordSessionSample(state, pre);
    }

    // Throttle UI state updates to ~20 fps for low CPU on laptops
    if (now - state.lastUiCommitMsRef.current >= 48) {
      state.lastUiCommitMsRef.current = now;
      state.setLatestFrame(pre);
      state.setPostFrame(post);
      state.setActivity(
        inferBroadActivity(
          buffer,
          state.settingsRef.current.activityThresholdDbfs
        )
      );
    }
  };
}

function createModeChangeCallback(
  state: GhostwireState
): AudioEngineCallbacks['onModeChange'] {
  return (nextMode) => {
    state.setMode(nextMode);
    if (nextMode === 'idle') {
      state.setLatestFrame(null);
      state.setPostFrame(null);
      state.setActivity(null);
      state.recentFramesRef.current = [];
      if (state.recordingStateRef.current === 'recording') {
        // Freeze elapsed time rather than billing quiet wall-clock time to
        // the measurement, and keep the samples for an explicit save.
        state.sessionElapsedAccumSecRef.current +=
          (Date.now() - state.sessionStartMsRef.current) / 1000;
        state.sessionStartMsRef.current = Date.now();
        state.setRecordingState('paused');
        state.setSessionNotice(
          'Session auto-paused: the input source stopped. Restart the same source to resume, or STOP & SAVE to finalise it.'
        );
      }
    } else if (
      state.recordingStateRef.current !== 'idle' &&
      state.sessionProvenanceRef.current &&
      nextMode !== state.sessionProvenanceRef.current.sourceMode
    ) {
      // A recording belongs to the source it started with. Switching source
      // finalises it instead of silently mixing provenance.
      state.finalizeSessionRef.current(
        'Session auto-finalised: the input source changed, so it was saved with its original provenance before the new source started.'
      );
    }
  };
}

function createEngineCallbacks(state: GhostwireState): AudioEngineCallbacks {
  return {
    onFrame: createFrameCallback(state),
    onModeChange: createModeChangeCallback(state),
    onMetadataChange: (snapshot) => state.setMetadata(snapshot),
    onError: (message) => state.setErrorBanner(message),
  };
}

export function useAudioEngine(state: GhostwireState): void {
  useEffect(() => {
    const engine = new AcousticAudioEngine(
      state.settingsRef.current,
      createEngineCallbacks(state)
    );
    state.engineRef.current = engine;

    const handleBeforeUnload = () => {
      engine.stopCapture();
      dspWorkerClient.dispose();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      engine.stopCapture();
      dspWorkerClient.dispose();
      state.engineRef.current = null;
      // Release every retained buffer on unmount.
      state.recentFramesRef.current = [];
      state.sessionFingerprintFramesRef.current = [];
      state.activeSamplesRef.current = [];
      state.sessionProvenanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
