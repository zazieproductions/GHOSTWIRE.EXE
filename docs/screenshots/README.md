# README screenshots

Six captures from the production build (`npm run build && npm run preview`),
driven in headless Chromium. The input is deterministic rather than a live
room: most views run the synthetic testbench, and the microphone window in
Experiment A is fed by Chromium's file-backed fake capture device
(broadband noise), which is why `experiment-a.png` shows `MIC ACTIVE`. The
numbers demonstrate the analysis path; they are not calibrated measurements
of any environment.

| File | View | Input |
|:--|:--|:--|
| `live-monitor.png` | Live monitor | Synthetic 60 Hz mains-hum preset |
| `synthetic-signals.png` | Synthetic signals + DSP self-check | 60 Hz hum preset, deterministic 4096-sample frame |
| `experiment-a.png` | Experiment A fingerprint comparison | Window A: synthetic hum; Window B: file-backed fake microphone (broadband noise) |
| `experiment-b.png` | Experiment B activity inference | Synthetic 4 Hz impulse preset |
| `experiment-e.png` | Experiment E privacy exposure | Synthetic 4 Hz impulse preset |
| `session-analysis.png` | Session analysis + comparison | Session 01: hum (~5 s); Session 02: transients (~8 s) |

## Regenerating

```bash
npm run screenshots
```

This rebuilds the production bundle, serves it with `vite preview`, and runs
`scripts/capture-screenshots.mjs` (Playwright, new headless Chromium,
2400 px viewport, full-page captures). Experiment A's microphone input is a
deterministic pink-noise WAV generated on the fly by
`scripts/generate-fake-mic-noise.mjs` (seed `20261117`, 10 s, 48 kHz mono,
−18 dBFS) and looped through `--use-file-for-fake-audio-capture`.

- Requires `npx playwright install chromium` (full Chromium + headless shell).
- `npm run screenshots:capture` skips the rebuild and captures against an
  existing `dist/`; `--base-url` captures against an already-running server.
- The driven UI state is deterministic, but exact pixels vary with platform
  font rendering and animation timing.
