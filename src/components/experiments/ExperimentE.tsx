import { EXPERIMENT_PROTOCOLS } from '../../data/protocols';
import { evaluatePrivacyLeakage } from '../../dsp/analysis';
import type {
  ActivityInferenceResult,
  DeviceMetadataSnapshot,
  DspFrame,
  InputMode,
} from '../../types/acoustic';
import { ProtocolCard } from '../common/ProtocolCard';

interface ExperimentEProps {
  mode: InputMode;
  recentFrames: DspFrame[];
  metadata: DeviceMetadataSnapshot;
  activity: ActivityInferenceResult | null;
}

export function ExperimentE({
  mode,
  recentFrames,
  metadata,
  activity,
}: ExperimentEProps) {
  const assessment = evaluatePrivacyLeakage(recentFrames, metadata, activity);

  const tierColor =
    assessment.heuristicTier === 'Elevated'
      ? 'text-[#f87171] border-[#ef4444]/50 bg-[#1f0d0d]'
      : assessment.heuristicTier === 'Moderate'
        ? 'text-[#fbbf24] border-[#f59e0b]/50 bg-[#1c1407]'
        : assessment.heuristicTier === 'Low'
          ? 'text-[#86efac] border-[#22c55e]/40 bg-[#0d1a12]'
          : 'text-[#9cb0a3] border-[#1f2e25] bg-[#0b1013]';

  const liveObs = [
    `Active input mode: ${mode.toUpperCase()}`,
    `Educational Heuristic Index: ${assessment.educationalHeuristicScore}/100 (${assessment.heuristicTier}) — non-validated instructional score`,
    `Inferred side-channel statements generated: ${assessment.potentialInferences.length}`,
  ];

  return (
    <div className="space-y-4">
      <div className="panel-border rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[#86efac] tracking-wider">
            EXPERIMENT E // PRIVACY LEAKAGE DEMONSTRATOR (ZERO-RECORDING EXPOSURE)
          </div>
          <div className="text-[11px] text-[#7a9384]">
            Demonstrates what an unprivileged observer could infer strictly from aggregate numerical features and browser metadata.
          </div>
        </div>

        <div className={`px-3 py-1.5 rounded-sm border text-xs font-semibold ${tierColor}`}>
          EDUCATIONAL HEURISTIC INDEX: {assessment.educationalHeuristicScore}/100 ({assessment.heuristicTier.toUpperCase()})
        </div>
      </div>

      <div className="border border-[#f59e0b]/40 bg-[#181207] text-[#fcd34d] px-3 py-2 text-[11px] rounded-sm">
        <strong>METHODOLOGICAL NOTE:</strong> The Educational Heuristic Index summarizes how many distinct acoustic and metadata side channels are currently observable. It is an <strong>educational heuristic</strong>, not a validated statistical probability of real-world re-identification or compromise.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Observable Features */}
        <div className="panel-border rounded-sm overflow-hidden">
          <div className="panel-header px-3 py-1.5 text-[11px] font-semibold text-[#86efac]">
            1. OBSERVABLE ACOUSTIC &amp; METADATA FEATURES
          </div>
          <div className="p-3 space-y-2 text-xs">
            {assessment.observableFeatures.map((feat) => (
              <div
                key={feat.name}
                className="flex items-start justify-between gap-3 border-b border-[#131f18] pb-1.5 last:border-b-0"
              >
                <div>
                  <div className="text-[#d2e4d8] font-semibold text-[11px]">{feat.name}</div>
                  <div className="text-[10px] text-[#6e8a78]">{feat.source}</div>
                </div>
                <div className="text-right tabular-nums text-[11px] text-[#4ade80]">
                  {feat.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Potential Inferences */}
        <div className="panel-border rounded-sm overflow-hidden">
          <div className="panel-header px-3 py-1.5 text-[11px] font-semibold text-[#fbbf24]">
            2. POTENTIAL BROAD INFERENCES (WITHOUT AUDIO RECORDING)
          </div>
          <div className="p-3 space-y-2 text-xs">
            {assessment.potentialInferences.map((inf, idx) => (
              <div
                key={idx}
                className="border border-[#1c2821] bg-[#080d10] p-2 rounded-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#e6efe9] font-semibold text-[11px]">
                    {inf.inference}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 border border-[#2a3b31] rounded-xs text-[#fbbf24]">
                    {inf.confidence}
                  </span>
                </div>
                <div className="text-[11px] text-[#7a9384]">{inf.basis}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Cannot Be Concluded */}
        <div className="panel-border rounded-sm overflow-hidden">
          <div className="panel-header px-3 py-1.5 text-[11px] font-semibold text-[#f87171]">
            3. WHAT CANNOT REASONABLY BE CONCLUDED
          </div>
          <ul className="p-3 space-y-1.5 text-[11px] text-[#d4c8c8]">
            {assessment.cannotBeConcluded.map((item, i) => (
              <li key={i}>• {item}</li>
            ))}
          </ul>
        </div>

        {/* Mitigations */}
        <div className="panel-border rounded-sm overflow-hidden">
          <div className="panel-header px-3 py-1.5 text-[11px] font-semibold text-[#4ade80]">
            4. RELEVANT PRIVACY MITIGATIONS
          </div>
          <ul className="p-3 space-y-1.5 text-[11px] text-[#c5d4ca]">
            {assessment.mitigations.map((m, i) => (
              <li key={i}>• {m}</li>
            ))}
          </ul>
        </div>
      </div>

      <ProtocolCard
        protocol={EXPERIMENT_PROTOCOLS.E}
        liveObservations={liveObs}
      />
    </div>
  );
}
