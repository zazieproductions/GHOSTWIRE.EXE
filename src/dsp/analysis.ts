/**
 * Public DSP analysis surface.
 *
 * Implementations live in focused modules; this barrel keeps the long-standing
 * `dsp/analysis` import path stable for callers and tests.
 */
export { buildLogBandBinMap, computeLogBandEdges } from './logBands';
export { buildEnvironmentalFingerprint, compareFingerprints } from './fingerprint';
export { inferBroadActivity } from './activity';
export { evaluatePrivacyLeakage } from './privacy';
export type { PrivacyLeakageAssessment } from './privacy';
