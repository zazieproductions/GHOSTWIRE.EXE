import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { buildMeasurementSession } from '../utils/exportSession';
import { contentSecurityPolicy, injectCspMeta } from '../config/csp';

const STORAGE_KEY_SESSIONS = 'ghostwire.exe:sessions:v1';
const STORAGE_KEY_CONSENT = 'ghostwire.exe:sessions:consent:v1';

function storedSession() {
  return buildMeasurementSession({
    id: 'sess-stored',
    name: 'Stored Session',
    startedAtIso: '2026-11-17T00:00:00.000Z',
    endedAtIso: '2026-11-17T00:00:01.000Z',
    durationSec: 1,
    sourceMode: 'synthetic',
    sampleRate: 48000,
    fftSize: 2048,
    samples: [],
  });
}

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

describe('GHOSTWIRE.EXE CSP policy', () => {
  it('injects restrictive directives into the built and dev HTML policies', () => {
    // AUDIT F11: test the Vite transform directly so the gate does not depend
    // on a previously generated dist/ directory.
    const builtHtml = injectCspMeta('<html><!-- GHOSTWIRE_CSP --></html>', true);
    expect(builtHtml).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(builtHtml).toContain("connect-src 'none'");
    expect(builtHtml).toContain("frame-ancestors 'none'");
    expect(builtHtml).toContain("object-src 'none'");

    const devHtml = injectCspMeta('<html><!-- GHOSTWIRE_CSP --></html>', false);
    expect(devHtml).toContain("frame-ancestors 'none'");
    expect(devHtml).toContain("object-src 'none'");
    expect(devHtml).toContain("connect-src 'self' ws: wss:");

    expect(contentSecurityPolicy(true)).toContain("connect-src 'none'");
    expect(contentSecurityPolicy(false)).toContain("connect-src 'self' ws: wss:");
  });
});

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

    // Must be constructible: the engine calls `new AudioContext()`.
    const MockAudioCtx = vi.fn(function MockAudioContext() {
      return createMockAudioContext();
    });
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

  it('restores explicitly opted-in sessions after reload instead of deleting them', async () => {
    localStorage.setItem(STORAGE_KEY_CONSENT, '1');
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify([storedSession()]));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /SESSION ANALYSIS/i }));
    expect(
      screen.getByText(/RECORDED FEATURE SESSIONS \(1\)/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Stored Session')).toBeInTheDocument();

    // The opt-in survives the reload and the previously stored payload is intact.
    fireEvent.click(screen.getByRole('button', { name: /SETTINGS/i }));
    const persistenceToggle = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(persistenceToggle.checked).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY_SESSIONS)).not.toBeNull();
  });

  it('surfaces unreadable stored sessions without overwriting them', async () => {
    localStorage.setItem(STORAGE_KEY_CONSENT, '1');
    localStorage.setItem(STORAGE_KEY_SESSIONS, '{not valid json');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be parsed/i);
    });
    expect(localStorage.getItem(STORAGE_KEY_SESSIONS)).toBe('{not valid json');
  });

  it('deletes stored sessions only on an explicit opt-out', async () => {
    localStorage.setItem(STORAGE_KEY_CONSENT, '1');
    localStorage.setItem(STORAGE_KEY_SESSIONS, '[]');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /SETTINGS/i }));

    const persistenceToggle = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(persistenceToggle.checked).toBe(true);

    fireEvent.click(persistenceToggle);

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY_SESSIONS)).toBeNull();
    });
    expect(localStorage.getItem(STORAGE_KEY_CONSENT)).toBeNull();
  });

  it('persists numerical features only when persistence is opted in', async () => {
    localStorage.setItem(STORAGE_KEY_CONSENT, '1');
    localStorage.setItem(STORAGE_KEY_SESSIONS, '[]');

    render(<App />);

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

    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toHaveLength(1);
    });

    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS) as string;
    expect(raw).not.toContain('waveform');
    expect(raw).not.toContain('powerSpectrum');
    expect(JSON.parse(raw)[0].samples.length).toBeGreaterThan(0);
    expect(JSON.parse(raw)[0].sourceMode).toBe('synthetic');
  });
});
