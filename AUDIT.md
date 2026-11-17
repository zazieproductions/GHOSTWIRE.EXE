# GHOSTWIRE.EXE — Fundamental Technical Audit

**Date:** 2026-11-17

**Scope:** Repository at base commit `7b0efa792bf86d0b897cf3209c17ccec085972c2`; capture lifecycle, privacy, DSP methodology, sessions, exports, dependencies, tests and operational readiness. This is a source review and targeted verification, not a penetration test, a formal scientific validation, or an exhaustive cross-browser assessment. Findings below are based on code inspection unless explicitly described as a command result.

## Executive assessment

The project has a useful defensive foundation: explicit microphone activation, a synthetic mode, production CSP, feature-only session exports, and numerical DSP tests. However, its strongest privacy and reproducibility claims need work before the application should be treated as a reliable research instrument. In particular, raw waveform frames are retained in memory longer than the documentation suggests; asynchronous capture can outlive a stop or unmount; opted-in session persistence is erased on reload; and several analysis paths do not adequately control measurement provenance or timing.

**Priority key:** P0 = privacy/safety trust boundary; P1 = significant data loss, measurement validity, or development security risk; P2 = reliability or operational gap. Priorities are project-specific, not CVSS ratings.

| ID | Priority | Finding | Fundamental missing capability |
|:--|:--:|:--|:--|
| F1 | P0 | Raw waveform copies retained in buffers | Data minimization and accurate retention guarantees |
| F2 | P0 | Pending microphone requests can complete after cancellation | Race-safe capture lifecycle |
| F3 | P1 | Opted-in persistence is removed on reload | Durable, explicit storage lifecycle |
| F4 | P1 | Sessions can mix sources/settings and mislabel provenance | Measurement integrity and stable session boundaries |
| F5 | P1 | Spectral bands overlap and comparisons can use incompatible grids | Validated, comparable spectral representation |
| F6 | P1 | Cadence depends on irregular display-frame timing | Time-aware signal sampling |
| F7 | P1 | Vulnerable test dependencies | Maintained dependency/security process |
| F8 | P2 | Buffer growth and main-thread work are unbounded | Performance and resource budgets |
| F9 | P2 | Worker and metadata failures lack robust handling | Recoverable errors and observable state |
| F10 | P2 | Validation and delivery gates are incomplete | Automated regression and browser coverage |
| F11 | P2 | CSP and security documentation overstate protection | Precise threat model and deployment guidance |
| F12 | P2 | Export and accessibility workflows need hardening | Safe interchange and inclusive operation |

## Findings & recommendations

### F1 — Raw waveform data is retained beyond immediate analysis

**Evidence:** [`metrics.ts:341–365`](src/dsp/metrics.ts#L341-L365) copies each PCM frame into `DspFrame.waveform`. [`App.tsx:108–126`](src/App.tsx#L108-L126) retains up to 90 full frames for recent activity and the first 180 session frames for fingerprinting. [`ExperimentA.tsx:22–35,54–67`](src/components/experiments/ExperimentA.tsx#L22-L67) holds full frames during capture and does not clear its frame array when capture finishes. The security policy says no caching of raw PCM buffers ([`SECURITY.md`](SECURITY.md)); session UI says it retains only numerical features in memory ([`SessionAnalysisView.tsx:185–190`](src/components/views/SessionAnalysisView.tsx#L185-L190)).

**Impact:** These are volatile RAM copies, not evidence of raw audio being persisted or exported; nevertheless, waveform samples remain accessible in the page and can remain after a capture window finishes. That conflicts with the stated no-caching/feature-only retention boundary. Clearing session data also does not clear Experiment A's independent buffer. Garbage collection does not provide guaranteed immediate memory erasure.

**Recommendation:** Separate transient display samples from a feature-only frame type. Feed activity inference with scalar features and fingerprinting with only necessary spectra or incremental aggregates; clear capture buffers immediately on finish, stop, reset and unmount. Define and disclose the unavoidable short-lived raw buffers required by Web Audio and visualization, including their lifetime and limits. Verify that saved/exported sessions contain no PCM and add tests for buffer release across all paths.

### F2 — Capture cancellation is not race-safe

**Evidence:** [`audioEngine.ts:255–295`](src/audio/audioEngine.ts#L255-L295) stops the current capture, then awaits `getUserMedia()` and possibly `AudioContext.resume()` without a cancellation/generation check. Cleanup calls `stopCapture()` on unmount ([`App.tsx:162–173`](src/App.tsx#L162-L173)), but a permission request still pending at that time can resolve later and install a stream. Repeated enables or switching to synthetic while permission is pending can similarly interleave. A late failed request can also call `stopCapture()` against a newer capture ([`audioEngine.ts:333–345`](src/audio/audioEngine.ts#L333-L345)).

**Impact:** A late permission grant can activate or leak microphone tracks after the user's intended cancellation, or an older request can disrupt a newer mode. This is a source-derived race scenario; it was not reproduced against a real browser in this environment.

**Recommendation:** Use a monotonically increasing operation token invalidated on stop, mode change and unmount. After every `await`, check ownership; immediately stop tracks belonging to stale requests and do not alter the current graph/state. Model `requesting`, `active`, `stopping` and `error` explicitly in the UI. Test deferred permission grants, overlapping starts, rejection after a newer start, unmount and device/track termination.

### F3 — Opt-in persistence is deleted on reload

**Evidence:** Persistence defaults to false ([`App.tsx:36–42`](src/App.tsx#L36-L42)). The initial effect removes the session storage key whenever that setting is false ([`App.tsx:176–194`](src/App.tsx#L176-L194)); the restore attempt happens only when the user later enables the option ([`App.tsx:196–211`](src/App.tsx#L196-L211)). Thus a reload mounts with the default off and deletes previously opted-in data before the user can re-enable and restore it. Storage failures are silently ignored.

**Impact:** Users who explicitly selected persistence can lose saved sessions on reload; the UI cannot distinguish a successful save from quota or storage errors.

**Recommendation:** Define explicit opt-in, restore and revocation semantics. Preserve a prior consent marker or offer an explicit restore flow before deletion; delete on an intentional opt-out/clear rather than initial default initialization. Display failures and use a versioned, validated schema. Add reload, opt-out, clear, corrupt-data and quota-failure tests.

### F4 — Session provenance and lifecycle are not stable

**Evidence:** The capture-mode idle callback clears live frames but does not stop or pause an active session ([`App.tsx:143–150`](src/App.tsx#L143-L150)). At save time the session uses the *current* `mode`, latest sample rate (or a 48 kHz fallback), and current FFT setting ([`App.tsx:278–297`](src/App.tsx#L278-L297)); settings and sources can change while recording. The fingerprint only retains the first 180 sampled frames ([`App.tsx:115–126`](src/App.tsx#L115-L126)), approximately the first 36 seconds at 5 Hz, not a representative sample of an arbitrary-length session. [`analysis.ts:43–48,65–90`](src/dsp/analysis.ts#L43-L90) interprets all fingerprint spectra using the first frame's sample rate and FFT size.

**Impact:** Stopping input and saving can label a microphone session as `idle`; restarting with a different source or FFT size can combine incompatible observations under one metadata record. Long-session fingerprints characterize the beginning only, while summaries cover the full session. Wall-clock elapsed time may include intervals without input.

**Recommendation:** Capture provenance at session start; automatically pause/finalize or segment on input loss and changes to source, sample rate or analysis settings. Record configuration changes and actual sample timestamps; do not invent missing sample rates. Either label the fingerprint's sampling interval or use a documented representative aggregation across the session. Add transition and long-session tests.

### F5 — Fingerprints do not ensure comparable frequency bands

**Evidence:** [`analysis.ts:80–92`](src/dsp/analysis.ts#L80-L92) uses `floor(lowHz/binWidth)` through `ceil(highHz/binWidth)`, inclusive, for every band. Neighboring bands can therefore count the same FFT bins, particularly at low frequencies where bands are narrower than a bin. [`analysis.ts:155–183`](src/dsp/analysis.ts#L155-L183) compares band positions by index without checking sample rates, Nyquist limits, FFT sizes or band centers. Silent windows are assigned a uniform distribution ([`analysis.ts:117–119`](src/dsp/analysis.ts#L117-L119)), which can make two no-signal profiles appear similar. Confidence is based only on frame count ([`analysis.ts:194–196`](src/dsp/analysis.ts#L194-L196)).

**Impact:** Overlap can distort spectral distributions; comparing unlike grids can yield a plausible-looking but physically mismatched score. A high frame-count label is not validated statistical confidence, and near-silence lacks meaningful spectral evidence.

**Recommendation:** Define non-overlapping bin or fractional-bin integration, test power accounting and low-frequency resolution, and explicitly handle empty/silent bands. Reject incompatible profiles or rebin to a common documented frequency range; warn about resolution and sample-rate differences. Replace or clearly label the frame-count-derived confidence as a heuristic, then validate with controlled signals and repeatability datasets.

### F6 — Activity cadence assumes evenly spaced animation frames

**Evidence:** The live loop uses `requestAnimationFrame` ([`audioEngine.ts:519–600`](src/audio/audioEngine.ts#L519-L600)); activity uses a fixed count of 90 recent frames ([`App.tsx:108–112`](src/App.tsx#L108-L112)). Autocorrelation treats samples as uniformly spaced using average window duration ([`analysis.ts:302–340`](src/dsp/analysis.ts#L302-L340)). Animation timing varies with refresh rate, CPU load and background-tab throttling.

**Impact:** The window duration is not fixed, and irregular sampling or gaps can bias periodicity, transient counts and duty estimates. Reported frequency ranges and confidence are therefore not guaranteed across browsers or load conditions.

**Recommendation:** Use a time-based window, detect gaps and resample timestamped feature envelopes to a fixed cadence, or compute features on an audio-clock-driven path. Suppress estimates when sampling is insufficient. Test known impulse trains at varied refresh rates, simulated jitter, backgrounding and dropped frames.

### F7 — Development dependencies have known advisories

**Evidence:** `npm audit --json` on 2026-11-17 returned **3 affected packages**: `vitest` and `tinypool` critical, `@vitest/mocker` moderate. Relevant advisories include [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), and [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). npm proposed a major Vitest upgrade; advisory conditions and exploitability depend on actual usage.

**Impact:** These are development/test-chain findings, not proof of a browser runtime exploit. A compromised or exposed development environment can still threaten source code and release integrity.

**Recommendation:** Review advisory prerequisites, upgrade to compatible patched versions with lockfile changes, rerun tests/build, and establish dependency scanning and upgrade cadence. Avoid exposing dev/test servers to untrusted networks in the meantime. Do not blindly apply a forced major upgrade without compatibility testing.

### F8 — Resource usage lacks explicit limits

**Evidence:** Experiment A accumulates full frames without a duration cap ([`ExperimentA.tsx:31–35`](src/components/experiments/ExperimentA.tsx#L31-L35)). Session samples grow indefinitely and copy the entire array on each sample ([`App.tsx:115–129`](src/App.tsx#L115-L129)). The live loop computes FFTs on the main thread on each animation frame, including a second analysis when transformations are enabled ([`audioEngine.ts`](src/audio/audioEngine.ts)).

**Impact:** Long captures can grow memory and increasingly expensive session updates; FFT and visual updates can compete with UI responsiveness. The magnitude of impact has not been benchmarked.

**Recommendation:** Set visible duration/sample limits, use bounded or streaming aggregates, avoid repeated full-array copies, and profile at each FFT size on representative devices. Move work off the main thread where measurement shows it is needed, and test memory/CPU budgets for long runs.

### F9 — Failure and stale-result handling is incomplete

**Evidence:** Worker errors dispose the worker and reject pending requests ([`dspWorkerClient.ts:42–45,91–99`](src/workers/dspWorkerClient.ts#L42-L99)); comparisons in [`ExperimentA.tsx:69–86`](src/components/experiments/ExperimentA.tsx#L69-L86) and [`SessionAnalysisView.tsx:63–71`](src/components/views/SessionAnalysisView.tsx#L63-L71) do not catch rejected promises or guard against stale results. The worker client attempts a new worker on later calls rather than permanently falling back after a runtime error. `enumerateDevices()` and synthetic-start promises can reject without UI handling ([`audioEngine.ts:378–382`](src/audio/audioEngine.ts#L378-L382), [`App.tsx:222–225,498–503`](src/App.tsx#L222-L225)).

**Impact:** Comparisons or device inspection can fail silently or generate unhandled rejections; older comparison results can overwrite newer selections. The documented synchronous fallback applies when worker creation is unavailable, not necessarily to an in-flight worker failure.

**Recommendation:** Surface recoverable errors, retry or synchronously recompute failed comparisons where safe, bound pending requests, and ignore stale responses with request IDs or effect cleanup. Handle permission, device-change, ended-track and audio-context errors explicitly. Test worker creation failure, runtime failure, out-of-order replies and device enumeration rejection.

### F10 — Validation and delivery gates are incomplete

**Evidence:** Unit/integration suite comprises 13 tests; the single Playwright spec exercises a synthetic happy path ([`e2e/ghostwire.spec.ts`](e2e/ghostwire.spec.ts)). The integration audio graph is mocked ([`app.integration.test.tsx`](src/__tests__/app.integration.test.tsx)), so it cannot prove real Web Audio node behavior. No `.github/workflows` directory is present. `npm run lint` runs `tsc --noEmit` against a root config containing project references but no source files ([`package.json`](package.json), [`tsconfig.json`](tsconfig.json)); `npm run build` separately runs `tsc -b`.

**Impact:** Passing tests do not establish privacy lifecycle, persistence, transform accuracy, cross-browser behavior, accessibility or numerical calibration. The named lint command is not a substitute for project type-checking plus lint rules.

**Recommendation:** Add CI for clean install, explicit project type-checking, linting, unit/integration tests, build, dependency checks and browser E2E. Cover delayed permissions, persistence reload, export contents, comparison error paths, actual Web Audio transformations and synthetic reference vectors. Add Chromium, Firefox and WebKit coverage where supported; perform hardware/OS checks separately. Publish a validation matrix and keep research claims scoped to measured evidence.

### F11 — Network and deployment guarantees need a narrower threat model

**Evidence:** Production CSP sets `connect-src 'none'`, while development allows connections for Vite ([`vite.config.ts`](vite.config.ts)). [`SECURITY.md`](SECURITY.md) describes this as enforcing that zero fetch/XHR/WebSocket/EventSource requests can leave the origin. The policy also allows same-origin forms and other resource types; a CSP meta tag is not a full outbound-data firewall or a substitute for trusted hosting and code integrity.

**Impact:** `connect-src` is a valuable restriction on the named APIs, but it does not rule out every navigation, form submission, permitted resource request, browser extension or compromised host scenario. Static assets and browser infrastructure must still be delivered to the user.

**Recommendation:** Document the precise production/dev guarantees and threat model, including hosting, extensions, local storage, exports and CSP limitations. Test the built policy in a browser; consider stricter server-delivered headers where deployment permits, including `frame-ancestors`, and make claims about network behavior conditional on the deployed policy and trusted code.

### F12 — Export and accessibility workflows need dedicated review

**Evidence:** HTML escapes text fields ([`exportSession.ts:209–215`](src/utils/exportSession.ts#L209-L215)) and labels its 250-row limit ([`exportSession.ts:217–220`](src/utils/exportSession.ts#L217-L220)). CSV inserts the user-controlled session name into a comment line without newline handling ([`exportSession.ts:147–154`](src/utils/exportSession.ts#L147-L154)); session names come from an editable control. Data visualizations are canvas-based, and the main navigation visually distinguishes active buttons without an explicit selected-state attribute ([`App.tsx:412–433`](src/App.tsx#L412-L433)).

**Impact:** A name containing a newline can alter the CSV structure and, depending on spreadsheet import behavior, introduce a formula-like row. Visual plots and selected navigation state may be difficult to interpret with assistive technology; this is a review concern, not a completed accessibility audit.

**Recommendation:** Normalize or safely encode CSV metadata, test spreadsheet formula injection and round-trip parsing, and clearly document the HTML row cap. Add accessible names, selected-state semantics and text/table alternatives for graphical data as appropriate. Run keyboard, screen-reader and contrast testing against WCAG criteria.

## Remediation checklist

This GitHub-rendered task list tracks the proposed work in priority order. All items are open; see the linked findings for evidence and qualification. Check an item only after implementation, documentation and the relevant verification are complete. Findings are a point-in-time assessment; reassess applicability as the code changes.

### P0 — Capture and privacy boundaries

- [x] **F1:** Separate transient waveform data from feature-only activity and fingerprint buffers; clear capture buffers on finish, stop, reset and unmount. Test retention and ensure saved sessions and exports contain no PCM. Document the short-lived buffers required for analysis and display. [Details](#f1--raw-waveform-data-is-retained-beyond-immediate-analysis) → Resolved 2026-11-16 via PR #8
- [x] **F2:** Make asynchronous microphone start cancellation-safe across stop, mode changes, overlapping requests and unmount; stop stale streams and expose pending/error states. Test deferred grants, rejections and track termination. [Details](#f2--capture-cancellation-is-not-race-safe) → Resolved 2026-11-16 via PR #8

### P1 — Data integrity and research validity

- [x] **F3:** Fix opt-in session restoration and intentional deletion semantics; surface storage failures and validate stored data. Test reload, opt-out, clear, malformed data and quota errors. [Details](#f3--opt-in-persistence-is-deleted-on-reload) → Resolved 2026-11-16 via PR #8
- [x] **F4:** Capture session provenance at start and segment or stop sessions on source, sample-rate or configuration changes. Record gaps and accurately describe the fingerprint sampling interval; test transitions and long sessions. [Details](#f4--session-provenance-and-lifecycle-are-not-stable) → Resolved 2026-11-16 via PR #8
- [x] **F5:** Make spectral band integration non-overlapping, handle silence, and reject or rebin incompatible frequency grids. Label confidence as a heuristic and test power accounting and controlled comparisons. [Details](#f5--fingerprints-do-not-ensure-comparable-frequency-bands) → Resolved 2026-11-16 via PR #10
- [x] **F6:** Use time-aware, regularly sampled activity envelopes; detect gaps and suppress unsupported cadence estimates. Test known signals with jitter, dropped frames and backgrounding. [Details](#f6--activity-cadence-assumes-evenly-spaced-animation-frames) → Resolved 2026-11-16 via PR #10
- [x] **F7:** Review the test dependency advisories, upgrade to compatible patched releases, refresh the lockfile and rerun the full validation suite. Establish recurring dependency scanning. [Details](#f7--development-dependencies-have-known-advisories) → Resolved 2026-11-16: `npm audit` now reports 0 vulnerabilities; advisories in vitest/tinypool (@vitest/moker) resolved by installed patched releases.

### P2 — Reliability, delivery and usability

- [ ] **F8:** Bound capture and session memory, remove repeated full-array copies, and benchmark FFT/UI performance and long-running sessions on representative devices. [Details](#f8--resource-usage-lacks-explicit-limits)
- [x] **F9:** Handle worker, metadata and audio-start failures visibly; prevent stale comparison results and test failure/retry paths. [Details](#f9--failure-and-stale-result-handling-is-incomplete) → Resolved 2026-11-16 via PR #10
- [ ] **F10:** Add CI for project type-checking, linting, tests, build and dependency checks; expand browser and privacy lifecycle coverage and publish a validation matrix. [Details](#f10--validation-and-delivery-gates-are-incomplete)
- [ ] **F11:** Document the production/development CSP and deployment threat model precisely; test the built policy and consider stronger response headers where supported. [Details](#f11--network-and-deployment-guarantees-need-a-narrower-threat-model)
- [x] **F12:** Harden CSV metadata against structural and spreadsheet injection, test exports, and audit keyboard, screen-reader, contrast and chart alternatives. [Details](#f12--export-and-accessibility-workflows-need-dedicated-review) → Resolved 2026-11-16 via PR #10

When measurement or export semantics change, version them where appropriate and update the research and security documentation alongside the implementation.

## Verification performed

| Check | Result |
|:--|:--|
| `npm ci` | Passed; npm reported 3 vulnerabilities. |
| `npm run lint` | Passed; see F10 for the root TypeScript configuration caveat. |
| `npm test` | Passed: 2 files, 13 tests. |
| `npm run build` | Passed; includes `tsc -b` and Vite production build. |
| `npm audit --json` | 0 vulnerabilities (updated 2026-11-16). Previously reported advisories in vitest/tinypool (@vitest/moker) were resolved by the installed patched releases; counts/advisories are time-dependent. |
| `npx playwright test` | Could not execute: Chromium executable was not installed in this environment. The single browser test failed at launch, before exercising the application. |

No fixes were implemented as part of this audit. Findings involving races, performance, accessibility, or browser-specific behavior should be confirmed with targeted tests in their intended environments.
