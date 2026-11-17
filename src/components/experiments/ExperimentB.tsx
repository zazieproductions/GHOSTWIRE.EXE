import { EXPERIMENT_PROTOCOLS } from '../../data/protocols';
import type { ActivityInferenceResult, InputMode } from '../../types/acoustic';
import { MetricTile } from '../common/MetricTile';
import { ProtocolCard } from '../common/ProtocolCard';

interface ExperimentBProps {
  mode: InputMode;
  activity: ActivityInferenceResult | null;
}

export function ExperimentB({ mode, activity }: ExperimentBProps) {
  const liveObs = activity
    ? [
        `Rolling window: ${activity.frameCount} frames (${activity.windowDurationSec.toFixed(2)} s)`,
        `Dominant classification: ${activity.dominantState}`,
        `Transient frames detected: ${activity.transientCount}; Periodicity r=${activity.periodicityStrength.toFixed(2)}${activity.detectedPeriodHz ? ` (~${activity.detectedPeriodHz.toFixed(2)} Hz)` : ''}`,
      ]
    : ['No active signal stream.'];

  return (
    <div className="space-y-4">
      <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            EXPERIMENT B // TRANSPARENT ACTIVITY STATE INFERENCE
          </div>
          <div className="text-[11px] text-[#7a9384]">
            Rule-based DSP heuristics over a rolling ~3-second window. No speech recognition, no opaque ML claims.
          </div>
        </div>
        <div className="text-[11px] px-2.5 py-1 border border-[#1f3428] bg-[#0b1510] text-[#86efac] rounded-sm">
          {mode === 'idle' ? 'IDLE' : `SOURCE: ${mode.toUpperCase()}`}
        </div>
      </div>

      <div className="border border-[#f59e0b]/40 bg-[#181207] text-[#fcd34d] px-3 py-2 text-[11px] rounded-sm">
        <strong>SCIENTIFIC GUARDRAIL:</strong> Acoustic heuristics can characterize broad signal morphology (quiet, tonal, broadband, impulsive, periodic). They <strong>cannot</strong> reliably identify specific human activities such as typing, cooking, walking, or specific individuals without validated ground-truth context.
      </div>

      {activity && activity.classifications.length > 0 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <MetricTile
              label="Inferred Broad State"
              value={activity.classifications.filter((c) => c.detected).length > 0
                ? activity.classifications.filter((c) => c.detected).map((c) => c.label.split(' ')[0]).join('+')
                : 'MIXED'}
              accent="green"
              subtext={activity.dominantState}
            />
            <MetricTile
              label="Window Span"
              value={activity.windowDurationSec.toFixed(2)}
              unit="s"
              subtext={`${activity.frameCount} DSP frames`}
            />
            <MetricTile
              label="Transient Frames"
              value={String(activity.transientCount)}
              accent={activity.transientCount > 0 ? 'amber' : 'neutral'}
              subtext="Crest >= 11 dB or +7 dB jump"
            />
            <MetricTile
              label="Repetitive Cadence"
              value={
                activity.detectedPeriodHz
                  ? activity.detectedPeriodHz.toFixed(2)
                  : 'NONE'
              }
              unit={activity.detectedPeriodHz ? 'Hz' : undefined}
              accent={activity.detectedPeriodHz ? 'green' : 'neutral'}
              subtext={`Autocorr r = ${activity.periodicityStrength.toFixed(2)}`}
            />
          </div>

          <div className="space-y-2.5">
            {activity.classifications.map((c) => (
              <div
                key={c.id}
                className={`panel-border rounded-sm p-3 transition-colors ${
                  c.detected
                    ? 'border-[#22c55e]/60 bg-[#0b1711]'
                    : 'opacity-80'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-xs ${
                        c.detected
                          ? 'bg-[#14532d] text-[#bbf7d0] border border-[#22c55e]/50'
                          : 'bg-[#12191d] text-[#6d8576] border border-[#1f2c24]'
                      }`}
                    >
                      {c.detected ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                    <span className="text-xs font-semibold text-[#e2efe6]">
                      {c.label}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#86a390]">
                    Confidence: <strong className="uppercase">{c.confidence}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] border-t border-[#17241c] pt-2">
                  <div>
                    <span className="text-[#6e8a78] block uppercase text-[10px]">
                      Measured Evidence
                    </span>
                    <span className="text-[#d2e4d8]">{c.measuredEvidence}</span>
                  </div>
                  <div>
                    <span className="text-[#6e8a78] block uppercase text-[10px]">
                      Heuristic Rule
                    </span>
                    <span className="text-[#a5baad]">{c.thresholdRule}</span>
                  </div>
                  <div>
                    <span className="text-[#6e8a78] block uppercase text-[10px]">
                      Reasoning
                    </span>
                    <span className="text-[#c5d4ca]">{c.reasoning}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="panel-border rounded-sm p-6 text-center text-xs text-[#6e8a78]">
          No audio frames in buffer. Enable Microphone or start Synthetic Signals (e.g., preset &ldquo;Repetitive Transients&rdquo;) to observe live classification calculations.
        </div>
      )}

      <ProtocolCard
        protocol={EXPERIMENT_PROTOCOLS.B}
        liveObservations={liveObs}
      />
    </div>
  );
}
