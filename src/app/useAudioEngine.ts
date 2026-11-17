import { useEffect } from 'react';
import {
  AcousticAudioEngine,
  type AudioEngineCallbacks,
} from '../audio/audioEngine';
import { inferBroadActivity } from '../dsp/analysis';
import { stripWaveform } from '../dsp/metrics';
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
    // AUDIT F1: fingerprint frames must not retain raw waveform beyond the
    // capture window. Strip PCM before caching for the session fingerprint.
    if (
      state.sessionFingerprintFramesRef.current.length <
      MAX_SESSION_FINGERPRINT_FRAMES
    ) {
      state.sessionFingerprintFramesRef.current.push(stripWaveform(frame));
    }
    state.setActiveSessionDurationSec(elapsed);
    state.setActiveSamples(state.activeSamplesRef.current);
  }
}

function createFrameCallback(state: GhostwireState): AudioEngineCallbacks['onFrame'] {
  return (pre, post) => {
    const now = performance.now();

    // Keep rolling ~3.5s frame buffer for Experiment B & E. Strip raw
    // waveform from retained frames to honor the no-PCM-retention boundary
    // (AUDIT F1). The live monitor still receives the full frame below.
    const buffer = state.recentFramesRef.current;
    // AUDIT F8: shift before appending so the retained buffer never exceeds
    // its frame budget, even transiently.
    if (buffer.length >= MAX_RECENT_FRAMES) {
      buffer.shift();
    }
    buffer.push(stripWaveform(pre));

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
    };
  }, []);
}
