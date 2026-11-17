import { useEffect } from 'react';
import {
  AcousticAudioEngine,
  type AudioEngineCallbacks,
} from '../audio/audioEngine';
import { inferBroadActivity } from '../dsp/analysis';
import type { DspFrame } from '../types/acoustic';
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
    state.activeSamplesRef.current = [...state.activeSamplesRef.current, point];
    if (state.sessionFingerprintFramesRef.current.length < 180) {
      state.sessionFingerprintFramesRef.current.push(frame);
    }
    state.setActiveSessionDurationSec(elapsed);
    state.setActiveSamples(state.activeSamplesRef.current);
  }
}

function createFrameCallback(state: GhostwireState): AudioEngineCallbacks['onFrame'] {
  return (pre, post) => {
    const now = performance.now();

    // Keep rolling ~3.5s frame buffer for Experiment B & E
    const buffer = state.recentFramesRef.current;
    buffer.push(pre);
    if (buffer.length > 90) {
      buffer.shift();
    }

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
