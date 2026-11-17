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
- Regression coverage for capture races, persistence reload/opt-out/corruption/quota,
  feature-only retention, spectral band accounting and export injection.

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

### Fixed

- A microphone permission grant that resolves after the user stopped, switched mode or
  unmounted is now stopped immediately instead of activating capture, and a superseded
  rejection can no longer tear down a newer capture.
- Opted-in local sessions survive a reload: a consent marker drives restoration, writes
  no longer delete stored data, and storage failures are surfaced rather than ignored.
- Session comparisons catch worker rejections, ignore stale responses and show failures.
- CSV exports strip control characters from metadata and quote or prefix formula-like
  cells; HTML reports also escape single quotes.

### Security

- `slop-scan` fails CI when code or documentation references npm packages that do not
  exist on the registry, or that exist with implausibly low download counts.
- `SECURITY.md` now scopes `connect-src 'none'` and the meta-tag CSP to what they
  actually enforce, and documents the unavoidable one-frame waveform buffer.
