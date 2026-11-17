#!/usr/bin/env node
/**
 * Reproducible README screenshot pipeline for GHOSTWIRE.EXE.
 *
 * Implements exactly the procedure described in the README screenshots note:
 * the production build (`npm run build`) is served with `vite preview` and
 * driven in headless Chromium. Most views run the synthetic testbench;
 * Experiment A's microphone window is fed by Chromium's file-backed fake
 * capture device, using a deterministically generated broadband-noise WAV
 * (see `generate-fake-mic-noise.mjs`), which is why `experiment-a.png`
 * shows `MIC ACTIVE`.
 *
 * Prerequisites:
 *   npm run build                      (or use `npm run screenshots`)
 *   npx playwright install chromium    (full Chromium + headless shell)
 *
 * Chromium launches in the new headless mode (`channel: 'chromium'`, the
 * full browser) for canvas/font fidelity; if only the headless shell is
 * installed the script falls back to it with a warning.
 *
 * Usage:
 *   npm run screenshots                          # build + capture all
 *   node scripts/capture-screenshots.mjs                   # capture only
 *   node scripts/capture-screenshots.mjs --port 4173 --out-dir docs/screenshots
 *   node scripts/capture-screenshots.mjs --base-url http://127.0.0.1:4173
 *     # capture against an already-running server (skips `vite preview`)
 *
 * Environment:
 *   GHOSTWIRE_CHROMIUM_ARGS   Extra space-separated Chromium flags
 *     (e.g. "--no-sandbox" on containerized CI workers).
 *
 * The UI state driven here is deterministic, but exact pixel values vary
 * with platform font rendering and animation timing; the captures document
 * the analysis path, not calibrated measurements.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { generateFakeMicNoiseWav } from './generate-fake-mic-noise.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_PORT = 4173;
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots');
const CAPTURE_VIEWPORT = { width: 2400, height: 1350 };
const SERVER_READY_TIMEOUT_MS = 30000;
const COMPARISON_TIMEOUT_MS = 15000;
const EXPERIMENT_A_WINDOW_MS = 3000;
const LIVE_MONITOR_SETTLE_MS = 4000;
const EXPERIMENT_B_WINDOW_MS = 4500;
const SESSION_ONE_MS = 5000;
const SESSION_TWO_MS = 8000;

function parseCaptureArgs(argv) {
  const args = { port: DEFAULT_PORT, outDir: DEFAULT_OUT_DIR, baseUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') args.port = Number(argv[i + 1]);
    else if (arg === '--out-dir') args.outDir = argv[i + 1];
    else if (arg === '--base-url') args.baseUrl = argv[i + 1];
    else throw new Error(`Unknown option: ${arg} (see header usage)`);
    i += 1;
  }
  if (!Number.isInteger(args.port) || args.port <= 0) {
    throw new Error('Option --port expects a positive integer.');
  }
  return args;
}

function assertProductionBuild() {
  const entry = path.join(REPO_ROOT, 'dist', 'index.html');
  if (!fs.existsSync(entry)) {
    throw new Error(
      'Missing dist/index.html. Run `npm run build` first (or use `npm run screenshots`).'
    );
  }
}

function startPreviewServer(port) {
  const viteBin = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(
    process.execPath,
    [
      viteBin,
      'preview',
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      '--strictPort',
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

async function isServerReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServerReady(url, proc) {
  const started = Date.now();
  while (Date.now() - started < SERVER_READY_TIMEOUT_MS) {
    if (proc.exitCode !== null) {
      throw new Error(`Preview server exited early (code ${proc.exitCode}).`);
    }
    if (await isServerReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Preview server did not respond at ${url} within ${SERVER_READY_TIMEOUT_MS}ms.`
  );
}

async function stopPreviewServer(proc) {
  if (proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited) proc.kill('SIGKILL');
}

function buildChromiumArgs(wavPath) {
  const args = [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wavPath}`,
    '--autoplay-policy=no-user-gesture-required',
    '--disable-dev-shm-usage',
  ];
  const extra = String(process.env.GHOSTWIRE_CHROMIUM_ARGS || '')
    .split(' ')
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
  return args.concat(extra);
}

function collectPageDiagnostics(page, diagnostics) {
  page.on('pageerror', (err) => {
    diagnostics.pageErrors.push(String(err && err.message ? err.message : err));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') diagnostics.consoleErrors.push(msg.text());
  });
}

function reportDiagnostics(diagnostics) {
  for (const text of diagnostics.consoleErrors) {
    console.warn(`[capture] console.error: ${text}`);
  }
  if (diagnostics.pageErrors.length > 0) {
    throw new Error(
      `Page errors during capture:\n${diagnostics.pageErrors.join('\n')}`
    );
  }
}

async function settle(page, ms) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
}

async function shoot(page, outDir, fileName) {
  const target = path.join(outDir, fileName);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[capture] wrote ${target}`);
}

async function clickButton(page, name) {
  await page.getByRole('button', { name }).click();
}

async function captureSyntheticSignals(page, outDir) {
  await clickButton(page, 'SYNTHETIC SIGNALS');
  await clickButton(page, /Electrical Hum/i);
  await expect(page.getByText('SYNTHETIC SIGNAL ACTIVE')).toBeVisible();
  await expect(page.getByText('DSP NUMERICAL SELF-VERIFICATION')).toBeVisible();
  await settle(page, 1500);
  await shoot(page, outDir, 'synthetic-signals.png');
}

async function captureLiveMonitor(page, outDir) {
  await clickButton(page, 'LIVE MONITOR');
  await expect(page.getByText('LIVE ACOUSTIC TELEMETRY')).toBeVisible();
  await page.waitForTimeout(LIVE_MONITOR_SETTLE_MS);
  await shoot(page, outDir, 'live-monitor.png');
}

async function captureExperimentA(page, outDir) {
  await clickButton(page, 'EXPOSURE LAB');
  await clickButton(page, /CAPTURE WINDOW A/i);
  await page.waitForTimeout(EXPERIMENT_A_WINDOW_MS);
  await clickButton(page, /FINISH WINDOW A/i);
  await expect(
    page.getByText(/Noise Floor \(10th pct\):/i).first()
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'ENABLE MICROPHONE' })
    .first()
    .click();
  await expect(page.getByText('MIC ACTIVE')).toBeVisible();
  await page.waitForTimeout(1000);
  await clickButton(page, /CAPTURE WINDOW B/i);
  await page.waitForTimeout(EXPERIMENT_A_WINDOW_MS);
  await clickButton(page, /FINISH WINDOW B/i);
  await expect(page.getByText(/Cosine=/)).toBeVisible({
    timeout: COMPARISON_TIMEOUT_MS,
  });
  await settle(page, 500);
  await shoot(page, outDir, 'experiment-a.png');
}

async function captureExperimentB(page, outDir) {
  await clickButton(page, 'SYNTHETIC SIGNALS');
  await clickButton(page, /Repetitive Transients/i);
  await expect(page.getByText('SYNTHETIC SIGNAL ACTIVE')).toBeVisible();
  await clickButton(page, 'EXPOSURE LAB');
  await clickButton(page, /EXP B/i);
  await expect(page.getByText('SOURCE: SYNTHETIC')).toBeVisible();
  await page.waitForTimeout(EXPERIMENT_B_WINDOW_MS);
  await shoot(page, outDir, 'experiment-b.png');
}

async function captureExperimentE(page, outDir) {
  await clickButton(page, /EXP E/i);
  await expect(page.getByText(/EDUCATIONAL HEURISTIC INDEX/i)).toBeVisible();
  await settle(page, 1500);
  await shoot(page, outDir, 'experiment-e.png');
}

async function recordSession(page, waitMs, expectedCount) {
  await clickButton(page, 'START SESSION');
  await page.waitForTimeout(waitMs);
  await clickButton(page, /STOP & SAVE SESSION/i);
  await expect(
    page.getByText(`RECORDED FEATURE SESSIONS (${expectedCount})`)
  ).toBeVisible();
}

async function selectSessionOption(select, prefix) {
  const value = await select.evaluate((element, wanted) => {
    const match = Array.from(element.options).find((option) =>
      option.label.startsWith(wanted)
    );
    return match ? match.value : null;
  }, prefix);
  if (!value) throw new Error(`No saved session starting with "${prefix}".`);
  await select.selectOption(value);
}

async function captureSessionAnalysis(page, outDir) {
  await clickButton(page, 'SYNTHETIC SIGNALS');
  await clickButton(page, /Electrical Hum/i);
  await clickButton(page, 'SESSION ANALYSIS');
  await recordSession(page, SESSION_ONE_MS, 1);
  await clickButton(page, 'SYNTHETIC SIGNALS');
  await clickButton(page, /Repetitive Transients/i);
  await clickButton(page, 'SESSION ANALYSIS');
  await recordSession(page, SESSION_TWO_MS, 2);
  await selectSessionOption(page.getByLabel('Baseline Session A'), 'Session 01');
  await selectSessionOption(
    page.getByLabel('Comparison Session B'),
    'Session 02'
  );
  await expect(page.getByText('Mean RMS Δ (B-A)')).toBeVisible({
    timeout: COMPARISON_TIMEOUT_MS,
  });
  await settle(page, 500);
  await shoot(page, outDir, 'session-analysis.png');
}

function isMissingExecutableError(err) {
  return String(err).includes("Executable doesn't exist");
}

async function launchCaptureBrowser(wavPath) {
  try {
    return await chromium.launch({
      headless: true,
      channel: 'chromium',
      args: buildChromiumArgs(wavPath),
    });
  } catch (err) {
    if (!isMissingExecutableError(err)) throw err;
    console.warn(
      '[capture] full Chromium not installed; falling back to headless shell'
    );
    return await chromium.launch({
      headless: true,
      args: buildChromiumArgs(wavPath),
    });
  }
}

async function captureAllScreenshots(baseUrl, outDir, wavPath) {
  const browser = await launchCaptureBrowser(wavPath);
  const diagnostics = { pageErrors: [], consoleErrors: [] };
  try {
    const context = await browser.newContext({ viewport: CAPTURE_VIEWPORT });
    await context.grantPermissions(['microphone'], { origin: baseUrl });
    const page = await context.newPage();
    collectPageDiagnostics(page, diagnostics);
    await page.goto(baseUrl, { waitUntil: 'load' });
    await expect(
      page.getByRole('heading', { name: 'GHOSTWIRE.EXE' })
    ).toBeVisible();
    await captureSyntheticSignals(page, outDir);
    await captureLiveMonitor(page, outDir);
    await captureExperimentA(page, outDir);
    await captureExperimentB(page, outDir);
    await captureExperimentE(page, outDir);
    await captureSessionAnalysis(page, outDir);
    await context.close();
  } finally {
    await browser.close();
  }
  reportDiagnostics(diagnostics);
}

async function runCapture(argv) {
  const args = parseCaptureArgs(argv);
  const manageServer = !args.baseUrl;
  if (manageServer) assertProductionBuild();
  const configuredBase = args.baseUrl || `http://127.0.0.1:${args.port}`;
  const baseUrl = configuredBase.replace(/\/+$/, '');
  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ghostwire-screenshots-')
  );
  const wavPath = path.join(scratch, 'fake-mic-noise.wav');
  fs.writeFileSync(wavPath, generateFakeMicNoiseWav({}));
  console.log(`[capture] fake-microphone WAV: ${wavPath}`);
  let server = null;
  try {
    if (manageServer) {
      server = startPreviewServer(args.port);
      await waitForServerReady(baseUrl, server);
      console.log(`[capture] preview ready at ${baseUrl}`);
    }
    await captureAllScreenshots(baseUrl, outDir, wavPath);
    console.log('[capture] all screenshots captured');
  } finally {
    if (server) await stopPreviewServer(server);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  await runCapture(process.argv.slice(2));
} catch (err) {
  console.error(`[capture] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
