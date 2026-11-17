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

- **Feature-only buffers:** Every retained buffer — the rolling activity window, session fingerprint frames and Experiment A capture windows — holds derived features only. Session fingerprints keep magnitude/power spectra; activity and experiment summaries keep scalars. Time-domain PCM is never copied into them.
- **Short-lived raw buffers (unavoidable):** one `Float32Array` per analysis frame is filled by `AnalyserNode.getFloatTimeDomainData()` and copied once for the frame that is currently displayed. That copy lives for one animation frame, is replaced on the next frame, and is dropped when capture stops or the view unmounts. Any in-progress experiment capture buffer is released on finish, reset and unmount; "Clear All Session Data" releases every remaining buffer and session array.
- **Volatile Memory Only by Default:** Measurement sessions retain only numerical aggregates and timestamps in RAM. Reloading or closing the browser discards unsaved session data.
- **Explicit Opt-In Persistence:** `localStorage` persistence (`ghostwire.exe:sessions:v1`) is disabled by default and requires explicit user opt-in in **SETTINGS**. Opting in writes a consent marker (`ghostwire.exe:sessions:consent:v1`) so that a later reload restores the stored sessions and re-enables the setting instead of deleting them. Nothing is deleted on startup; deletion happens only on an intentional opt-out or **Clear All Session Data**.
- **Validated, observable storage:** Stored sessions are structurally validated before use. Malformed or unreadable payloads are reported in the UI and left untouched rather than overwritten; quota failures are surfaced instead of being swallowed.
- **Clear All Session Data:** Wipes in-memory session arrays, the consent marker and any opted-in `localStorage` entries immediately.
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

- `connect-src 'none'` blocks `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` from this document. It is a restriction on those APIs, not an outbound firewall: it does not govern navigations, same-origin form submissions (still permitted by `form-action 'self'`), resource types allowed by other directives, browser extensions, or a compromised host.
- A CSP delivered in a `<meta>` tag is applied after the document starts parsing and cannot express `frame-ancestors`; the build path itself, the static host and the integrity of the served JavaScript remain part of the trust boundary. Microphone capture also depends on the secure-context and permission behaviour of the browser.
- When deploying to Cloudflare Pages, GitHub Pages, or Gitea Pages, mirror this policy via HTTP response headers where possible and add `frame-ancestors 'none'`, then verify the delivered headers on the deployed origin.

---

## 5. Reporting Security Issues

If you discover a privacy boundary flaw (such as an unclosed `MediaStreamTrack`, unintended persistence, or CSP bypass), please open an issue or pull request in the repository with reproduction steps.
