# Labels — GHOSTWIRE.EXE

Comprehensive label taxonomy for issues and pull requests. Labels are the
shared language for triage, routing, and release notes: they say **what kind
of work** this is, **where it lives**, **how urgent it is**, and **what state
it's in** — without opening the issue.

The live list is on GitHub ([Labels](https://github.com/zazieproductions/GHOSTWIRE.EXE/labels)).
The declarative source of truth is [`.github/labels.yml`](../.github/labels.yml);
re-create any missing label with `bash scripts/sync-labels.sh`.

> **Rule of thumb:** every issue/PR gets **1 type + 1 area + 1 priority**.
> Add experiment/DSP/platform labels when they narrow the scope, and
> workflow labels when the item is waiting on someone.

---

## 1. Type — what kind of work is this?

Pick exactly one primary type. The 12 GitHub defaults are kept; the rest
extend them for this codebase.

| Label | When to use it | Example |
|:--|:--|:--|
| `bug` | Something is broken or behaves incorrectly | Spectrogram freezes when mic is stopped |
| `enhancement` | New feature or request | Add a new synthetic signal: pink noise |
| `documentation` | Docs-only change (README, RESEARCH, SECURITY, AUDIT) | Correct the dBFS → dB SPL warning |
| `question` | Needs an answer, not code | Does the worker run the live FFT? |
| `accessibility` | Barrier for people with disabilities | Canvas has no text alternative for screen readers |
| `research` | Methodology, DSP theory, or experiment design | Validate the flatness threshold in RESEARCH.md §2.3 |
| `refactor` | Code health, decomposition, complexity reduction | Split `useGhostwireController` further |
| `chore` | Maintenance, tooling, housekeeping | Bump Node version in CI |
| `test` | Tests, fixtures, coverage, E2E validation | Add a regression fixture for Exp B cadence |
| `performance` | Speed, memory, rendering, FFT throughput | Session sampling copies the full array each frame |
| `security` | Security, CSP, or privacy-boundary vulnerability | `connect-src` allows exfiltration in dev build |
| `privacy` | Consent, retention, persistence, export sensitivity | Exported CSV leaks timestamps that reveal routine |
| `ui/ux` | Views, layout, styling, user experience | Live Monitor metrics overflow on small screens |
| `breaking-change` | Incompatible API, format, or behavior change | Change `ghostwire.exe:sessions:v1` storage shape |
| `regression` | Previously working behavior that broke | Waveform regressed after the limits refactor |
| `dependencies` | Dependabot / dependency-file updates | Bump `vite` |
| `javascript` | JS-code PRs (legacy default) | — |
| `typescript` | Types, strictness, type errors | `strict` flag catches a `Float32Array` misuse |

**Close-out types** (mutually exclusive, applied when closing):

| Label | Meaning |
|:--|:--|
| `duplicate` | Already exists — link the canonical issue |
| `invalid` | Doesn't seem right / not actionable |
| `wontfix` | Will not be worked on — explain why |

---

## 2. Priority — how urgent is it?

Pick exactly one. Priority is about **impact**, not effort.

| Label | Meaning | GHOSTWIRE.EXE examples |
|:--|:--|:--|
| `priority: critical` | **P0** — privacy/security, data loss, or mic leak. Fix immediately. | Mic track not stopped on unmount; raw PCM persisted |
| `priority: high` | **P1** — major impact, workaround exists | Worker failure leaves stale comparison results |
| `priority: medium` | **P2** — moderate impact | Export HTML missing the sensitivity notice |
| `priority: low` | **P3** — polish, minor, nice-to-have | Metric tile alignment on narrow viewports |

> Anything touching the microphone lifecycle, consent, CSP, or raw-audio
> retention defaults to `priority: critical` until proven otherwise.

---

## 3. Area — where does it live?

Maps directly to the codebase (`src/`). Pick one, two at most.

| Label | Code | Covers |
|:--|:--|:--|
| `area: audio-engine` | `src/audio/audioEngine.ts` | Web Audio graph, `getUserMedia`, capture loop, teardown |
| `area: dsp` | `src/dsp/` | FFT, metrics, analysis, synthetic generation |
| `area: experiments` | `src/components/experiments/`, `ExposureLabView` | Experiments A–E, Exposure Lab |
| `area: visualizations` | `src/components/visualizations/` | Waveform, spectrum, spectrogram canvases |
| `area: ui` | `src/App.tsx`, `src/app/`, `src/components/views/` | App shell, views, controls, chrome |
| `area: workers` | `src/workers/` | Comparison worker, sync fallback, stale-result handling |
| `area: sessions` | `src/app/useSessionPersistence.ts`, `limits.ts` | Session recording, `localStorage`, buffer caps |
| `area: export` | `src/utils/exportSession.ts` | CSV / JSON / HTML export, injection hardening |
| `area: config` | `src/config/csp.ts`, `vite.config.ts` | CSP policy, Vite build, base path |
| `area: tests` | `src/**/__tests__/`, `e2e/` | Vitest, Playwright, regression fixtures |
| `area: ci` | `.github/workflows/` | Validate, slop-scan, roast, changelog automation |
| `area: docs` | `README.md`, `RESEARCH.md`, `SECURITY.md`, `AUDIT.md` | Documentation and audit trail |

---

## 4. DSP & methodology — which measurement?

Use when the issue is about a specific signal-processing concern.

| Label | Covers | RESEARCH.md |
|:--|:--|:--|
| `dsp: fft` | FFT, Hann window, interpolation, bin spacing (Δf) | §2.2 |
| `dsp: metrics` | RMS, peak, dBFS, crest, centroid, bandwidth, flatness, ZCR, band energy | §2.1, §2.3 |
| `dsp: synthetic` | Synthetic signals, numerical checks, determinism | §1 |
| `dsp: analysis` | Activity inference, fingerprinting, heuristics, noise floor | §2.4, §3 |
| `methodology` | Epistemic boundaries, confounders, validation claims | §3, §4 |

---

## 5. Experiments — which Exposure Lab experiment?

Pick one when the issue is experiment-specific. Colors are intentionally
identical (purple) so the five read as a family.

| Label | Experiment | Research question |
|:--|:--|:--|
| `exp: A` | Environmental fingerprint | How similar are two acoustic environments? |
| `exp: B` | Broad activity inference | Which broad activity patterns are observable? |
| `exp: C` | Microphone metadata leakage | What device metadata can a browser expose? |
| `exp: D` | Signal transformation | How do transformations affect observability? |
| `exp: E` | Privacy leakage demonstrator | What can combined channels suggest? (heuristic index) |

Always pair with `area: experiments` and, where relevant, `methodology`.

---

## 6. Platform & API

| Label | When to use it |
|:--|:--|
| `webaudio` | Web Audio API, `MediaDevices`, permissions, `AnalyserNode` |
| `microphone` | Mic capture, device enumeration, `MediaStreamTrack` lifecycle |
| `browser-compat` | Cross-browser behavior (Chrome / Firefox / Safari / Edge) |
| `typescript` | Type errors, strictness, shared types (`src/types/acoustic.ts`) |

---

## 7. Workflow — what's the state?

| Label | Meaning |
|:--|:--|
| `needs-triage` | New, awaiting maintainer triage and labeling |
| `needs-repro` | Needs a reproducible example or steps |
| `needs-info` | Needs more information from the reporter |
| `blocked` | Blocked by another issue, PR, or external factor — link it |
| `audit` | From `AUDIT.md` findings (F1–F12) — cite the finding ID |
| `good first issue` | Good for newcomers — pair with `size: S` |
| `help wanted` | Extra attention needed — pair with `size: M` or `size: L` |

---

## 8. Effort — how big is it?

Pick exactly one.

| Label | Size | Guidance |
|:--|:--|:--|
| `size: S` | Small | Well-scoped, < 1 day. Ideal `good first issue`. |
| `size: M` | Medium | 1–3 days, some design or cross-file work. |
| `size: L` | Large | Multi-day, architectural, or research-heavy. |

---

## 9. How to label — recipes

### New bug report
`bug` + `priority: *` + `area: *` + (`needs-repro` if steps are missing)

> *Mic keeps running after STOP* → `bug` `priority: critical` `area: audio-engine`
> `microphone` `webaudio` `audit`

### Feature request
`enhancement` + `priority: *` + `area: *` + `size: *`

> *Add pink-noise synthetic signal* → `enhancement` `priority: low`
> `area: dsp` `dsp: synthetic` `size: S` `good first issue`

### DSP / research question
`research` (or `question`) + `methodology` + `dsp: *` + `exp: *`

> *Is the flatness threshold valid for single-frame noise?* → `research`
> `methodology` `dsp: metrics` `exp: B`

### Privacy / security report
`security` (or `privacy`) + `priority: critical` + `area: *`

> *Exported CSV allows spreadsheet formula injection* → `security`
> `priority: critical` `area: export` `audit`

### Documentation PR
`documentation` + `area: docs`

> *Clarify dBFS is not dB SPL* → `documentation` `area: docs` `size: S`

### Performance PR
`performance` + `area: *` + `size: *`

> *Cap session sample accumulation* → `performance` `area: sessions`
> `priority: medium` `size: M`

---

## 10. Color legend

| Color | Family | Labels |
|:--|:--|:--|
| 🔴 Red / dark red | Danger | `bug`, `security`, `audit`, `priority: critical`, `regression`, `microphone` |
| 🟠 Orange | High impact | `performance`, `priority: high`, `size: L` |
| 🟡 Yellow | Medium / caution | `refactor`, `priority: medium`, `browser-compat`, `area: sessions`, `size: M` |
| 🟢 Green | Core / go | `research`, `area: dsp`, `dsp: fft`, `priority: low`, `size: S`, `help wanted` |
| 🔵 Blue | Code / docs | `documentation`, `typescript`, `area: workers`, `area: docs`, `area: export`, `dependencies` |
| 🔷 Deep blue | Engine / infra | `area: audio-engine`, `area: ci`, `webaudio`, `test`, `dsp: metrics` |
| 🟣 Purple | Privacy / research | `privacy`, `methodology`, `good first issue`, `area: experiments`, `dsp: synthetic`, `exp: A–E`, `dsp: analysis`, `question` |
| 🩷 Pink | Human / visual | `accessibility`, `ui/ux`, `area: ui`, `area: visualizations` |
| ⚪ Gray / black | Meta | `duplicate`, `invalid`, `needs-*`, `wontfix`, `blocked`, `breaking-change`, `chore`, `area: config` |

---

## 11. Triage workflow

1. **New issue** → auto-apply `needs-triage` (maintainer removes it after labeling).
2. **Triage** → apply 1 type + 1 area + 1 priority + 1 size. Remove `needs-triage`.
3. **Missing details** → `needs-repro` (bug) or `needs-info` (question). Close after
   14 days without a response, with a comment.
4. **Ready to pick up** → remove `needs-*`; add `good first issue` / `help wanted`
   when appropriate.
5. **Blocked** → `blocked` + link the blocker. Re-triage when unblocked.
6. **Closing** → `duplicate` / `invalid` / `wontfix` with a reason and a link.

### Search recipes

```text
# Everything P0/P1
label:"priority: critical" OR label:"priority: high"

# All DSP work
label:"area: dsp" OR label:"dsp: fft" OR label:"dsp: metrics"

# Experiment E only
label:"exp: E"

# Good first issues, small
label:"good first issue" label:"size: S"

# Audit follow-ups
label:audit

# Privacy/security surface
label:security OR label:privacy OR label:microphone
```

---

## 12. Maintaining labels

- **Source of truth:** [`.github/labels.yml`](../.github/labels.yml) — edit it first,
  then sync: `bash scripts/sync-labels.sh`.
- **Don't rename** a label in use without updating this guide and searching
  open issues/PRs for the old name.
- **Don't add** a label that duplicates an existing one. If two labels feel
  similar, prefer the more specific one and note the relationship here.
- **Colors** follow the legend above. New labels should reuse a family color.
- **Descriptions** are shown in the GitHub label picker — keep them short,
  imperative, and specific to GHOSTWIRE.EXE.
