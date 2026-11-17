import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

function createMockAudioContext(sampleRate = 48000) {
  let activeBuffer: Float32Array | null = null;

  const makeAnalyser = () => ({
    fftSize: 2048,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((out: Float32Array) => {
      if (activeBuffer) {
        const len = Math.min(out.length, activeBuffer.length);
        out.set(activeBuffer.subarray(0, len));
      } else {
        for (let i = 0; i < out.length; i++) {
          out[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
        }
      }
    }),
  });

  const makeGain = () => ({
    gain: { value: 1, setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  const makeBiquad = () => ({
    type: 'highpass',
    frequency: { setTargetAtTime: vi.fn() },
    Q: { setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  return {
    sampleRate,
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createAnalyser: vi.fn(() => makeAnalyser()),
    createGain: vi.fn(() => makeGain()),
    createBiquadFilter: vi.fn(() => makeBiquad()),
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBuffer: vi.fn((_ch: number, len: number) => ({
      copyToChannel: vi.fn((src: Float32Array) => {
        activeBuffer = new Float32Array(src);
      }),
      getChannelData: vi.fn(() => new Float32Array(len)),
    })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };
}

describe('GHOSTWIRE.EXE Privacy, Microphone Lifecycle & Synthetic Integration', () => {
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let enumerateDevicesMock: ReturnType<typeof vi.fn>;
  let mockTrackStop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    mockTrackStop = vi.fn();

    const mockStream = {
      getTracks: () => [{ stop: mockTrackStop }],
      getAudioTracks: () => [
        {
          stop: mockTrackStop,
          getSettings: () => ({
            sampleRate: 48000,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            deviceId: 'mock-mic-1',
          }),
          getCapabilities: () => ({ sampleRate: { min: 44100, max: 48000 } }),
        },
      ],
    };

    getUserMediaMock = vi.fn(async () => mockStream);
    enumerateDevicesMock = vi.fn(async () => []);

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: getUserMediaMock,
        enumerateDevices: enumerateDevicesMock,
        getSupportedConstraints: () => ({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: true,
        }),
      },
    });

    const MockAudioCtx = vi.fn(() => createMockAudioContext());
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: MockAudioCtx,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never requests microphone access or enumerates devices automatically on load', () => {
    render(<App />);
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(enumerateDevicesMock).not.toHaveBeenCalled();
    expect(screen.getByText(/IDLE \/\/ NO CAPTURE/i)).toBeInTheDocument();
  });

  it('handles microphone permission denial gracefully without entering active state', async () => {
    const err = new DOMException('Permission dismissed', 'NotAllowedError');
    getUserMediaMock.mockRejectedValueOnce(err);

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /ENABLE MICROPHONE/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/permission denied/i);
    });
    expect(screen.getByText(/IDLE \/\/ NO CAPTURE/i)).toBeInTheDocument();
  });

  it('activates microphone only on explicit click and stops tracks immediately on stop and unmount', async () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /ENABLE MICROPHONE/i })[0]);

    await waitFor(() => {
      expect(screen.getByText(/MIC ACTIVE/i)).toBeInTheDocument();
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: /STOP MICROPHONE/i })[0]);
    expect(mockTrackStop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/IDLE \/\/ NO CAPTURE/i)).toBeInTheDocument();

    // Enable again and verify unmount cleanup calls track.stop()
    fireEvent.click(screen.getAllByRole('button', { name: /ENABLE MICROPHONE/i })[0]);
    await waitFor(() => {
      expect(screen.getByText(/MIC ACTIVE/i)).toBeInTheDocument();
    });

    unmount();
    expect(mockTrackStop).toHaveBeenCalledTimes(2);
  });

  it('runs Synthetic Signals mode completely without microphone permission and verifies DSP checks', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /SYNTHETIC SIGNALS/i }));

    expect(getUserMediaMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /START SYNTHETIC STREAM/i }));

    await waitFor(() => {
      expect(screen.getByText(/SYNTHETIC SIGNAL ACTIVE/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /RUN DSP NUMERICAL CHECKS/i }));
    expect(screen.getByText(/Sine RMS Accuracy/i)).toBeInTheDocument();
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(2);
  });

  it('does not persist sessions across browser refresh by default, and clears all data on demand', async () => {
    const { unmount } = render(<App />);

    // Start synthetic stream and record a short session
    fireEvent.click(screen.getByRole('button', { name: /SYNTHETIC SIGNALS/i }));
    fireEvent.click(screen.getByRole('button', { name: /START SYNTHETIC STREAM/i }));
    await waitFor(() => {
      expect(screen.getByText(/SYNTHETIC SIGNAL ACTIVE/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /SESSION ANALYSIS/i }));
    fireEvent.click(screen.getByRole('button', { name: /START SESSION/i }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 260));
    });

    fireEvent.click(screen.getByRole('button', { name: /STOP & SAVE SESSION/i }));
    expect(screen.getByText(/RECORDED FEATURE SESSIONS \(1\)/i)).toBeInTheDocument();
    expect(localStorage.getItem('ghostwire.exe:sessions:v1')).toBeNull();

    // Simulated page refresh: unmount and remount
    unmount();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /SESSION ANALYSIS/i }));
    expect(screen.getByText(/RECORDED FEATURE SESSIONS \(0\)/i)).toBeInTheDocument();

    // Clear all session data control clears any opted-in storage too
    localStorage.setItem('ghostwire.exe:sessions:v1', '[]');
    fireEvent.click(screen.getByRole('button', { name: /CLEAR ALL SESSION DATA/i }));
    expect(localStorage.getItem('ghostwire.exe:sessions:v1')).toBeNull();
  });
});
