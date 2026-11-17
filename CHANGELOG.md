# Changelog

All notable changes to GHOSTWIRE.EXE are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release sections below the `Unreleased` heading are generated from GitHub release notes
by the [Update Changelog](.github/workflows/update-changelog.yml) workflow.

## [Unreleased](https://github.com/zazieproductions/GHOSTWIRE.EXE/commits/main)

No tagged releases yet. Everything currently on `main` is unreleased.

### Added

- Repository automation: `slop-scan` package verification, `roast-my-codebase` pull
  request health reports, and automated changelog updates on release.
- Build-time complexity guard (`npm run check:complexity`) plus deterministic DSP
  regression fixtures for activity inference and privacy-leakage heuristics.

### Changed

- Decomposed the seven critical-complexity functions into focused hooks, helpers and
  presentation components; all Roast critical and warning complexity findings are
  now below their thresholds.
- Extracted application state, engine lifecycle, capture controls, session recording
  and workspace routing into `src/app/`.
- Resolved the first `main` merge by carrying the upstream waveform-stripping fix
  into the new audio hook and wiring the capture-cancellation token into microphone
  and synthetic start/stop paths.
- Resolved the second `main` merge by porting the upstream non-overlapping spectral
  bands, time-aware cadence segmentation, worker-error/stale-result handling, and
  CSV metadata quoting into the refactored modules.

### Fixed

- Made the integration-test `AudioContext` mock constructible under Vitest 5.

### Security

- `slop-scan` fails CI when code or documentation references npm packages that do not
  exist on the registry, or that exist with implausibly low download counts.
