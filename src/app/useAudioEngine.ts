import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  AcousticAudioEngine,
  type AudioEngineCallbacks,
} from '../audio/audioEngine';
import { inferBroadActivity } from '../dsp/analysis';
import { toActivityFrame, toFeatureFrame } from '../dsp/metrics';
import type { DspFrame, InputMode } from '../types/acoustic';
import { frameToSessionSample } from '../utils/exportSession';
import { dspWorkerClient } from '../workers/dspWorkerClient';
import {
  MAX_RECENT_FRAMES,
  MAX_SESSION_FINGERPRINT_FRAMES,
  MAX_SESSION_SAMPLES,
} from './limits';
import type { GhostwireState } from './useGhostwireState';

function recordSessionSample(state: GhostwireState, frame: DspFrame): void {
  const wallNow = Date.now();
  if (wallNow - state.lastSessionSampleMsRef.current < 200) return;

  state.lastSessionSampleMsRef.current = wallNow;
  const elapsed =
    state.sessionElapsedAccumSecRef.current +
    (wallNow - state.sessionStartMsRef.current) / 1000;

  // AUDIT F8: bound the draft buffer and publish only the count to React.
  const samples = state.activeSamplesRef.current;
  if (samples.length < MAX_SESSION_SAMPLES) {
    const count = samples.push(frameToSessionSample(frame, elapsed));
    state.setActiveSampleCount(count);
    if (count === MAX_SESSION_SAMPLES) {
      state.setSessionSampleLimitReached(true);
    }
  }
  // AUDIT F1: fingerprint frames keep derived spectra only, never PCM.
  if (
    state.sessionFingerprintFramesRef.current.length <
    MAX_SESSION_FINGERPRINT_FRAMES
  ) {
    state.sessionFingerprintFramesRef.current.push(toFeatureFrame(frame));
  }
  state.setActiveSessionDurationSec(elapsed);
}

function handleAudioFrame(
  state: GhostwireState,
  pre: DspFrame,
  post: DspFrame | null
): void {
  const now = performance.now();

  // Rolling buffer for Experiment B & E: scalar features only, no PCM or spectra.
  const buffer = state.recentFramesRef.current;
  // AUDIT F8: evict before appending so the buffer never exceeds its budget.
  if (buffer.length >= MAX_RECENT_FRAMES) {
    buffer.shift();
  }
  buffer.push(toActivityFrame(pre));

  // Log numerical session samples at ~5 Hz when recording (never raw audio).
  if (state.recordingStateRef.current === 'recording') {
    recordSessionSample(state, pre);
  }

  // Throttle UI state updates to ~20 fps for low CPU on laptops.
  if (now - state.lastUiCommitMsRef.current >= 48) {
    state.lastUiCommitMsRef.current = now;
    state.setLatestFrame(pre);
    state.setPostFrame(post);
    state.setActivity(
      inferBroadActivity(buffer, state.settings.activityThresholdDbfs)
    );
  }
}

function handleModeChange(state: GhostwireState, nextMode: InputMode): void {
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
}

function createEngineCallbacks(
  stateRef: RefObject<GhostwireState | null>
): AudioEngineCallbacks {
  return {
    onFrame: (pre, post) => {
      if (stateRef.current) handleAudioFrame(stateRef.current, pre, post);
    },
    onModeChange: (mode) => {
      if (stateRef.current) handleModeChange(stateRef.current, mode);
    },
    onMetadataChange: (snapshot) => stateRef.current?.setMetadata(snapshot),
    onError: (message) => stateRef.current?.setErrorBanner(message),
  };
}

export function useAudioEngine(state: GhostwireState): void {
  const stateRef = useRef<GhostwireState | null>(null);
  // The engine survives re-renders, but its callbacks read the latest committed
  // state. Clear the snapshot on cleanup so late callbacks cannot retain it.
  useLayoutEffect(() => {
    stateRef.current = state;
    return () => {
      stateRef.current = null;
    };
  }, [state]);

  useEffect(() => {
    if (!stateRef.current) return;
    const {
      settings,
      engineRef,
      recentFramesRef,
      sessionFingerprintFramesRef,
      activeSamplesRef,
      sessionProvenanceRef,
    } = stateRef.current;
    const engine = new AcousticAudioEngine(
      settings,
      createEngineCallbacks(stateRef)
    );
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
}
