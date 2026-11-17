import { compareFingerprints } from '../dsp/analysis';
import type {
  EnvironmentalFingerprint,
  FingerprintComparison,
  MeasurementSession,
} from '../types/acoustic';
import {
  compareSessionsSync,
  type DspWorkerRequest,
  type DspWorkerResponse,
  type SessionComparisonResult,
} from './dsp.worker';

class DspWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  private getWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./dsp.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (event: MessageEvent<DspWorkerResponse>) => {
          const msg = event.data;
          const entry = this.pending.get(msg.id);
          if (!entry) return;
          this.pending.delete(msg.id);
          if (msg.type === 'error') {
            entry.reject(new Error(msg.error));
          } else {
            entry.resolve(msg.result);
          }
        };
        this.worker.onerror = () => {
          // Terminate broken worker so subsequent calls fall back synchronously
          this.dispose();
        };
      } catch {
        this.worker = null;
      }
    }
    return this.worker;
  }

  async compareFingerprints(
    a: EnvironmentalFingerprint,
    b: EnvironmentalFingerprint
  ): Promise<FingerprintComparison> {
    const worker = this.getWorker();
    if (!worker) {
      return compareFingerprints(a, b);
    }
    return new Promise<FingerprintComparison>((resolve, reject) => {
      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const req: DspWorkerRequest = { id, type: 'compare_fingerprints', a, b };
      worker.postMessage(req);
    });
  }

  async compareSessions(
    a: MeasurementSession,
    b: MeasurementSession
  ): Promise<SessionComparisonResult> {
    const worker = this.getWorker();
    if (!worker) {
      return compareSessionsSync(a, b);
    }
    return new Promise<SessionComparisonResult>((resolve, reject) => {
      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const req: DspWorkerRequest = { id, type: 'compare_sessions', a, b };
      worker.postMessage(req);
    });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, entry] of this.pending) {
      entry.reject(new Error('DSP worker disposed'));
    }
    this.pending.clear();
  }
}

export const dspWorkerClient = new DspWorkerClient();
