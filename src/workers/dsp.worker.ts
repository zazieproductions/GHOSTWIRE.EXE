import { compareFingerprints } from '../dsp/analysis';
import type {
  EnvironmentalFingerprint,
  FingerprintComparison,
  MeasurementSession,
} from '../types/acoustic';

export type DspWorkerRequest =
  | {
      id: string;
      type: 'compare_fingerprints';
      a: EnvironmentalFingerprint;
      b: EnvironmentalFingerprint;
    }
  | {
      id: string;
      type: 'compare_sessions';
      a: MeasurementSession;
      b: MeasurementSession;
    };

export interface SessionComparisonResult {
  rmsDeltaDb: number;
  noiseFloorDeltaDb: number;
  centroidDeltaHz: number;
  bandwidthDeltaHz: number;
  flatnessDelta: number;
  activityDutyDeltaPct: number;
  fingerprintComparison: FingerprintComparison | null;
}

export type DspWorkerResponse =
  | {
      id: string;
      type: 'compare_fingerprints';
      result: FingerprintComparison;
    }
  | {
      id: string;
      type: 'compare_sessions';
      result: SessionComparisonResult;
    }
  | {
      id: string;
      type: 'error';
      error: string;
    };

export function compareSessionsSync(
  a: MeasurementSession,
  b: MeasurementSession
): SessionComparisonResult {
  return {
    rmsDeltaDb: b.summary.meanRmsDbfs - a.summary.meanRmsDbfs,
    noiseFloorDeltaDb: b.summary.noiseFloorDbfs - a.summary.noiseFloorDbfs,
    centroidDeltaHz: b.summary.meanCentroidHz - a.summary.meanCentroidHz,
    bandwidthDeltaHz: b.summary.meanBandwidthHz - a.summary.meanBandwidthHz,
    flatnessDelta: b.summary.meanFlatness - a.summary.meanFlatness,
    activityDutyDeltaPct:
      b.summary.activityDutyCyclePct - a.summary.activityDutyCyclePct,
    fingerprintComparison:
      a.fingerprint && b.fingerprint
        ? compareFingerprints(a.fingerprint, b.fingerprint)
        : null,
  };
}

if (
  typeof window === 'undefined' &&
  typeof self !== 'undefined' &&
  typeof self.postMessage === 'function'
) {
  self.onmessage = (event: MessageEvent<DspWorkerRequest>) => {
    const req = event.data;
    try {
      if (req.type === 'compare_fingerprints') {
        const result = compareFingerprints(req.a, req.b);
        const res: DspWorkerResponse = {
          id: req.id,
          type: 'compare_fingerprints',
          result,
        };
        self.postMessage(res);
      } else if (req.type === 'compare_sessions') {
        const result = compareSessionsSync(req.a, req.b);
        const res: DspWorkerResponse = {
          id: req.id,
          type: 'compare_sessions',
          result,
        };
        self.postMessage(res);
      }
    } catch (err) {
      const res: DspWorkerResponse = {
        id: req.id,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(res);
    }
  };
}
