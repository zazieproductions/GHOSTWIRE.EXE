import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { MAX_SESSION_SAMPLES } from '../app/limits';
import { useAudioEngine } from '../app/useAudioEngine';
import { useGhostwireState } from '../app/useGhostwireState';
import { AcousticAudioEngine, type AudioEngineCallbacks } from '../audio/audioEngine';
import { analyzeTimeDomainFrame } from '../dsp/metrics';
import type { MeasurementSession } from '../types/acoustic';
import { STORAGE_KEY_CONSENT, STORAGE_KEY_SESSIONS } from '../utils/sessionStorage';

vi.mock('../audio/audioEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../audio/audioEngine')>()),
  AcousticAudioEngine: vi.fn(class {
    stopCapture() {}
  }),
}));

// Exercise the real cap handling without simulating an hour of audio.
vi.mock('../app/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../app/limits')>()),
  MAX_SESSION_SAMPLES: 3,
}));

const engine = vi.mocked(AcousticAudioEngine);
const frame = analyzeTimeDomainFrame(new Float32Array(2048), {
  fftSize: 2048,
  sampleRate: 48000,
  timestampMs: 0,
}).frame;

function startSyntheticSession(): AudioEngineCallbacks {
  render(<App />);
  const [, callbacks] = engine.mock.calls[0];
  act(() => callbacks.onModeChange('synthetic'));
  fireEvent.click(screen.getByRole('button', { name: 'SESSION ANALYSIS' }));
  fireEvent.click(screen.getByRole('button', { name: 'START SESSION' }));
  return callbacks;
}

function emitFrame(callbacks: AudioEngineCallbacks, advanceMs = 200): void {
  act(() => {
    vi.advanceTimersByTime(advanceMs);
    callbacks.onFrame({ ...frame, timestampMs: Date.now() }, null);
  });
}

describe('Audio engine integration with session state', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(new Date('2026-11-17T00:00:00Z'));
    localStorage.clear();
    engine.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the latest callback handler without reconstructing the engine', () => {
    const initialErrorHandler = vi.fn();
    const nextErrorHandler = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ onError }) => {
        const state = useGhostwireState();
        useAudioEngine({ ...state, setErrorBanner: onError });
      },
      { initialProps: { onError: initialErrorHandler } }
    );
    const [, callbacks] = engine.mock.calls[0];

    rerender({ onError: nextErrorHandler });
    act(() => callbacks.onError('Input source unavailable'));

    expect(engine).toHaveBeenCalledTimes(1);
    expect(initialErrorHandler).not.toHaveBeenCalled();
    expect(nextErrorHandler).toHaveBeenCalledWith('Input source unavailable');

    unmount();
    act(() => callbacks.onError('Late callback'));
    expect(nextErrorHandler).toHaveBeenCalledTimes(1);
  });

  it('redraws the timeline for each accepted sample, not just the frame count', () => {
    const callbacks = startSyntheticSession();
    const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext);

    emitFrame(callbacks);
    expect(screen.getByText('1 logged points')).toBeInTheDocument();
    getContext.mockClear();

    emitFrame(callbacks);
    expect(screen.getByText('2 logged points')).toBeInTheDocument();
    expect(getContext).toHaveBeenCalledTimes(1);

    emitFrame(callbacks, 100); // UI update, but not time for another sample.
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('warns at the sample limit and keeps the warning through auto-pause and save', () => {
    localStorage.setItem(STORAGE_KEY_CONSENT, '1');
    const callbacks = startSyntheticSession();
    const limitMessage = /session sample limit reached/i;

    for (let i = 1; i < MAX_SESSION_SAMPLES; i++) emitFrame(callbacks);
    expect(screen.queryByText(limitMessage)).not.toBeInTheDocument();

    // The warning also appears if the cap is reached outside Session Analysis.
    fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }));
    emitFrame(callbacks);
    expect(screen.getByText(limitMessage)).toBeInTheDocument();
    emitFrame(callbacks); // This sample is dropped.

    act(() => callbacks.onModeChange('idle'));
    fireEvent.click(screen.getByRole('button', { name: 'SESSION ANALYSIS' }));
    expect(screen.getByText(/session auto-paused/i)).toBeInTheDocument();
    expect(screen.getByText(limitMessage)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'STOP & SAVE SESSION' }));
    const sessions: MeasurementSession[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY_SESSIONS) ?? '[]'
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].samples.map(({ elapsedSec }) => elapsedSec)).toEqual([0.2, 0.4, 0.6]);
    expect(screen.getByText(limitMessage)).toBeInTheDocument();

    act(() => callbacks.onModeChange('synthetic'));
    fireEvent.click(screen.getByRole('button', { name: 'START SESSION' }));
    expect(screen.queryByText(limitMessage)).not.toBeInTheDocument();
  });
});
