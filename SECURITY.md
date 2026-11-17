# SECURITY.md — Privacy Architecture & Threat Boundaries

## 1. Defensive Mission & Non-Goals

**GHOSTWIRE.EXE** is strictly a defensive, consent-based acoustic privacy research tool.

Explicit non-goals and prohibited behaviors:
- No covert or background microphone activation
- No automatic device enumeration prior to explicit user action
- No recording, caching, or persistence of raw PCM audio buffers
- No network transmission of audio, session metrics, or telemetry
- No speech recognition, transcription, or speaker identification

---

## 2. Consent & Hardware Lifecycle Controls

1. **Explicit User Gesture Required:** `navigator.mediaDevices.getUserMedia` is invoked **only** when the user clicks `ENABLE MICROPHONE`.
2. **No Silent Audio Monitoring:** Microphone input is routed strictly to `AnalyserNode` instances and is **never** connected to `AudioContext.destination` (speakers).
3. **Immediate Teardown:** Clicking `STOP MICROPHONE`, switching away, closing the tab (`beforeunload`), or unmounting the React root calls `track.stop()` on every `MediaStreamTrack`, disconnects all `AudioNode`s, and closes the `AudioContext`.
4. **Authoritative Indicators:** While GHOSTWIRE.EXE renders a prominent `MIC ACTIVE` badge whenever a stream is open, **browser permission indicators and OS-level privacy indicators (e.g., macOS Control Center orange indicator) are always authoritative.**

---

## 3. Data Retention & Export Privacy

- **Volatile Memory Only by Default:** Measurement sessions retain only numerical aggregates and timestamps in RAM. Reloading or closing the browser discards all session data.
- **Explicit Opt-In Persistence:** `localStorage` persistence (`ghostwire.exe:sessions:v1`) is disabled by default and requires explicit user opt-in in **SETTINGS**.
- **Clear All Session Data:** Wipes both in-memory session arrays and any opted-in `localStorage` entries immediately.
- **Aggregate Leakage Warning:** All CSV, JSON, and HTML exports include a clear notice explaining that timestamped aggregate features (noise floor curves, duty cycles, spectral centroids) can themselves reveal sensitive behavioral or environmental patterns.

---

## 4. Content Security Policy (CSP) & Static Hosting

Production builds (`npm run build`) embed the following restrictive CSP meta policy in `dist/index.html`:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'none';
media-src 'self' mediastream: blob:;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
```

- `connect-src 'none'` enforces at the browser layer that zero `fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource` requests can leave the origin.
- When deploying to Cloudflare Pages, GitHub Pages, or Gitea Pages, you may optionally mirror this policy via HTTP response headers and add `frame-ancestors 'none'`.

---

## 5. Reporting Security Issues

If you discover a privacy boundary flaw (such as an unclosed `MediaStreamTrack`, unintended persistence, or CSP bypass), please open an issue or pull request in the repository with reproduction steps.
