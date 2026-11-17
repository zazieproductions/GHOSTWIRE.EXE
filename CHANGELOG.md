# Changelog

All notable changes to GHOSTWIRE.EXE are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release sections below the `Unreleased` heading are generated from GitHub release notes
by the [Update Changelog](.github/workflows/update-changelog.yml) workflow.

## [Unreleased](https://github.com/zazieproductions/GHOSTWIRE.EXE/commits/main)

No tagged releases yet. Everything currently on `main` is unreleased.

### Added

- Reproducible README screenshot pipeline (`npm run screenshots`): a headless-Chromium
  Playwright capture (`scripts/capture-screenshots.mjs`) against the production preview,
  with Experiment A's microphone window fed by a deterministic broadband-noise WAV
  (`scripts/generate-fake-mic-noise.mjs`, covered by unit tests) via Chromium's
  file-backed fake capture device.
- README screenshot gallery in `docs/screenshots/`, captured from the production build with
  deterministic synthetic input, showing the live monitor, synthetic testbench, Experiments
  A/B/E and session analysis.
- Repository automation: `slop-scan` package verification, `roast-my-codebase` pull
  request health reports, automated changelog updates on release, and path-based
  pull request labeling (`actions/labeler` with `.github/labeler.yml`).
- Repository automation: `changed-files` change detection
  (`.github/workflows/changed-files.yml`, SHA-pinned to the action's v47.0.6 release),
  exposed as reusable workflow outputs and a job summary. The `Validate` workflow
  consumes the documentation-only signal to skip its code gates on docs-only changes;
  `npm audit` still runs and manual dispatches always run the full gate.
- Regression coverage for capture races, persistence reload/opt-out/corruption/quota,
  feature-only retention, spectral band accounting and export injection.
- `Validate` CI workflow (`.github/workflows/validate.yml`): type-check, lint, complexity
  guard, tests, production build and `npm audit --audit-level=high` gate every push to
  `main` and every pull request.
- Build-time complexity guard (`npm run check:complexity`) plus deterministic DSP
  regression fixtures for activity inference and privacy-leakage heuristics.

### Changed

- Retained buffers now hold feature projections (`ActivityFrame`, `FeatureFrame`) rather
  than full `DspFrame` objects, so time-domain PCM is never kept beyond the displayed
  frame; capture buffers are released on finish, stop, reset and unmount.
- Session provenance (source, sample rate, FFT size, label) is frozen when recording
  starts; input loss auto-pauses, a source change auto-finalises, and mismatched analysis
  grids are excluded from fingerprints instead of silently averaged.
- Experiment A integrates each FFT bin into exactly one log band, reports silent windows
  as having no spectral evidence, and marks profiles from different sample rates or FFT
  sizes as non-comparable instead of scoring them.
- Cadence estimation uses per-frame timestamps, and envelope periodicity is computed only
  over the longest continuous segment split at gaps larger than ~3× the median
  inter-frame interval.
- Retained frame/capture/session buffers are explicitly bounded (90 recent frames, 300
  capture frames, 18000 session samples ≈ 1h @ 5Hz) for long-running sessions.
- Decomposed the seven critical-complexity functions into focused hooks, helpers and
  presentation components; all Roast critical and warning complexity findings are
  now below their thresholds.
- Extracted application state, engine lifecycle, capture controls, session recording
  and workspace routing into `src/app/`.

### Fixed

- A microphone permission grant that resolves after the user stopped, switched mode or
  unmounted is now stopped immediately instead of activating capture, and a superseded
  rejection can no longer tear down a newer capture.
- Opted-in local sessions survive a reload: a consent marker drives restoration, writes
  no longer delete stored data, and storage failures are surfaced rather than ignored.
- Session comparisons catch worker rejections, ignore stale responses and show failures.
- CSV exports strip control characters from metadata and quote or prefix formula-like
  cells; HTML reports also escape single quotes.
- Made the integration-test `AudioContext` mock constructible under Vitest 5/6.

### Security

- `slop-scan` fails CI when code or documentation references npm packages that do not
  exist on the registry, or that exist with implausibly low download counts.
- `SECURITY.md` now scopes `connect-src 'none'` and the meta-tag CSP to what they
  actually enforce, and documents the unavoidable one-frame waveform buffer.
- Production and development CSP meta tags now include `frame-ancestors 'none'`, and the
  Vite CSP transform is covered by tests asserting `connect-src 'none'`,
  `frame-ancestors 'none'` and `object-src 'none'` on the built and dev policies.
